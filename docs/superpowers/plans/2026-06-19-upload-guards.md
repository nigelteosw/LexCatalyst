# Upload Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user upload guards (doc count, daily rate, storage size) to the document upload endpoint, bypassed for admin users, to prevent R2 storage flooding in demo.

**Architecture:** Three DB count/sum queries run against the existing `documents` table at the top of the upload endpoint before any R2 upload is attempted. A new nullable `file_size` column on `documents` tracks bytes per file and powers the storage sum. All guards are skipped for `is_admin=True` users.

**Tech Stack:** FastAPI, SQLAlchemy ORM, Alembic (migrations), Python `unittest` + `MagicMock`

## Global Constraints

- Admin bypass: `user.is_admin` (already synced from `ADMIN_EMAILS` env var, defaults to `nigelteosw@gmail.com`)
- Limits for non-admin: 50 docs total, 10 uploads per 24h, 1 GB total stored bytes
- Per-file size cap: 25 MB — already enforced, do not change
- HTTP status for limit violations: 429
- Existing rows: `file_size` nullable, treated as 0 in sum — no backfill
- All tests use `unittest` + `MagicMock` (no pytest fixtures, no DB required)
- Follow migration naming convention: `<letter><digits>_<description>.py`, revision IDs are `<letter><7hex>`

---

## File Map

| File | Change |
|---|---|
| `backend/app/models.py` | Add `file_size: Mapped[int \| None]` to `Document` |
| `backend/migrations/versions/w8f9a0b1c2d3_add_document_file_size.py` | New migration: ADD COLUMN `file_size INTEGER` |
| `backend/app/services/document_service.py` | Set `file_size=len(file_bytes)` when creating `Document` |
| `backend/app/routers/documents.py` | Add `_check_upload_limits`, call it in `upload_document` |
| `backend/tests/test_upload_guards.py` | New test file for the guard logic |

---

### Task 1: Add `file_size` column — model + migration

**Files:**
- Modify: `backend/app/models.py` — add `file_size` field to `Document`
- Create: `backend/migrations/versions/w8f9a0b1c2d3_add_document_file_size.py`

**Interfaces:**
- Produces: `Document.file_size: int | None` — used by Task 2 (store on upload) and Task 3 (sum query)

- [ ] **Step 1: Add field to the ORM model**

In `backend/app/models.py`, find the `Document` class. After the `storage_key` field (line ~195), add:

```python
file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

`Integer` is already imported at the top of the file. No other changes to `models.py`.

- [ ] **Step 2: Write the Alembic migration**

Create `backend/migrations/versions/w8f9a0b1c2d3_add_document_file_size.py`:

```python
"""add document file_size

Revision ID: w8f9a0b1c2d3
Revises: v7e8f9a0b1c2
Create Date: 2026-06-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "w8f9a0b1c2d3"
down_revision: str | None = "v7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("file_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "file_size")
```

- [ ] **Step 3: Verify migration applies cleanly**

```bash
cd backend && alembic upgrade head
```

Expected: migration applies with no errors. If the DB is not running locally, confirm the file parses correctly:

```bash
cd backend && python -c "import migrations.versions.w8f9a0b1c2d3_add_document_file_size"
```

Expected: no output (import succeeds).

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/w8f9a0b1c2d3_add_document_file_size.py
git commit -m "feat: add file_size column to documents"
```

---

### Task 2: Store `file_size` on upload

**Files:**
- Modify: `backend/app/services/document_service.py` — set `file_size` in `create_pending_document`

**Interfaces:**
- Consumes: `Document.file_size` from Task 1
- Produces: every new `Document` row has `file_size = len(file_bytes)` set at creation

- [ ] **Step 1: Set `file_size` when creating the Document row**

In `backend/app/services/document_service.py`, find `create_pending_document`. The `Document(...)` constructor call is around line 156. Add `file_size=len(file_bytes)`:

```python
document = Document(
    user_id=user_id,
    filename=filename,
    content_type=content_type,
    status="uploaded",
    matter_id=matter_id,
    team_id=team_id,
    file_size=len(file_bytes),
)
```

No other changes to this file.

- [ ] **Step 2: Verify the import is not needed**

`len` is a builtin. No new imports required.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/document_service.py
git commit -m "feat: store file_size on document upload"
```

---

### Task 3: Upload limit guards — implementation + tests

**Files:**
- Modify: `backend/app/routers/documents.py` — add `_check_upload_limits`, call it in `upload_document`
- Create: `backend/tests/test_upload_guards.py`

**Interfaces:**
- Consumes: `Document.file_size` (Task 1), `Document.user_id`, `Document.created_at`, `User.is_admin`
- Produces: `_check_upload_limits(db: Session, user: User, incoming_bytes: int) -> None` — raises `HTTPException(429)` on violation, returns `None` on pass

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_upload_guards.py`:

```python
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.routers.documents import _check_upload_limits

_ONE_GB = 1 * 1024 * 1024 * 1024


class UploadGuardTests(unittest.TestCase):
    def test_admin_bypasses_all_limits(self) -> None:
        db = MagicMock()
        user = SimpleNamespace(is_admin=True)
        # Would blow past every limit if checked — admin should not raise
        _check_upload_limits(db, user, 10 * _ONE_GB)
        db.scalar.assert_not_called()

    def test_total_doc_cap_raises_429(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [50]  # total=50, hits cap immediately
        user = SimpleNamespace(is_admin=False, id="u1")
        with self.assertRaises(HTTPException) as ctx:
            _check_upload_limits(db, user, 1)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("50 max", ctx.exception.detail)

    def test_daily_rate_limit_raises_429(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [5, 10]  # total=5 (ok), daily=10 (cap)
        user = SimpleNamespace(is_admin=False, id="u1")
        with self.assertRaises(HTTPException) as ctx:
            _check_upload_limits(db, user, 1)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("10 per day", ctx.exception.detail)

    def test_storage_limit_raises_429(self) -> None:
        db = MagicMock()
        # total=5 (ok), daily=3 (ok), used_bytes = 1GB - 100 bytes
        db.scalar.side_effect = [5, 3, _ONE_GB - 100]
        user = SimpleNamespace(is_admin=False, id="u1")
        with self.assertRaises(HTTPException) as ctx:
            _check_upload_limits(db, user, 200)  # 100 + 200 > 1GB
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("1 GB", ctx.exception.detail)

    def test_under_all_limits_passes(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [5, 3, 100 * 1024 * 1024]  # 100 MB used
        user = SimpleNamespace(is_admin=False, id="u1")
        # Should not raise
        _check_upload_limits(db, user, 1 * 1024 * 1024)  # +1MB upload

    def test_storage_null_used_treated_as_zero(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [0, 0, None]  # SUM returns None when no rows
        user = SimpleNamespace(is_admin=False, id="u1")
        # Should not raise — None used_bytes defaults to 0
        _check_upload_limits(db, user, 1 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && python -m pytest tests/test_upload_guards.py -v 2>&1 | head -20
```

Expected: `ImportError` or `AttributeError` — `_check_upload_limits` does not exist yet.

- [ ] **Step 3: Add imports to the router**

In `backend/app/routers/documents.py`, add to the existing import block at the top:

```python
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
```

These go after the existing `from sqlalchemy.exc import SQLAlchemyError` and `from sqlalchemy.orm import Session` imports.

- [ ] **Step 4: Add the limit constants and guard function**

In `backend/app/routers/documents.py`, after `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`, add:

```python
_MAX_DOCS = 50
_MAX_DOCS_PER_DAY = 10
_MAX_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB


def _check_upload_limits(db: Session, user: User, incoming_bytes: int) -> None:
    if user.is_admin:
        return

    total = db.scalar(select(func.count(Document.id)).where(Document.user_id == user.id)) or 0
    if total >= _MAX_DOCS:
        raise HTTPException(
            status_code=429,
            detail=f"Document limit reached ({_MAX_DOCS} max). Delete some documents to upload more.",
        )

    since = datetime.now(UTC) - timedelta(hours=24)
    daily = db.scalar(
        select(func.count(Document.id)).where(
            Document.user_id == user.id,
            Document.created_at >= since,
        )
    ) or 0
    if daily >= _MAX_DOCS_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail=f"Upload rate limit reached ({_MAX_DOCS_PER_DAY} per day). Try again later.",
        )

    used_bytes = db.scalar(
        select(func.sum(Document.file_size)).where(
            Document.user_id == user.id,
            Document.file_size.is_not(None),
        )
    ) or 0
    if used_bytes + incoming_bytes > _MAX_BYTES:
        raise HTTPException(
            status_code=429,
            detail="Storage limit reached (1 GB). Delete some documents to upload more.",
        )
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd backend && python -m pytest tests/test_upload_guards.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 6: Wire the guard into `upload_document`**

In `backend/app/routers/documents.py`, find `upload_document`. After reading `file_bytes` and checking `if not file_bytes` and the size check, add the limit check. The updated try block should look like:

```python
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded file is too large")
        _check_upload_limits(db, current_user, len(file_bytes))

        document = await create_pending_document(
            ...
        )
```

The `_check_upload_limits` call goes immediately after the existing size check, before `create_pending_document`.

- [ ] **Step 7: Run the full test suite**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_upload_guards.py
git commit -m "feat: enforce upload guards (doc count, daily rate, storage cap)"
```

---

## Self-Review

**Spec coverage:**
- ✓ Total doc cap (50) — Task 3
- ✓ Daily upload rate (10/day) — Task 3
- ✓ Total storage cap (1 GB) — Task 3
- ✓ Admin bypass — Task 3 (`user.is_admin` early return)
- ✓ `file_size` column — Task 1
- ✓ `file_size` stored on upload — Task 2
- ✓ Fail fast before R2 upload — Task 3 (guard called before `create_pending_document`)
- ✓ NULL `file_size` treated as 0 — Task 3 (`or 0` fallback + `is_not(None)` filter) + tested
- ✓ Existing per-file 25 MB cap unchanged

**Placeholder scan:** None found. All steps have complete code.

**Type consistency:** `_check_upload_limits(db: Session, user: User, incoming_bytes: int) -> None` — consistent across Task 3 steps and test imports.
