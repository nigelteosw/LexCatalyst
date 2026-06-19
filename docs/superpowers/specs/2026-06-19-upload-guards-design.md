# Upload Guards Design

**Date:** 2026-06-19  
**Motivation:** Prevent malicious actors from flooding Cloudflare R2 storage during demo. Guards bound cost exposure per user before any file reaches R2.

---

## Goals

1. Cap total R2 storage consumed per non-admin user (primary goal — directly limits cost)
2. Cap total document count per non-admin user (secondary — limits DB bloat)
3. Cap daily upload rate per non-admin user (tertiary — limits burst flooding)
4. Admin users (`nigelteosw@gmail.com` and any others in `ADMIN_EMAILS`) bypass all limits
5. Confirm existing behaviours are correct: S3 delete on document delete ✓, document tracking ✓

---

## What Already Works (No Changes)

| Behaviour | Where |
|---|---|
| 25 MB per-file size cap | `routers/documents.py` `MAX_UPLOAD_BYTES` |
| Document row created for every upload | `document_service.create_pending_document` |
| R2 object deleted when document row deleted | `document_service.delete_user_document` → `storage_service.delete_document_file` |
| Admin identity synced from `ADMIN_EMAILS` env var | `dependencies.authenticate_user_token` |
| `nigelteosw@gmail.com` is default admin | `config.py` `admin_emails` default |

---

## New: Upload Guard Limits

| Guard | Limit | Who | HTTP status |
|---|---|---|---|
| Total stored bytes (SUM) | 1 GB | non-admin | 429 |
| Total document count | 50 docs | non-admin | 429 |
| Daily upload count | 10 per 24h | non-admin | 429 |
| Per-file size | 25 MB (existing) | everyone | 413 |

All three new guards are evaluated **before** any R2 upload is attempted — fail fast.

The storage sum check uses `SUM(file_size)` over existing documents plus the incoming file size. This means a single upload that would push the user over 1 GB is rejected even if all prior files are small.

---

## Data Model Change

Add `file_size` column to `documents` table:

- Type: `Integer`, nullable
- Meaning: size of the uploaded file in bytes
- Populated: on upload, set to `len(file_bytes)`
- Existing rows: `NULL` — treated as 0 in the storage sum query
- No backfill required

---

## Implementation

### 1. `models.py`

Add to `Document`:
```python
file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

### 2. Migration

New Alembic migration: `ADD COLUMN file_size INTEGER` on `documents`. Nullable, no default.

### 3. `document_service.create_pending_document`

Set `document.file_size = len(file_bytes)` when creating the `Document` row.

### 4. `routers/documents.py`

Add a `_check_upload_limits(db, user, incoming_bytes)` helper called at the top of `upload_document`, after reading file bytes, before calling `create_pending_document`.

```
if user.is_admin → return (bypass all)

total_docs = COUNT(*) WHERE user_id = user.id
if total_docs >= 50 → 429 "Document limit reached (50 max). Delete some documents to upload more."

daily_uploads = COUNT(*) WHERE user_id = user.id AND created_at >= now() - 24h
if daily_uploads >= 10 → 429 "Upload rate limit reached (10 per day). Try again later."

used_bytes = SUM(file_size) WHERE user_id = user.id (NULL treated as 0)
if used_bytes + incoming_bytes > 1 GB → 429 "Storage limit reached (1 GB). Delete some documents to upload more."
```

Order matters: count checks first (cheap), storage sum last (slightly more expensive but still a single query).

---

## Out of Scope

- Per-IP rate limiting (not needed, users are authenticated)
- Redis / external rate limiter (no new infra for a demo)
- Raising the 25 MB per-file cap (not requested)
- Total storage backfill for existing documents (NULL treated as 0, acceptable)
