# Birdie Live Context, Precedent, eLitigation and Model Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Birdie Chrome extension see the lawyer's live highlight and page, show firm precedent for the highlighted clause, ground every case it cites in eLitigation, start fresh conversations, and let the lawyer pick their OpenRouter model.

**Architecture:** Backend (FastAPI) gains three services — `audit_service` (retrieval audit log), `elitigation_service` + `case_law_service` (eLitigation search, prompt grounding, citation guard), `precedent_service` (classify clause, permission-scoped search, term extraction) — plus `POST /precedent/search` and a `sources` SSE event on `POST /birdie/stream`. The extension gains a per-site content script that reports selections, a `useBrowserContext` hook that owns selection/page state, and side-panel views for chips, model choice, precedent and cases. Model choice reuses the existing `/settings/birdie*` routes.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, requests, BeautifulSoup4, unittest · Chrome MV3, React 19, TypeScript, Vite, Tailwind 4, vitest, Bun.

**Spec:** `docs/superpowers/specs/2026-10-05-birdie-live-context-precedent-design.md`

## Global Constraints

- Every retrieval path checks the current user; documents only via `document_access_filter`, KB only via `search_kb_for_chat` (AGENTS.md "Legal Data Rules").
- Any case or judgment Birdie names must come from eLitigation (`https://www.elitigation.sg`) with a link; never from model memory.
- Only the search phrase is sent to eLitigation; no document or client text.
- Precedent sends no text to an LLM. No suggestion without a source.
- The content script runs only on origins the user turned on; nothing leaves the device until Send / Find precedent.
- Schema changes go through Alembic; new head `y0a1b2c3d4e5` must be recorded in `AGENTS.md`.
- All extension fetches go through `extension/src/lib/api.ts`; snake_case → camelCase mapping happens there.
- New backend routes are documented in `README.md` with their auth behaviour.
- Backend tests: `cd backend && .venv/bin/python -m unittest tests.<module> -v`. Extension tests: `cd extension && bun run test`. Extension typecheck/build: `cd extension && bun run build`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

Backend
- Create `backend/migrations/versions/y0a1b2c3d4e5_add_retrieval_audit_and_execution_status.py` — audit table + `documents.execution_status`.
- Modify `backend/app/models.py` — `Document.execution_status`, new `RetrievalAuditEvent`.
- Create `backend/app/services/audit_service.py` — `record_retrieval`.
- Create `backend/app/services/elitigation_service.py` — HTTP + HTML parsing for eLitigation.
- Create `backend/app/services/case_law_service.py` — decides when to search, formats sources for the prompt, citation guard.
- Modify `backend/app/services/birdie_service.py` — case-law rule in the prompt, `case_sources` parameter.
- Modify `backend/app/routers/birdie.py` — `sources` SSE event, citation warning.
- Create `backend/app/services/precedent_service.py` — classify, extract, summarise, search, payload.
- Create `backend/app/routers/precedent.py`; modify `backend/app/routers/__init__.py`; modify `backend/app/schemas.py`.
- Modify `backend/requirements.txt` — `beautifulsoup4`.
- Tests: `backend/tests/test_audit_service.py`, `test_elitigation_service.py`, `test_case_law_service.py`, `test_precedent_service.py`, fixtures in `backend/tests/fixtures/`.

Extension
- Create `extension/src/content/selection.ts` — content script (import-free).
- Create `extension/src/lib/sites.ts` — per-site enablement + content-script registration.
- Create `extension/src/lib/selection.ts` — validates selection messages.
- Create `extension/src/lib/conversation.ts` — session persistence of turns.
- Modify `extension/src/lib/pageText.ts` — split into `getActiveTab` + `readTabText` (no permission prompt).
- Modify `extension/src/lib/sse.ts`, `extension/src/lib/api.ts`, `extension/src/lib/config.ts`.
- Modify `extension/src/background.ts`, `extension/vite.config.ts`.
- Create `extension/src/sidepanel/useBrowserContext.ts`, `ContextChips.tsx`, `ModelView.tsx`, `PrecedentTab.tsx`, `CasesList.tsx`.
- Modify `extension/src/sidepanel/BirdieSidePanel.tsx` — orchestration only.
- Tests: `extension/src/lib/sites.test.ts`, `selection.test.ts`, `conversation.test.ts`, `api.test.ts`, `models.test.ts`.

Docs: `README.md`, `AGENTS.md`.

---

### Task 1: Retrieval audit log and document execution status

**Files:**
- Create: `backend/migrations/versions/y0a1b2c3d4e5_add_retrieval_audit_and_execution_status.py`
- Modify: `backend/app/models.py` (class `Document`, after `team_id`; new class after `KnowledgeBankAccessLog`)
- Create: `backend/app/services/audit_service.py`
- Test: `backend/tests/test_audit_service.py`
- Modify: `AGENTS.md` (two "Current head" lines)

**Interfaces:**
- Produces: `record_retrieval(db: Session, *, user_id: str, kind: str, query: str, returned_ids: list[str]) -> RetrievalAuditEvent`; `Document.execution_status: str | None` (`"draft"` / `"executed"` / `None`).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_audit_service.py`:

```python
import unittest
from unittest.mock import MagicMock

from app.models import RetrievalAuditEvent
from app.services.audit_service import MAX_QUERY_CHARS, record_retrieval


class RecordRetrievalTests(unittest.TestCase):
    def test_adds_and_commits_event(self) -> None:
        db = MagicMock()
        event = record_retrieval(
            db, user_id="u1", kind="precedent_search", query="option period", returned_ids=["c1", "k2"]
        )
        self.assertIsInstance(event, RetrievalAuditEvent)
        self.assertEqual(event.user_id, "u1")
        self.assertEqual(event.kind, "precedent_search")
        self.assertEqual(event.returned_ids, ["c1", "k2"])
        db.add.assert_called_once_with(event)
        db.commit.assert_called_once()

    def test_truncates_long_queries(self) -> None:
        event = record_retrieval(MagicMock(), user_id="u1", kind="case_search", query="x" * 5000, returned_ids=[])
        self.assertEqual(len(event.query), MAX_QUERY_CHARS)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m unittest tests.test_audit_service -v`
Expected: FAIL — `ImportError: cannot import name 'RetrievalAuditEvent'`.

- [ ] **Step 3: Add the model fields**

In `backend/app/models.py`, inside `class Document`, directly after the `team_id` column:

```python
    # "executed" (signed) or "draft"; None when unknown. Precedent ranks executed first.
    execution_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
```

After `class KnowledgeBankAccessLog` (ends with `user: Mapped[User] = relationship()`), add:

```python
class RetrievalAuditEvent(Base):
    """Who searched what, and which sources came back (precedent and eLitigation lookups)."""

    __tablename__ = "retrieval_audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    query: Mapped[str] = mapped_column(Text, nullable=False)
    returned_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
```

- [ ] **Step 4: Write the service**

`backend/app/services/audit_service.py`:

```python
"""Retrieval audit log: firms ask who queried what and which documents came back."""

from sqlalchemy.orm import Session

from app.models import RetrievalAuditEvent

MAX_QUERY_CHARS = 2000


def record_retrieval(
    db: Session,
    *,
    user_id: str,
    kind: str,
    query: str,
    returned_ids: list[str],
) -> RetrievalAuditEvent:
    event = RetrievalAuditEvent(
        user_id=user_id,
        kind=kind,
        query=query[:MAX_QUERY_CHARS],
        returned_ids=list(returned_ids),
    )
    db.add(event)
    db.commit()
    return event
```

- [ ] **Step 5: Write the migration**

`backend/migrations/versions/y0a1b2c3d4e5_add_retrieval_audit_and_execution_status.py`:

```python
"""add retrieval audit events and document execution status

Revision ID: y0a1b2c3d4e5
Revises: x9a0b1c2d3e4
Create Date: 2026-10-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "y0a1b2c3d4e5"
down_revision: str | None = "x9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("execution_status", sa.String(16), nullable=True))
    op.create_table(
        "retrieval_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("returned_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_retrieval_audit_events_user_id", "retrieval_audit_events", ["user_id"])
    op.create_index("ix_retrieval_audit_events_kind", "retrieval_audit_events", ["kind"])


def downgrade() -> None:
    op.drop_index("ix_retrieval_audit_events_kind", table_name="retrieval_audit_events")
    op.drop_index("ix_retrieval_audit_events_user_id", table_name="retrieval_audit_events")
    op.drop_table("retrieval_audit_events")
    op.drop_column("documents", "execution_status")
```

- [ ] **Step 6: Run test and migration**

Run: `cd backend && .venv/bin/python -m unittest tests.test_audit_service -v`
Expected: 2 tests OK.

Run: `cd backend && docker compose -f ../docker-compose.yml up -d && .venv/bin/alembic upgrade head && .venv/bin/alembic current`
Expected: `y0a1b2c3d4e5 (head)`.

- [ ] **Step 7: Update AGENTS.md head**

Replace both occurrences of `x9a0b1c2d3e4` in `AGENTS.md` with `y0a1b2c3d4e5`:

Run: `sed -i '' 's/x9a0b1c2d3e4/y0a1b2c3d4e5/g' AGENTS.md && grep -n y0a1b2c3d4e5 AGENTS.md`
Expected: two lines (repo shape comment and "Current head").

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/app/services/audit_service.py backend/migrations/versions/y0a1b2c3d4e5_add_retrieval_audit_and_execution_status.py backend/tests/test_audit_service.py AGENTS.md
git commit -m "feat(backend): retrieval audit log and document execution status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: eLitigation search and judgment excerpts

**Files:**
- Modify: `backend/requirements.txt` (append `beautifulsoup4>=4.12`)
- Create: `backend/app/services/elitigation_service.py`
- Create: `backend/tests/fixtures/elitigation_search.html`, `backend/tests/fixtures/elitigation_judgment.html`
- Test: `backend/tests/test_elitigation_service.py`

**Interfaces:**
- Produces:
  - `Judgment(citation: str, title: str, decision_date: str | None, url: str, catchwords: list[str])` (frozen dataclass)
  - `JudgmentExcerpt(judgment: Judgment, paragraphs: list[tuple[str, str]])` — `(paragraph number, text)`
  - `ElitigationError(Exception)`
  - `parse_search_results(html: str, limit: int) -> list[Judgment]`
  - `parse_judgment_paragraphs(html: str) -> list[tuple[str, str]]`
  - `best_paragraphs(paragraphs, query: str, max_chars: int = MAX_EXCERPT_CHARS) -> list[tuple[str, str]]`
  - `async search_judgments(query: str, limit: int = 5) -> list[Judgment]`
  - `async fetch_judgment_excerpt(judgment: Judgment, query: str) -> JudgmentExcerpt`

- [ ] **Step 1: Install the dependency**

Append `beautifulsoup4>=4.12` to `backend/requirements.txt`.

Run: `cd backend && .venv/bin/pip install -r requirements.txt && .venv/bin/python -c "import bs4; print(bs4.__version__)"`
Expected: a version ≥ 4.12.

- [ ] **Step 2: Add fixtures (trimmed from real eLitigation markup, captured 2026-10-05)**

`backend/tests/fixtures/elitigation_search.html`:

```html
<html><body>
<div class="card col-12">
  <div class="card-body gd p-2 ">
    <div class="gd-catchword-container">
      <a class="gd-cw" href="#">[Contract - Interpretation of force majeure clause - Meaning of word &quot;disrupted&quot;]</a>
      <a class="gd-cw" href="#">[Contract - Interpretation of force majeure clause - Event beyond the control of affected party]</a>
    </div>
    <div class="gd-card-body">
      <a target="_blank" title="Click here to read Judgment" href='/gd/s/2011_SGCA_1' class="h5 gd-heardertext">
        Holcim (Singapore) Pte Ltd v Precise Development Pte Ltd and another application
      </a>
      <br />
      <a href="#" class="citation-num-link" data-searchparam="&#34;[2011] SGCA 1&#34;">
        <span class="gd-addinfo-text">[2011] SGCA 1 |</span>
      </a>
      <a class="decision-date-link" data-searchparam="DecisionDate:&#34;2011-01-19&#34;" href="#">
        <span class="gd-addinfo-text"> Decision Date: 19 Jan 2011 | </span>
      </a>
    </div>
  </div>
</div>
<div class="card col-12">
  <div class="card-body gd p-2 ">
    <div class="gd-card-body">
      <a href='/gd/s/2023_SGHCA_13' class="h5 gd-heardertext">Second Case v Another</a>
      <a href="#" class="citation-num-link"><span class="gd-addinfo-text">[2023] SGHCA 13 |</span></a>
    </div>
  </div>
</div>
<div class="card col-12">
  <div class="card-body gd p-2 ">
    <div class="gd-card-body">
      <a href='https://evil.example/gd/s/2020_SGHC_1' class="h5 gd-heardertext">Offsite link</a>
      <a href="#" class="citation-num-link"><span class="gd-addinfo-text">[2020] SGHC 1 |</span></a>
    </div>
  </div>
</div>
</body></html>
```

`backend/tests/fixtures/elitigation_judgment.html`:

```html
<html><body>
<p class="Judg-Author">Andrew Phang Boon Leong JA (delivering the judgment of the court):</p>
<p class="Judg-Heading-1">Introduction</p>
<p class="Judg-1"><a id="p1_1"></a>1       This is yet another case in a series of cases arising from the
  Indonesian sand ban of 2007. The crux of the present appeal turns on the interpretation of a
  <em>force majeure</em> clause.</p>
<p class="Judg-1"><a id="p1_2"></a>2       The facts are not in dispute.</p>
<p class="Judg-1"><a id="p1_3"></a>3       A force majeure clause must be construed according to its precise terms.</p>
</body></html>
```

- [ ] **Step 3: Write the failing tests**

`backend/tests/test_elitigation_service.py`:

```python
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import elitigation_service as el

FIXTURES = Path(__file__).parent / "fixtures"
SEARCH_HTML = (FIXTURES / "elitigation_search.html").read_text()
JUDGMENT_HTML = (FIXTURES / "elitigation_judgment.html").read_text()


class ParseSearchResultsTests(unittest.TestCase):
    def test_parses_first_card_verbatim(self) -> None:
        first = el.parse_search_results(SEARCH_HTML, limit=5)[0]
        self.assertEqual(first.citation, "[2011] SGCA 1")
        self.assertEqual(
            first.title, "Holcim (Singapore) Pte Ltd v Precise Development Pte Ltd and another application"
        )
        self.assertEqual(first.decision_date, "2011-01-19")
        self.assertEqual(first.url, "https://www.elitigation.sg/gd/s/2011_SGCA_1")
        self.assertEqual(len(first.catchwords), 2)
        self.assertTrue(first.catchwords[0].startswith("Contract - Interpretation"))

    def test_missing_date_is_none_and_offsite_links_skipped(self) -> None:
        results = el.parse_search_results(SEARCH_HTML, limit=5)
        self.assertEqual([r.citation for r in results], ["[2011] SGCA 1", "[2023] SGHCA 13"])
        self.assertIsNone(results[1].decision_date)

    def test_respects_limit(self) -> None:
        self.assertEqual(len(el.parse_search_results(SEARCH_HTML, limit=1)), 1)


class JudgmentParagraphTests(unittest.TestCase):
    def test_extracts_numbered_paragraphs(self) -> None:
        paragraphs = el.parse_judgment_paragraphs(JUDGMENT_HTML)
        self.assertEqual([number for number, _ in paragraphs], ["1", "2", "3"])
        self.assertTrue(paragraphs[0][1].startswith("This is yet another case"))

    def test_best_paragraphs_keeps_matching_in_order(self) -> None:
        paragraphs = el.parse_judgment_paragraphs(JUDGMENT_HTML)
        best = el.best_paragraphs(paragraphs, "force majeure clause")
        self.assertEqual([number for number, _ in best], ["1", "3"])

    def test_best_paragraphs_respects_char_budget(self) -> None:
        paragraphs = [("1", "force " * 50), ("2", "force " * 50)]
        self.assertEqual(len(el.best_paragraphs(paragraphs, "force", max_chars=400)), 1)


class SearchJudgmentsTests(unittest.IsolatedAsyncioTestCase):
    async def test_sends_only_the_phrase(self) -> None:
        with patch.object(el, "_get", return_value=SEARCH_HTML) as get:
            results = await el.search_judgments("penalty clause", limit=2)
        url, params = get.call_args.args
        self.assertEqual(url, el.SEARCH_URL)
        self.assertEqual(params["SearchPhrase"], "penalty clause")
        self.assertEqual(len(results), 2)

    async def test_rejects_non_elitigation_judgment_url(self) -> None:
        judgment = el.Judgment("[2020] SGHC 1", "x", None, "https://evil.example/gd/s/2020_SGHC_1", [])
        with self.assertRaises(el.ElitigationError):
            await el.fetch_judgment_excerpt(judgment, "x")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m unittest tests.test_elitigation_service -v`
Expected: FAIL — `ImportError: cannot import name 'elitigation_service'`.

- [ ] **Step 5: Implement the service**

`backend/app/services/elitigation_service.py`:

```python
"""Searches eLitigation (https://www.elitigation.sg), Singapore's public court judgments site.

Only the search phrase leaves for eLitigation; no document or client text is sent there.
"""

import asyncio
import re
import time
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.elitigation.sg"
SEARCH_URL = f"{BASE_URL}/gd/Home/Index"
USER_AGENT = "LexCatalyst-Birdie/0.1 (+https://lexcatalyst.pages.dev)"
TIMEOUT_SECONDS = 10
CACHE_TTL_SECONDS = 3600
MAX_EXCERPT_CHARS = 4000

_JUDGMENT_PATH = re.compile(r"^/gd/s/\d{4}_[A-Z]+_\d+$")
_DECISION_DATE = re.compile(r'DecisionDate:"(\d{4}-\d{2}-\d{2})"')
_PARAGRAPH_NUMBER = re.compile(r"^(\d+)\s+(.*)$", re.S)
_WORD = re.compile(r"[a-z]{3,}")

_cache: dict[str, tuple[float, str]] = {}


class ElitigationError(Exception):
    pass


@dataclass(frozen=True)
class Judgment:
    citation: str
    title: str
    decision_date: str | None
    url: str
    catchwords: list[str]


@dataclass(frozen=True)
class JudgmentExcerpt:
    judgment: Judgment
    paragraphs: list[tuple[str, str]]


def _clean(text: str) -> str:
    return " ".join(text.split())


def _get(url: str, params: dict[str, str] | None = None) -> str:
    key = f"{url}?{sorted((params or {}).items())!r}"
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]
    try:
        response = requests.get(
            url, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ElitigationError(f"eLitigation request failed: {exc}") from exc
    _cache[key] = (time.monotonic(), response.text)
    return response.text


def parse_search_results(html: str, limit: int) -> list[Judgment]:
    soup = BeautifulSoup(html, "html.parser")
    results: list[Judgment] = []
    for card in soup.select("div.card-body.gd"):
        link = card.select_one("a.gd-heardertext")
        href = str(link.get("href", "")) if link else ""
        if not link or not _JUDGMENT_PATH.match(href):
            continue
        citation_el = card.select_one("a.citation-num-link")
        citation = _clean(citation_el.get_text()).rstrip("|").strip() if citation_el else ""
        if not citation:
            continue
        date_el = card.select_one("a.decision-date-link")
        date_match = _DECISION_DATE.search(str(date_el.get("data-searchparam", ""))) if date_el else None
        results.append(
            Judgment(
                citation=citation,
                title=_clean(link.get_text()),
                decision_date=date_match.group(1) if date_match else None,
                url=f"{BASE_URL}{href}",
                catchwords=[_clean(a.get_text()).strip("[]") for a in card.select("a.gd-cw")],
            )
        )
        if len(results) >= limit:
            break
    return results


def parse_judgment_paragraphs(html: str) -> list[tuple[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    paragraphs: list[tuple[str, str]] = []
    for p in soup.select("p.Judg-1"):
        match = _PARAGRAPH_NUMBER.match(_clean(p.get_text(" ")))
        if match:
            paragraphs.append((match.group(1), match.group(2)))
    return paragraphs


def best_paragraphs(
    paragraphs: list[tuple[str, str]], query: str, max_chars: int = MAX_EXCERPT_CHARS
) -> list[tuple[str, str]]:
    terms = set(_WORD.findall(query.lower()))
    scored = [
        (len(terms & set(_WORD.findall(text.lower()))), index)
        for index, (_, text) in enumerate(paragraphs)
    ]
    chosen: list[int] = []
    used = 0
    for score, index in sorted(scored, key=lambda item: (-item[0], item[1])):
        if score == 0:
            break
        length = len(paragraphs[index][1])
        if used + length > max_chars:
            continue
        chosen.append(index)
        used += length
    return [paragraphs[index] for index in sorted(chosen)]


async def search_judgments(query: str, limit: int = 5) -> list[Judgment]:
    params = {
        "Filter": "SUPCT",
        "YearOfDecision": "All",
        "SortBy": "Score",
        "SearchPhrase": query,
        "CurrentPage": "1",
        "SortAscending": "False",
        "PageSize": "0",
        "Verbose": "False",
        "SearchQueryTime": "0",
        "SearchTotalHits": "0",
        "SearchMode": "True",
        "SpanMultiplePage": "False",
    }
    html = await asyncio.to_thread(_get, SEARCH_URL, params)
    return parse_search_results(html, limit)


async def fetch_judgment_excerpt(judgment: Judgment, query: str) -> JudgmentExcerpt:
    if not judgment.url.startswith(f"{BASE_URL}/gd/s/"):
        raise ElitigationError(f"Not an eLitigation judgment URL: {judgment.url}")
    html = await asyncio.to_thread(_get, judgment.url)
    return JudgmentExcerpt(judgment, best_paragraphs(parse_judgment_paragraphs(html), query))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m unittest tests.test_elitigation_service -v`
Expected: 8 tests OK.

- [ ] **Step 7: Live smoke check (network)**

Run: `cd backend && .venv/bin/python -c "import asyncio; from app.services.elitigation_service import search_judgments as s; print([j.citation for j in asyncio.run(s('penalty clause', 3))])"`
Expected: a list of three neutral citations such as `['[2017] SGCA 46', ...]`. If it prints `[]`, the markup has changed — re-capture a fixture and fix the selectors before continuing.

- [ ] **Step 8: Commit**

```bash
git add backend/requirements.txt backend/app/services/elitigation_service.py backend/tests/test_elitigation_service.py backend/tests/fixtures/
git commit -m "feat(backend): eLitigation judgment search and excerpts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ground Birdie's case law in eLitigation

**Files:**
- Create: `backend/app/services/case_law_service.py`
- Modify: `backend/app/services/birdie_service.py`
- Modify: `backend/app/routers/birdie.py`
- Test: `backend/tests/test_case_law_service.py`

**Interfaces:**
- Consumes: Task 1 `record_retrieval`; Task 2 `search_judgments`, `fetch_judgment_excerpt`, `ElitigationError`, `Judgment`.
- Produces:
  - `CaseSource(citation: str, title: str, decision_date: str | None, url: str, paragraphs: list[tuple[str, str]])`
  - `parse_search_phrase(raw: str) -> str | None`
  - `async find_case_sources(db, *, user: User, provider, user_message: str, web_text: str) -> list[CaseSource]`
  - `format_case_sources(sources: list[CaseSource]) -> str`
  - `validate_case_citations(answer: str, sources: list[CaseSource]) -> str | None`
  - `case_source_payload(source: CaseSource) -> dict` → `{"citation", "title", "decision_date", "url"}`
  - SSE event `sources` with data `{"cases": [case_source_payload, ...]}` emitted before the first `token`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_case_law_service.py`:

```python
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import case_law_service as cl
from app.services.elitigation_service import Judgment, JudgmentExcerpt

HOLCIM = cl.CaseSource(
    citation="[2011] SGCA 1",
    title="Holcim (Singapore) Pte Ltd v Precise Development Pte Ltd",
    decision_date="2011-01-19",
    url="https://www.elitigation.sg/gd/s/2011_SGCA_1",
    paragraphs=[("3", "A force majeure clause must be construed according to its precise terms.")],
)


class ParseSearchPhraseTests(unittest.TestCase):
    def test_reads_phrase(self) -> None:
        self.assertEqual(cl.parse_search_phrase('{"search": "penalty clause"}'), "penalty clause")

    def test_tolerates_code_fences(self) -> None:
        self.assertEqual(cl.parse_search_phrase('```json\n{"search": "force majeure"}\n```'), "force majeure")

    def test_null_blank_and_garbage_are_none(self) -> None:
        self.assertIsNone(cl.parse_search_phrase('{"search": null}'))
        self.assertIsNone(cl.parse_search_phrase('{"search": "  "}'))
        self.assertIsNone(cl.parse_search_phrase("no json here"))


class FormatAndValidateTests(unittest.TestCase):
    def test_format_lists_citation_url_and_paragraph(self) -> None:
        block = cl.format_case_sources([HOLCIM])
        self.assertIn("[2011] SGCA 1", block)
        self.assertIn("https://www.elitigation.sg/gd/s/2011_SGCA_1", block)
        self.assertIn("[para 3]", block)
        self.assertIn("ONLY", block)

    def test_format_empty_is_empty(self) -> None:
        self.assertEqual(cl.format_case_sources([]), "")

    def test_known_citation_passes(self) -> None:
        self.assertIsNone(cl.validate_case_citations("See [2011]  SGCA 1 at [3].", [HOLCIM]))

    def test_unknown_citation_is_flagged(self) -> None:
        warning = cl.validate_case_citations("See [2015] SGCA 33.", [HOLCIM])
        self.assertIsNotNone(warning)
        self.assertIn("[2015] SGCA 33", warning)

    def test_payload_shape(self) -> None:
        self.assertEqual(
            cl.case_source_payload(HOLCIM),
            {
                "citation": "[2011] SGCA 1",
                "title": HOLCIM.title,
                "decision_date": "2011-01-19",
                "url": HOLCIM.url,
            },
        )


class FindCaseSourcesTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_search_when_model_says_no(self) -> None:
        provider = MagicMock(complete=AsyncMock(return_value='{"search": null}'))
        with patch.object(cl, "search_judgments", AsyncMock()) as search:
            result = await cl.find_case_sources(
                MagicMock(), user=MagicMock(id="u1"), provider=provider, user_message="hi", web_text=""
            )
        self.assertEqual(result, [])
        search.assert_not_called()

    async def test_searches_excerpts_and_audits(self) -> None:
        judgment = Judgment("[2011] SGCA 1", "Holcim", "2011-01-19", HOLCIM.url, [])
        provider = MagicMock(complete=AsyncMock(return_value='{"search": "force majeure"}'))
        with (
            patch.object(cl, "search_judgments", AsyncMock(return_value=[judgment])),
            patch.object(
                cl, "fetch_judgment_excerpt", AsyncMock(return_value=JudgmentExcerpt(judgment, HOLCIM.paragraphs))
            ),
            patch.object(cl, "record_retrieval") as audit,
        ):
            result = await cl.find_case_sources(
                MagicMock(), user=MagicMock(id="u1"), provider=provider, user_message="force majeure?", web_text=""
            )
        self.assertEqual([s.citation for s in result], ["[2011] SGCA 1"])
        self.assertEqual(result[0].paragraphs, HOLCIM.paragraphs)
        self.assertEqual(audit.call_args.kwargs["kind"], "case_search")
        self.assertEqual(audit.call_args.kwargs["returned_ids"], ["[2011] SGCA 1"])

    async def test_planner_failure_returns_empty(self) -> None:
        provider = MagicMock(complete=AsyncMock(side_effect=RuntimeError("down")))
        result = await cl.find_case_sources(
            MagicMock(), user=MagicMock(id="u1"), provider=provider, user_message="x", web_text=""
        )
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m unittest tests.test_case_law_service -v`
Expected: FAIL — `ImportError: cannot import name 'case_law_service'`.

- [ ] **Step 3: Implement the service**

`backend/app/services/case_law_service.py`:

```python
"""Grounds Birdie's case law in eLitigation: Birdie may only cite judgments found there.

The planning prompt (user message + up to 2,000 chars of shared web text) goes to the user's Birdie
provider; only the resulting search phrase goes to eLitigation.
"""

import asyncio
import json
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import User
from app.services.audit_service import record_retrieval
from app.services.elitigation_service import (
    ElitigationError,
    JudgmentExcerpt,
    fetch_judgment_excerpt,
    search_judgments,
)

CASE_LAW_RULE = (
    "Case law rule: only cite cases listed under 'eLitigation sources'. Copy each citation exactly and "
    "link its URL. If no source is listed or none supports the point, say you couldn't find a supporting "
    "case on eLitigation. Never cite a case from memory."
)

_PLANNER_PROMPT = (
    "Decide whether answering the user's message needs Singapore case law or court judgments. "
    'Reply with JSON only: {"search": "<3-8 word eLitigation search phrase>"} or {"search": null}.'
)

_NEUTRAL_CITATION = re.compile(r"\[\d{4}\]\s+SG[A-Z]+\s+\d+")
_JSON_OBJECT = re.compile(r"\{.*\}", re.S)
EXCERPT_JUDGMENTS = 3


@dataclass(frozen=True)
class CaseSource:
    citation: str
    title: str
    decision_date: str | None
    url: str
    paragraphs: list[tuple[str, str]]


def _normalise_citation(citation: str) -> str:
    return " ".join(citation.split())


def parse_search_phrase(raw: str) -> str | None:
    match = _JSON_OBJECT.search(raw)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except ValueError:
        return None
    phrase = payload.get("search") if isinstance(payload, dict) else None
    if not isinstance(phrase, str) or not phrase.strip():
        return None
    return phrase.strip()[:200]


async def _plan_search(provider, user_message: str, web_text: str) -> str | None:
    content = user_message if not web_text else f"{user_message}\n\nShared text:\n{web_text[:2000]}"
    try:
        raw = await provider.complete(
            [{"role": "system", "content": _PLANNER_PROMPT}, {"role": "user", "content": content}]
        )
    except Exception as exc:
        print(f"Case-law planner skipped: {exc!r}")
        return None
    return parse_search_phrase(raw)


async def find_case_sources(
    db: Session,
    *,
    user: User,
    provider,
    user_message: str,
    web_text: str,
) -> list[CaseSource]:
    phrase = await _plan_search(provider, user_message, web_text)
    if not phrase:
        return []
    try:
        judgments = await search_judgments(phrase, limit=5)
    except ElitigationError as exc:
        print(f"eLitigation search failed: {exc}")
        return []
    excerpts = await asyncio.gather(
        *(fetch_judgment_excerpt(j, phrase) for j in judgments[:EXCERPT_JUDGMENTS]),
        return_exceptions=True,
    )
    paragraphs_by_url = {
        e.judgment.url: e.paragraphs for e in excerpts if isinstance(e, JudgmentExcerpt)
    }
    sources = [
        CaseSource(j.citation, j.title, j.decision_date, j.url, paragraphs_by_url.get(j.url, []))
        for j in judgments
    ]
    record_retrieval(
        db, user_id=user.id, kind="case_search", query=phrase, returned_ids=[s.citation for s in sources]
    )
    return sources


def format_case_sources(sources: list[CaseSource]) -> str:
    if not sources:
        return ""
    lines = ["\n\n---\neLitigation sources (the ONLY cases you may cite):"]
    for index, source in enumerate(sources, start=1):
        decided = f", decided {source.decision_date}" if source.decision_date else ""
        lines.append(f"[{index}] {source.citation} — {source.title}{decided} — {source.url}")
        lines.extend(f"  [para {number}] {text}" for number, text in source.paragraphs)
    return "\n".join(lines)


def validate_case_citations(answer: str, sources: list[CaseSource]) -> str | None:
    allowed = {_normalise_citation(s.citation) for s in sources}
    unknown = sorted({_normalise_citation(c) for c in _NEUTRAL_CITATION.findall(answer)} - allowed)
    if not unknown:
        return None
    return (
        f"\n\n> ⚠️ Not found in the eLitigation results for this answer: {', '.join(unknown)}. "
        "Do not rely on these citations."
    )


def case_source_payload(source: CaseSource) -> dict:
    return {
        "citation": source.citation,
        "title": source.title,
        "decision_date": source.decision_date,
        "url": source.url,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m unittest tests.test_case_law_service -v`
Expected: 11 tests OK.

- [ ] **Step 5: Wire into the Birdie prompt**

In `backend/app/services/birdie_service.py`:

Add import:

```python
from app.services.case_law_service import CASE_LAW_RULE, CaseSource, format_case_sources
```

Append the rule to the system prompt — replace the last line of `BIRDIE_SYSTEM_PROMPT`:

```python
If firm knowledge is provided in the context below, use it. If not, draw on general best practice and flag it as such."""
```

with:

```python
If firm knowledge is provided in the context below, use it. If not, draw on general best practice and flag it as such.

""" + CASE_LAW_RULE
```

Add `case_sources: list[CaseSource] | None = None,` as the last keyword parameter of both `build_birdie_messages` and `stream_birdie_response`. In `build_birdie_messages`, after `system_content += _format_web_context(web_context)`, add:

```python
    system_content += format_case_sources(case_sources or [])
```

In `stream_birdie_response`, pass `case_sources=case_sources,` into the `build_birdie_messages(...)` call.

- [ ] **Step 6: Emit sources and the citation warning from the router**

In `backend/app/routers/birdie.py` add imports:

```python
from app.services.birdie_provider import get_birdie_provider
from app.services.case_law_service import case_source_payload, find_case_sources, validate_case_citations
```

Replace the body of `stream()` from `try:` down to `yield event("done", {"content": full_response})` with:

```python
        try:
            case_sources = await find_case_sources(
                db,
                user=current_user,
                provider=get_birdie_provider(db, current_user),
                user_message=request.message,
                web_text=request.web_context.text if request.web_context else "",
            )
            if case_sources:
                yield event("sources", {"cases": [case_source_payload(s) for s in case_sources]})

            chunks: list[str] = []
            async for token in stream_birdie_response(
                db,
                user=current_user,
                user_message=request.message,
                history=[{"role": m.role, "content": m.content} for m in request.history],
                matter_id=request.matter_id,
                page_context=request.page_context,
                web_context=request.web_context,
                case_sources=case_sources,
            ):
                chunks.append(token)
                yield event("token", {"content": token})

            full_response = "".join(chunks).strip()
            if not full_response:
                yield event("error", {"detail": "Birdie returned an empty response"})
                return
            warning = validate_case_citations(full_response, case_sources)
            if warning:
                yield event("token", {"content": warning})
                full_response += warning
            yield event("done", {"content": full_response})
```

(The two `except` clauses stay unchanged.)

- [ ] **Step 7: Run all Birdie-related tests**

Run: `cd backend && .venv/bin/python -m unittest tests.test_case_law_service tests.test_birdie_web_context tests.test_birdie_lessons -v`
Expected: all OK.

- [ ] **Step 8: Manual stream check**

With the backend running (`cd backend && make dev`) and a JWT in `$TOKEN`:

Run: `curl -sN -X POST http://127.0.0.1:8000/birdie/stream -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"What is the Singapore test for a penalty clause? Cite cases."}' | head -5`
Expected: first event is `event: sources` with a `cases` array of eLitigation URLs, followed by `event: token` lines.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/case_law_service.py backend/app/services/birdie_service.py backend/app/routers/birdie.py backend/tests/test_case_law_service.py
git commit -m "feat(birdie): ground case law in eLitigation with citation guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Precedent clause classification and term extraction

**Files:**
- Create: `backend/app/services/precedent_service.py`
- Test: `backend/tests/test_precedent_service.py`

**Interfaces:**
- Produces:
  - `CLAUSE_TYPES: tuple[str, ...]`
  - `classify_clause(text: str) -> str`
  - `Term(kind: str, value: str, label: str)` (frozen dataclass; `kind` ∈ `days|percent|amount|jurisdiction`)
  - `extract_terms(text: str, clause_type: str) -> Term | None`
  - `summarise_terms(terms: list[Term | None]) -> list[dict]` → `[{"label": str, "count": int}]`, most frequent first

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_precedent_service.py`:

```python
import unittest

from app.services import precedent_service as ps


class ClassifyClauseTests(unittest.TestCase):
    def test_option_period(self) -> None:
        text = "The Option Period shall be fourteen (14) days within which the Purchaser may exercise the Option."
        self.assertEqual(ps.classify_clause(text), "option_period")

    def test_governing_law(self) -> None:
        self.assertEqual(
            ps.classify_clause("This Agreement shall be governed by the laws of Singapore."), "governing_law"
        )

    def test_unknown_is_other(self) -> None:
        self.assertEqual(ps.classify_clause("The parties met on Tuesday."), "other")


class ExtractTermsTests(unittest.TestCase):
    def test_days_with_words_and_digits(self) -> None:
        term = ps.extract_terms("fourteen (14) days after the date of grant", "option_period")
        self.assertEqual(term, ps.Term(kind="days", value="14", label="14 days"))

    def test_business_days(self) -> None:
        self.assertEqual(ps.extract_terms("within 5 business days", "notice").label, "5 business days")

    def test_percent(self) -> None:
        self.assertEqual(ps.extract_terms("capped at 10 per cent of fees", "limitation_of_liability").label, "10%")

    def test_amount(self) -> None:
        self.assertEqual(ps.extract_terms("not exceed S$500,000 in aggregate", "limitation_of_liability").label, "S$500,000")

    def test_jurisdiction_wins_for_governing_law(self) -> None:
        term = ps.extract_terms("within 30 days ... governed by the laws of the Republic of Singapore", "governing_law")
        self.assertEqual(term, ps.Term(kind="jurisdiction", value="Singapore", label="Singapore"))

    def test_none_when_no_variable(self) -> None:
        self.assertIsNone(ps.extract_terms("The parties shall cooperate.", "other"))


class SummariseTermsTests(unittest.TestCase):
    def test_counts_and_orders(self) -> None:
        d = lambda n: ps.Term("days", str(n), f"{n} days")
        summary = ps.summarise_terms([d(21), d(14), d(21), None, d(30), d(21), d(14)])
        self.assertEqual(
            summary,
            [{"label": "21 days", "count": 3}, {"label": "14 days", "count": 2}, {"label": "30 days", "count": 1}],
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m unittest tests.test_precedent_service -v`
Expected: FAIL — `ImportError: cannot import name 'precedent_service'`.

- [ ] **Step 3: Implement**

`backend/app/services/precedent_service.py`:

```python
"""Precedent: how has the firm drafted this clause before?

Classification and term extraction are rules-only, so no clause text is sent to an LLM.
Retrieval reuses the permission-scoped document and Knowledge Bank searches.
"""

import re
from collections import Counter
from dataclasses import dataclass

CLAUSE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "option_period": ("option period", "exercise the option", "option to purchase", "option fee", "grant of option"),
    "governing_law": ("governed by", "governing law", "laws of"),
    "limitation_of_liability": ("shall not be liable", "aggregate liability", "limitation of liability", "consequential loss", "liability"),
    "termination": ("terminate", "termination"),
    "confidentiality": ("confidential",),
    "payment_terms": ("shall pay", "invoice", "payment", "due date"),
    "notice": ("notice shall", "notices", "in writing to"),
}
CLAUSE_TYPES: tuple[str, ...] = (*CLAUSE_KEYWORDS, "other")

_DAYS = re.compile(r"\(?\b(\d{1,3})\)?\s+(?:(business|working|calendar)\s+)?days?\b", re.I)
_PERCENT = re.compile(r"\b(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s*cent\b|percent\b)", re.I)
_AMOUNT = re.compile(r"(S\$|US\$|SGD|USD|£|€|\$)\s?(\d[\d,]*(?:\.\d+)?)")
_JURISDICTION = re.compile(
    r"laws of (?:the )?(Republic of Singapore|Singapore|England and Wales|England|Hong Kong|New York|Malaysia)",
    re.I,
)
_JURISDICTION_NAMES = {"republic of singapore": "Singapore"}


@dataclass(frozen=True)
class Term:
    kind: str
    value: str
    label: str


def classify_clause(text: str) -> str:
    lowered = text.lower()
    best, best_hits = "other", 0
    for clause_type, keywords in CLAUSE_KEYWORDS.items():
        hits = sum(lowered.count(keyword) for keyword in keywords)
        if hits > best_hits:
            best, best_hits = clause_type, hits
    return best


def _days(text: str) -> Term | None:
    match = _DAYS.search(text)
    if not match:
        return None
    unit = f"{match.group(2).lower()} days" if match.group(2) else "days"
    return Term("days", match.group(1), f"{match.group(1)} {unit}")


def _percent(text: str) -> Term | None:
    match = _PERCENT.search(text)
    return Term("percent", match.group(1), f"{match.group(1)}%") if match else None


def _amount(text: str) -> Term | None:
    match = _AMOUNT.search(text)
    return Term("amount", match.group(2), f"{match.group(1)}{match.group(2)}") if match else None


def _jurisdiction(text: str) -> Term | None:
    match = _JURISDICTION.search(text)
    if not match:
        return None
    name = _JURISDICTION_NAMES.get(match.group(1).lower(), match.group(1))
    return Term("jurisdiction", name, name)


def extract_terms(text: str, clause_type: str) -> Term | None:
    extractors = (
        (_jurisdiction, _days, _percent, _amount)
        if clause_type == "governing_law"
        else (_days, _percent, _amount, _jurisdiction)
    )
    for extractor in extractors:
        term = extractor(text)
        if term:
            return term
    return None


def summarise_terms(terms: list[Term | None]) -> list[dict]:
    counts = Counter(term.label for term in terms if term)
    return [
        {"label": label, "count": count}
        for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m unittest tests.test_precedent_service -v`
Expected: 10 tests OK.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/precedent_service.py backend/tests/test_precedent_service.py
git commit -m "feat(precedent): rules-based clause classification and term extraction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Precedent search and `POST /precedent/search`

**Files:**
- Modify: `backend/app/services/precedent_service.py` (append)
- Modify: `backend/app/schemas.py` (append)
- Create: `backend/app/routers/precedent.py`
- Modify: `backend/app/routers/__init__.py`
- Modify: `backend/tests/test_precedent_service.py` (append)
- Modify: `README.md` (route docs)

**Interfaces:**
- Consumes: Task 1 `record_retrieval`, `Document.execution_status`; Task 4 `classify_clause`, `extract_terms`, `summarise_terms`, `Term`; existing `rag_service.search_documents(db, *, query, user_id, matter_id=None, limit=6) -> list[DocumentSearchResult]`, `knowledge_bank_service.search_kb_for_chat(db, *, user_id, query, matter_id, limit=6) -> list[KnowledgeBankEntry]`.
- Produces:
  - `PrecedentResult(id, source_type, excerpt, document_title, matter_ref, date, author, status, document_id, term)` (frozen dataclass)
  - `async search_precedents(db, *, user: User, text: str, limit: int = 8) -> tuple[str, list[PrecedentResult]]`
  - `precedent_payload(clause_type: str, results: list[PrecedentResult]) -> dict`
  - HTTP `POST /precedent/search` body `{"text": str (3–5000), "url": str | null}` → `PrecedentResponse`:
    `{"clause_type": str, "terms_summary": [{"label","count"}], "results": [{"id","source_type","excerpt","document_title","matter_ref","date","author","status","document_id","term"}]}` where `term` is `{"kind","value","label"} | null`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_precedent_service.py` (above `if __name__ == "__main__":`):

```python
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.rag_service import DocumentSearchResult


def _chunk(document_id: str, text: str) -> DocumentSearchResult:
    return DocumentSearchResult(
        chunk_id=f"c-{document_id}", document_id=document_id, filename=f"{document_id}.pdf",
        text=text, score=0.9, page_number=1, citation_label=f"{document_id}.pdf p.1",
    )


class SearchPrecedentsTests(unittest.IsolatedAsyncioTestCase):
    async def test_ranks_executed_first_and_anonymises_kb_matter(self) -> None:
        user = MagicMock(id="u1")
        meta = {
            "d-draft": ps.DocumentMeta("Draft SPA.pdf", "MAT-1", datetime(2025, 1, 2, tzinfo=UTC), "Alex", "draft"),
            "d-exec": ps.DocumentMeta("Signed SPA.pdf", "MAT-2", datetime(2024, 5, 6, tzinfo=UTC), "Sam", "executed"),
        }
        kb_entry = MagicMock(
            id="k1", title="Option clause precedent", body_markdown="Option Period of 30 days.",
            matter_id="m9", updated_at=datetime(2023, 3, 4, tzinfo=UTC), source_document_id=None,
        )
        kb_entry.creator.full_name = "Partner P"
        with (
            patch.object(ps, "search_documents", AsyncMock(return_value=[
                _chunk("d-draft", "Option Period of 14 days."), _chunk("d-exec", "Option Period of 21 days."),
            ])) as docs,
            patch.object(ps, "search_kb_for_chat", AsyncMock(return_value=[kb_entry])) as kb,
            patch.object(ps, "_load_document_meta", return_value=meta),
        ):
            clause_type, results = await ps.search_precedents(MagicMock(), user=user, text="The Option Period shall be 14 days")

        self.assertEqual(clause_type, "option_period")
        self.assertEqual([r.id for r in results], ["c-d-exec", "c-d-draft", "k1"])
        self.assertEqual(results[0].status, "executed")
        self.assertEqual(results[0].matter_ref, "MAT-2")
        self.assertEqual(results[2].matter_ref, "[MATTER]")
        self.assertEqual(results[2].term.label, "30 days")
        self.assertEqual(docs.call_args.kwargs["user_id"], "u1")
        self.assertIsNone(kb.call_args.kwargs["matter_id"])

    def test_payload_shape(self) -> None:
        result = ps.PrecedentResult(
            id="c1", source_type="document", excerpt="x", document_title="Signed SPA.pdf", matter_ref="MAT-2",
            date="2024-05-06", author="Sam", status="executed", document_id="d1",
            term=ps.Term("days", "21", "21 days"),
        )
        payload = ps.precedent_payload("option_period", [result])
        self.assertEqual(payload["terms_summary"], [{"label": "21 days", "count": 1}])
        self.assertEqual(payload["results"][0]["term"], {"kind": "days", "value": "21", "label": "21 days"})
        self.assertEqual(payload["results"][0]["document_id"], "d1")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m unittest tests.test_precedent_service -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'DocumentMeta'`.

- [ ] **Step 3: Implement search and payload**

Add to the imports at the top of `backend/app/services/precedent_service.py`:

```python
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, Matter, User
from app.services.knowledge_bank_service import search_kb_for_chat
from app.services.rag_service import search_documents
```

Append to the file:

```python
EXCERPT_CHARS = 600
_QUERY_CHARS = 2000


@dataclass(frozen=True)
class DocumentMeta:
    title: str
    matter_ref: str | None
    date: datetime | None
    author: str | None
    status: str | None


@dataclass(frozen=True)
class PrecedentResult:
    id: str
    source_type: str  # "document" | "knowledge_bank"
    excerpt: str
    document_title: str
    matter_ref: str | None
    date: str | None
    author: str | None
    status: str | None
    document_id: str | None
    term: Term | None


def _load_document_meta(db: Session, document_ids: list[str]) -> dict[str, DocumentMeta]:
    if not document_ids:
        return {}
    documents = list(db.scalars(select(Document).where(Document.id.in_(document_ids))))
    matter_ids = {d.matter_id for d in documents if d.matter_id}
    matters = (
        {m.id: m for m in db.scalars(select(Matter).where(Matter.id.in_(matter_ids)))} if matter_ids else {}
    )
    return {
        d.id: DocumentMeta(
            title=d.filename,
            matter_ref=matters[d.matter_id].case_number if d.matter_id in matters else None,
            date=d.created_at,
            author=d.user.full_name if d.user else None,
            status=d.execution_status,
        )
        for d in documents
    }


def _iso(value: datetime | None) -> str | None:
    return value.date().isoformat() if value else None


async def search_precedents(
    db: Session, *, user: User, text: str, limit: int = 8
) -> tuple[str, list[PrecedentResult]]:
    clause_type = classify_clause(text)
    query = text[:_QUERY_CHARS]
    # Documents: only the user's own or their matters' (document_access_filter inside search_documents).
    chunks = await search_documents(db, query=query, user_id=user.id, limit=limit)
    # KB: matter_id=None excludes matter-scoped entries; other scopes are clean/redacted.
    entries = await search_kb_for_chat(db, user_id=user.id, query=query, matter_id=None, limit=limit)
    meta = _load_document_meta(db, list({c.document_id for c in chunks}))

    results: list[PrecedentResult] = []
    for chunk in chunks:
        info = meta.get(chunk.document_id)
        if not info:
            continue  # no provenance, no suggestion
        results.append(
            PrecedentResult(
                id=chunk.chunk_id,
                source_type="document",
                excerpt=chunk.text[:EXCERPT_CHARS],
                document_title=info.title,
                matter_ref=info.matter_ref,
                date=_iso(info.date),
                author=info.author,
                status=info.status,
                document_id=chunk.document_id,
                term=extract_terms(chunk.text, clause_type),
            )
        )
    for entry in entries:
        results.append(
            PrecedentResult(
                id=entry.id,
                source_type="knowledge_bank",
                excerpt=entry.body_markdown[:EXCERPT_CHARS],
                document_title=entry.title,
                matter_ref="[MATTER]" if entry.matter_id else None,
                date=_iso(entry.updated_at),
                author=entry.creator.full_name if entry.creator else None,
                status=None,
                document_id=None,
                term=extract_terms(entry.body_markdown, clause_type),
            )
        )
    ranked = sorted(enumerate(results), key=lambda item: (item[1].status != "executed", item[0]))
    return clause_type, [result for _, result in ranked][:limit]


def precedent_payload(clause_type: str, results: list[PrecedentResult]) -> dict:
    return {
        "clause_type": clause_type,
        "terms_summary": summarise_terms([r.term for r in results]),
        "results": [
            {
                "id": r.id,
                "source_type": r.source_type,
                "excerpt": r.excerpt,
                "document_title": r.document_title,
                "matter_ref": r.matter_ref,
                "date": r.date,
                "author": r.author,
                "status": r.status,
                "document_id": r.document_id,
                "term": {"kind": r.term.kind, "value": r.term.value, "label": r.term.label} if r.term else None,
            }
            for r in results
        ],
    }
```

Note: if the KB result for a matter entry should never reach a non-member, `search_kb_for_chat(..., matter_id=None)` already excludes `scope == "matter"`; `[MATTER]` covers firm/team entries that still carry a `matter_id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m unittest tests.test_precedent_service -v`
Expected: 12 tests OK.

- [ ] **Step 5: Add schemas**

Append to `backend/app/schemas.py`:

```python
class PrecedentSearchRequest(BaseModel):
    text: str = Field(min_length=3, max_length=5000)
    url: str | None = Field(default=None, max_length=2048)


class PrecedentTermResponse(BaseModel):
    kind: str
    value: str
    label: str


class PrecedentTermCount(BaseModel):
    label: str
    count: int


class PrecedentResultResponse(BaseModel):
    id: str
    source_type: Literal["document", "knowledge_bank"]
    excerpt: str
    document_title: str
    matter_ref: str | None = None
    date: str | None = None
    author: str | None = None
    status: str | None = None
    document_id: str | None = None
    term: PrecedentTermResponse | None = None


class PrecedentSearchResponse(BaseModel):
    clause_type: str
    terms_summary: list[PrecedentTermCount]
    results: list[PrecedentResultResponse]
```

- [ ] **Step 6: Add the router and register it**

`backend/app/routers/precedent.py`:

```python
"""Precedent: the firm's past drafting of the highlighted clause. Signed-in users only."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import PrecedentSearchRequest, PrecedentSearchResponse
from app.services.audit_service import record_retrieval
from app.services.precedent_service import precedent_payload, search_precedents

router = APIRouter(tags=["precedent"])


@router.post("/precedent/search", response_model=PrecedentSearchResponse)
async def precedent_search(
    body: PrecedentSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    clause_type, results = await search_precedents(db, user=current_user, text=body.text)
    record_retrieval(
        db,
        user_id=current_user.id,
        kind="precedent_search",
        query=body.text,
        returned_ids=[r.id for r in results],
    )
    return precedent_payload(clause_type, results)
```

In `backend/app/routers/__init__.py` add `precedent,` to the import list (alphabetically after `organizations,`) and `precedent.router,` to `all_routers` after `birdie.router,`.

- [ ] **Step 7: Smoke test the route**

Run: `cd backend && make dev` (separate terminal), then
`curl -s -X POST http://127.0.0.1:8000/precedent/search -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"text":"The Option Period shall be fourteen (14) days"}' | python3 -m json.tool | head -20`
Expected: JSON with `"clause_type": "option_period"`, a `terms_summary` list and `results` (may be empty on an empty DB). Without the header: `401`.

- [ ] **Step 8: Document the route**

In `README.md`, in the route table under "### Birdie — Stateless Mentor Agent" (near the `DELETE /settings/birdie/openrouter-key` row), add:

```markdown
| `POST /precedent/search` | signed-in user | classify the highlighted clause and return the firm's past versions from the user's own/matter documents and clean or redacted KB entries, with source, matter ref, date, author and draft/executed status; logged to `retrieval_audit_events` |
```

and under it add a paragraph:

```markdown
`POST /birdie/stream` may first emit `event: sources` with `{"cases": [{citation, title, decision_date, url}]}`. Birdie only cites judgments from eLitigation (https://www.elitigation.sg): it searches eLitigation with a short phrase (no document or client text is sent there) and appends a warning if its answer contains a neutral citation that was not in the results. Each lookup is logged to `retrieval_audit_events`.
```

- [ ] **Step 9: Run the whole backend suite and commit**

Run: `cd backend && .venv/bin/python -m unittest discover -s tests -v 2>&1 | tail -3`
Expected: `OK`.

```bash
git add backend/app/services/precedent_service.py backend/app/schemas.py backend/app/routers/precedent.py backend/app/routers/__init__.py backend/tests/test_precedent_service.py README.md
git commit -m "feat(precedent): permission-scoped precedent search endpoint with audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Per-site switch, selection content script, and Google Docs spike

**Files:**
- Create: `extension/src/content/selection.ts`
- Create: `extension/src/lib/sites.ts`, `extension/src/lib/sites.test.ts`
- Create: `extension/src/lib/selection.ts`, `extension/src/lib/selection.test.ts`
- Modify: `extension/src/lib/pageText.ts`
- Modify: `extension/src/background.ts`
- Modify: `extension/vite.config.ts`

**Interfaces:**
- Produces:
  - Content script output file `content-selection.js`, which sends `{type: 'birdie-selection', text: string, url: string, title: string}` via `chrome.runtime.sendMessage`.
  - `SELECTION_MESSAGE = 'birdie-selection'`
  - `selectionFromMessage(message: unknown, senderTabId: number | undefined, activeTabId: number | undefined): WebContext | null | undefined` — `undefined` = ignore, `null` = selection cleared.
  - `originPattern(url: string): string | null`
  - `isSiteEnabled(url: string): Promise<boolean>`
  - `enableSite(url: string): Promise<boolean>` (call first thing in a click handler)
  - `syncContentScripts(): Promise<void>`
  - `injectSelectionScript(tabId: number): Promise<void>`
  - `isGoogleDoc(url: string): boolean`
  - `getActiveTab(): Promise<ActiveTab | null>` with `ActiveTab = { id: number; url: string; title: string }`
  - `readTabText(tab: ActiveTab): Promise<{ url: string; title: string; text: string }>` (no permission prompt)

- [ ] **Step 1: Write the failing tests**

`extension/src/lib/sites.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { originPattern } from './sites'

describe('originPattern', () => {
  it('builds an origin match pattern', () => {
    expect(originPattern('https://docs.google.com/document/d/abc/edit')).toBe('https://docs.google.com/*')
  })

  it('keeps a port', () => {
    expect(originPattern('http://localhost:5173/x')).toBe('http://localhost:5173/*')
  })

  it('rejects non-web urls', () => {
    expect(originPattern('chrome://extensions')).toBeNull()
    expect(originPattern('not a url')).toBeNull()
  })
})
```

`extension/src/lib/selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SELECTION_MESSAGE, selectionFromMessage } from './selection'

const msg = (text: string) => ({ type: SELECTION_MESSAGE, text, url: 'https://a.com/x', title: 'A' })

describe('selectionFromMessage', () => {
  it('builds selection context from the active tab', () => {
    expect(selectionFromMessage(msg(' Clause 4 '), 7, 7)).toMatchObject({ text: 'Clause 4', source: 'selection' })
  })

  it('returns null when the selection is cleared', () => {
    expect(selectionFromMessage(msg('  '), 7, 7)).toBeNull()
  })

  it('ignores other tabs and other messages', () => {
    expect(selectionFromMessage(msg('x'), 8, 7)).toBeUndefined()
    expect(selectionFromMessage({ type: 'other' }, 7, 7)).toBeUndefined()
    expect(selectionFromMessage(null, 7, 7)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extension && bun run test`
Expected: FAIL — cannot resolve `./sites` and `./selection`.

- [ ] **Step 3: Implement `selection.ts`**

`extension/src/lib/selection.ts`:

```ts
import { buildWebContext, type WebContext } from './webContext'

// Keep in sync with MESSAGE_TYPE in src/content/selection.ts (content scripts cannot import).
export const SELECTION_MESSAGE = 'birdie-selection'

type SelectionMessage = { type: string; text: string; url: string; title: string }

function isSelectionMessage(message: unknown): message is SelectionMessage {
  if (!message || typeof message !== 'object') return false
  const m = message as Record<string, unknown>
  return m.type === SELECTION_MESSAGE && typeof m.text === 'string' && typeof m.url === 'string'
}

// undefined: not for us. null: the user cleared their selection.
export function selectionFromMessage(
  message: unknown,
  senderTabId: number | undefined,
  activeTabId: number | undefined,
): WebContext | null | undefined {
  if (!isSelectionMessage(message) || senderTabId === undefined || senderTabId !== activeTabId) return undefined
  return buildWebContext({ url: message.url, title: message.title ?? '', text: message.text, source: 'selection' })
}
```

- [ ] **Step 4: Implement `sites.ts`**

`extension/src/lib/sites.ts`:

```ts
const SCRIPT_ID = 'birdie-selection'
const SCRIPT_FILE = 'content-selection.js'

export function originPattern(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return `${parsed.protocol}//${parsed.host}/*`
  } catch {
    return null
  }
}

export async function isSiteEnabled(url: string): Promise<boolean> {
  const pattern = originPattern(url)
  return pattern ? chrome.permissions.contains({ origins: [pattern] }) : false
}

// The API hosts are required permissions, not sites the user switched on.
async function enabledOrigins(): Promise<string[]> {
  const required = new Set(chrome.runtime.getManifest().host_permissions ?? [])
  const { origins = [] } = await chrome.permissions.getAll()
  return origins.filter((origin) => origin !== '<all_urls>' && !required.has(origin))
}

export async function syncContentScripts(): Promise<void> {
  const matches = await enabledOrigins()
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
  if (!matches.length) return
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: [SCRIPT_FILE],
      matches,
      allFrames: true, // Google Docs routes keyboard and clipboard through an about:blank iframe
      matchOriginAsFallback: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ])
}

// Must be the first await in a click handler: chrome.permissions.request needs the user gesture.
export async function enableSite(url: string): Promise<boolean> {
  const pattern = originPattern(url)
  if (!pattern) return false
  const granted = await chrome.permissions.request({ origins: [pattern] })
  if (granted) await syncContentScripts()
  return granted
}

// Registered scripts only reach pages loaded after registration; cover the tab already open.
export async function injectSelectionScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [SCRIPT_FILE] })
}
```

- [ ] **Step 5: Implement the content script**

`extension/src/content/selection.ts`:

```ts
// Runs only on sites the user switched Birdie on for. Must stay import-free: registered content
// scripts are classic scripts, so this file has to bundle to a single self-contained chunk.
const MESSAGE_TYPE = 'birdie-selection' // keep in sync with src/lib/selection.ts
const DEBOUNCE_MS = 300
const MAX_CHARS = 5000

const marker = window as unknown as { __birdieSelection?: boolean }
if (!marker.__birdieSelection) {
  marker.__birdieSelection = true
  let lastSent = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  const page = (): { url: string; title: string } => {
    try {
      return { url: window.top!.location.href, title: window.top!.document.title }
    } catch {
      return { url: location.href, title: document.title }
    }
  }

  const send = (raw: string) => {
    const text = raw.trim().slice(0, MAX_CHARS)
    if (text === lastSent) return
    lastSent = text
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE, text, ...page() }).catch(() => {})
    } catch {
      // Extension reloaded: this orphaned script can no longer reach the side panel.
    }
  }

  if (page().url.startsWith('https://docs.google.com/document/')) {
    // Docs paints text on a canvas, so getSelection() is empty. Copy (⌘C / Ctrl+C) carries the text.
    document.addEventListener('copy', (event) => {
      const text = event.clipboardData?.getData('text/plain') || document.getSelection()?.toString() || ''
      if (text.trim()) send(text)
    })
  } else {
    document.addEventListener('selectionchange', () => {
      clearTimeout(timer)
      timer = setTimeout(() => send(document.getSelection()?.toString() ?? ''), DEBOUNCE_MS)
    })
  }
}
```

- [ ] **Step 6: Split `pageText.ts`**

Replace `extension/src/lib/pageText.ts` from the line `// Must be called directly from a click handler...` to the end of the file with:

```ts
export type ActiveTab = { id: number; url: string; title: string }

export function isGoogleDoc(url: string): boolean {
  return GOOGLE_DOC_URL.test(url)
}

export async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null
  return { id: tab.id, url: tab.url, title: tab.title ?? tab.url }
}

// Needs host permission for the tab's origin (see sites.ts); never prompts.
export async function readTabText(tab: ActiveTab): Promise<{ url: string; title: string; text: string }> {
  const docText = await readGoogleDoc(tab.url)
  if (docText) return { url: tab.url, title: tab.title, text: docText }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body?.innerText ?? '',
    })
    return { url: tab.url, title: tab.title, text: String(result?.result ?? '') }
  } catch {
    throw new Error(CANT_READ)
  }
}
```

- [ ] **Step 7: Build the content script and keep registrations in sync**

In `extension/vite.config.ts`, add to `rollupOptions.input`:

```ts
        'content-selection': resolve(__dirname, 'src/content/selection.ts'),
```

In `extension/src/background.ts` add `import { syncContentScripts } from './lib/sites'` and, after the `setPanelBehavior` line:

```ts
const resync = () => syncContentScripts().catch(console.error)
chrome.runtime.onStartup.addListener(resync)
chrome.permissions.onAdded.addListener(resync)
chrome.permissions.onRemoved.addListener(resync)
```

and call `resync()` as the last line inside the existing `chrome.runtime.onInstalled` listener.

- [ ] **Step 8: Keep the side panel compiling, then test and build**

`readActiveTabText` no longer exists, so update `handleReadPage` in `extension/src/sidepanel/BirdieSidePanel.tsx` (Task 11 rewrites this file later; this keeps every commit building). Replace the import `import { readActiveTabText } from '../lib/pageText'` with:

```ts
import { getActiveTab, readTabText } from '../lib/pageText'
import { enableSite } from '../lib/sites'
```

and the first line of the `try` block in `handleReadPage` (`const page = await readActiveTabText()`) with:

```ts
      const tab = await getActiveTab()
      if (!tab) throw new Error("Birdie can't read this page")
      if (!(await enableSite(tab.url))) throw new Error("Birdie can't read this page without permission")
      const page = await readTabText(tab)
```

Run: `cd extension && bun run test && bun run build && ls dist/content-selection.js && ! grep -q "^import" dist/content-selection.js && echo self-contained`
Expected: all vitest suites pass, build succeeds, last line prints `self-contained`.

- [ ] **Step 9: Google Docs spike (manual, gate for the Docs path)**

1. `bun run build:local`, reload the unpacked extension at `chrome://extensions`.
2. Open a Google Doc, open Birdie, click "Ask about this page" (grants `https://docs.google.com/*`).
3. Open the service worker console for the side panel (`chrome://extensions` → Birdie → "Inspect views: sidepanel.html") and run:
   `chrome.runtime.onMessage.addListener((m, s) => console.log(m, s.tab?.id))`
4. Reload the doc, highlight a sentence, press ⌘C.

Expected: one log line `{type: 'birdie-selection', text: '<the sentence>', url: 'https://docs.google.com/document/d/…', …}`.
If nothing logs: record the result in the spec's §1 ("Docs falls back to the context menu only") and continue — the UI in Task 7 shows the fallback hint either way.

Also check an ordinary page (e.g. a news article after enabling it): highlighting text without copying logs a message within ~300 ms.

- [ ] **Step 10: Commit**

```bash
git add extension/src/content extension/src/lib/sites.ts extension/src/lib/sites.test.ts extension/src/lib/selection.ts extension/src/lib/selection.test.ts extension/src/lib/pageText.ts extension/src/background.ts extension/vite.config.ts extension/src/sidepanel/BirdieSidePanel.tsx
git commit -m "feat(extension): per-site switch and live selection content script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser context hook and context chips

**Files:**
- Create: `extension/src/sidepanel/useBrowserContext.ts`
- Create: `extension/src/sidepanel/ContextChips.tsx`

**Interfaces:**
- Consumes: Task 6 `selectionFromMessage`, `getActiveTab`, `readTabText`, `isGoogleDoc`, `isSiteEnabled`, `enableSite`, `injectSelectionScript`; existing `buildWebContext`, `PENDING_CONTEXT_KEY`, `WebContext`.
- Produces:
  - `useBrowserContext(): BrowserContext` where
    `BrowserContext = { tab: ActiveTab | null; siteEnabled: boolean; selection: WebContext | null; page: WebContext | null; error: string | null; clearSelection(): void; clearPage(): void; clearAll(): void; share(ctx: WebContext): void; enableCurrentSite(): Promise<void> }`
  - `<ContextChips context={BrowserContext} onSearchCases={() => void} />` — renders directly above the textarea.

- [ ] **Step 1: Write the hook**

`extension/src/sidepanel/useBrowserContext.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ActiveTab, getActiveTab, readTabText } from '../lib/pageText'
import { selectionFromMessage } from '../lib/selection'
import { enableSite, injectSelectionScript, isSiteEnabled } from '../lib/sites'
import { buildWebContext, PENDING_CONTEXT_KEY, type WebContext } from '../lib/webContext'

export type BrowserContext = {
  tab: ActiveTab | null
  siteEnabled: boolean
  selection: WebContext | null
  page: WebContext | null
  error: string | null
  clearSelection: () => void
  clearPage: () => void
  clearAll: () => void
  share: (ctx: WebContext) => void
  enableCurrentSite: () => Promise<void>
}

export function useBrowserContext(): BrowserContext {
  const [tab, setTab] = useState<ActiveTab | null>(null)
  const [siteEnabled, setSiteEnabled] = useState(false)
  const [selection, setSelection] = useState<WebContext | null>(null)
  const [page, setPage] = useState<WebContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tabRef = useRef<ActiveTab | null>(null)

  const loadPage = useCallback(async (current: ActiveTab) => {
    try {
      const text = await readTabText(current)
      if (tabRef.current?.id === current.id) setPage(buildWebContext({ ...text, source: 'page' }))
    } catch {
      setPage(null)
    }
  }, [])

  const refreshTab = useCallback(async () => {
    const current = await getActiveTab()
    const changed = current?.id !== tabRef.current?.id || current?.url !== tabRef.current?.url
    tabRef.current = current
    setTab(current)
    if (!changed) return
    setSelection(null)
    setPage(null)
    const enabled = current ? await isSiteEnabled(current.url) : false
    setSiteEnabled(enabled)
    if (current && enabled) await loadPage(current)
  }, [loadPage])

  useEffect(() => {
    void refreshTab()
    const onActivated = () => void refreshTab()
    const onUpdated = (tabId: number, info: { status?: string; url?: string }) => {
      if (tabId === tabRef.current?.id && (info.url || info.status === 'complete')) void refreshTab()
    }
    const onFocus = () => void refreshTab()
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.windows.onFocusChanged.addListener(onFocus)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.windows.onFocusChanged.removeListener(onFocus)
    }
  }, [refreshTab])

  useEffect(() => {
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      const next = selectionFromMessage(message, sender.tab?.id, tabRef.current?.id)
      if (next !== undefined) setSelection(next)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  // Right-click "Ask Birdie about this" (background.ts) hands over through session storage.
  useEffect(() => {
    const take = (value: unknown) => {
      if (!value) return
      setSelection(value as WebContext)
      chrome.storage.session.remove(PENDING_CONTEXT_KEY).catch(console.error)
    }
    chrome.storage.session.get(PENDING_CONTEXT_KEY).then((stored) => take(stored[PENDING_CONTEXT_KEY]))
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[PENDING_CONTEXT_KEY]) take(changes[PENDING_CONTEXT_KEY].newValue)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const enableCurrentSite = useCallback(async () => {
    const current = tabRef.current
    if (!current) {
      setError("Birdie can't read this page")
      return
    }
    setError(null)
    // enableSite first: the permission prompt needs the click's user gesture.
    const granted = await enableSite(current.url)
    if (!granted) {
      setError("Birdie can't read this page without permission")
      return
    }
    setSiteEnabled(true)
    await injectSelectionScript(current.id).catch(console.error)
    await loadPage(current)
  }, [loadPage])

  return {
    tab,
    siteEnabled,
    selection,
    page,
    error,
    clearSelection: () => setSelection(null),
    clearPage: () => setPage(null),
    clearAll: () => {
      setSelection(null)
      setPage(null)
    },
    share: setSelection,
    enableCurrentSite,
  }
}
```

- [ ] **Step 2: Write the chips**

`extension/src/sidepanel/ContextChips.tsx`:

```tsx
import { isGoogleDoc } from '../lib/pageText'
import type { BrowserContext } from './useBrowserContext'

export function ContextChips({ context, onSearchCases }: { context: BrowserContext; onSearchCases: () => void }) {
  const { tab, siteEnabled, selection, page } = context
  return (
    <div className="space-y-1 text-xs">
      {selection && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-amber-50 px-2 py-1">
          <span className="line-clamp-2">
            <strong>Highlighted:</strong> “{selection.text}”{selection.truncated && ' (truncated)'}
          </span>
          <span className="flex shrink-0 gap-2">
            <button className="underline" onClick={onSearchCases}>
              Search eLitigation
            </button>
            <button aria-label="Remove highlighted text" onClick={context.clearSelection}>
              ×
            </button>
          </span>
        </div>
      )}
      {page && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-stone-100 px-2 py-1">
          <span className="line-clamp-1">
            <strong>Page:</strong> {page.title || page.url}
            {page.truncated && ' (truncated)'}
          </span>
          <button aria-label="Remove page text" onClick={context.clearPage}>
            ×
          </button>
        </div>
      )}
      {tab && !siteEnabled && (
        <p className="text-stone-500">
          <button className="underline" onClick={() => void context.enableCurrentSite()}>
            Turn on Birdie for this site
          </button>{' '}
          to share highlights and page text. Birdie only reads sites you turn on.
        </p>
      )}
      {tab && siteEnabled && !selection && isGoogleDoc(tab.url) && (
        <p className="text-stone-500">In Google Docs, copy (⌘C) or right-click highlighted text to share it.</p>
      )}
      {context.error && <p className="text-red-600">{context.error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd extension && bun run build`
Expected: success (components are not wired yet; unused files still typecheck).

- [ ] **Step 4: Commit**

```bash
git add extension/src/sidepanel/useBrowserContext.ts extension/src/sidepanel/ContextChips.tsx
git commit -m "feat(extension): browser context hook and highlight/page chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Conversation persistence for New chat

**Files:**
- Create: `extension/src/lib/conversation.ts`, `extension/src/lib/conversation.test.ts`

**Interfaces:**
- Consumes: `BirdieTurn` from `api.ts` (extended in Task 10 with optional `cases`; this module stores whatever turns it is given).
- Produces: `loadTurns(): Promise<BirdieTurn[]>`, `saveTurns(turns: BirdieTurn[]): Promise<void>`, `clearTurns(): Promise<void>`, `TURNS_KEY = 'birdieTurns'`.

- [ ] **Step 1: Write the failing test**

`extension/src/lib/conversation.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { clearTurns, loadTurns, saveTurns, TURNS_KEY } from './conversation'

const store: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
    },
  }
})

describe('conversation storage', () => {
  it('round-trips turns', async () => {
    await saveTurns([{ role: 'user', content: 'hi' }])
    expect(await loadTurns()).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('returns [] when empty or corrupt', async () => {
    expect(await loadTurns()).toEqual([])
    store[TURNS_KEY] = 'nope'
    expect(await loadTurns()).toEqual([])
  })

  it('clears', async () => {
    await saveTurns([{ role: 'user', content: 'hi' }])
    await clearTurns()
    expect(await loadTurns()).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd extension && bun run test`
Expected: FAIL — cannot resolve `./conversation`.

- [ ] **Step 3: Implement**

`extension/src/lib/conversation.ts`:

```ts
import type { BirdieTurn } from './api'

// Session storage: survives closing the panel, cleared on browser restart or New chat.
export const TURNS_KEY = 'birdieTurns'

export async function loadTurns(): Promise<BirdieTurn[]> {
  const stored = await chrome.storage.session.get(TURNS_KEY)
  const turns = stored[TURNS_KEY]
  return Array.isArray(turns) ? (turns as BirdieTurn[]) : []
}

export async function saveTurns(turns: BirdieTurn[]): Promise<void> {
  await chrome.storage.session.set({ [TURNS_KEY]: turns })
}

export async function clearTurns(): Promise<void> {
  await chrome.storage.session.remove(TURNS_KEY)
}
```

- [ ] **Step 4: Run tests**

Run: `cd extension && bun run test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/conversation.ts extension/src/lib/conversation.test.ts
git commit -m "feat(extension): persist Birdie turns per browser session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: OpenRouter model choice in the side panel

**Files:**
- Modify: `extension/src/lib/api.ts`
- Create: `extension/src/lib/models.ts`, `extension/src/lib/models.test.ts`, `extension/src/lib/api.test.ts`
- Create: `extension/src/sidepanel/ModelView.tsx`

**Interfaces:**
- Consumes: existing backend `GET/PUT /settings/birdie`, `DELETE /settings/birdie/openrouter-key`, `GET /settings/birdie/models`.
- Produces (in `api.ts`):
  - `BirdieSettings = { hasOpenRouterKey: boolean; keyLast4: string | null; openRouterModel: string | null; effectiveModel: string | null }`
  - `OpenRouterModel = { id: string; name: string; contextLength: number | null; promptPricePerMillion: number | null }`
  - `toBirdieSettings(raw): BirdieSettings`, `toOpenRouterModel(raw): OpenRouterModel`
  - `getBirdieSettings()`, `saveBirdieSettings(update: { apiKey?: string; model?: string | null })`, `removeOpenRouterKey()` → `Promise<BirdieSettings>`; `listOpenRouterModels(): Promise<OpenRouterModel[]>`
  - `modelLabel(settings: BirdieSettings | null): string` and `providerDisclosure(settings: BirdieSettings | null): string` (in `models.ts`)
  - `filterModels(models: OpenRouterModel[], query: string): OpenRouterModel[]` (in `models.ts`)
  - `<ModelView settings onChange(settings) onClose() />`

- [ ] **Step 1: Write the failing tests**

`extension/src/lib/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toBirdieSettings, toOpenRouterModel } from './api'

describe('settings mapping', () => {
  it('maps snake_case settings', () => {
    expect(
      toBirdieSettings({
        has_openrouter_key: true,
        key_last4: 'abcd',
        openrouter_model: 'anthropic/claude-sonnet-5.5',
        effective_model: 'anthropic/claude-sonnet-5.5',
      }),
    ).toEqual({
      hasOpenRouterKey: true,
      keyLast4: 'abcd',
      openRouterModel: 'anthropic/claude-sonnet-5.5',
      effectiveModel: 'anthropic/claude-sonnet-5.5',
    })
  })

  it('maps models', () => {
    expect(toOpenRouterModel({ id: 'a/b', name: 'B', context_length: 1000, prompt_price_per_million: 3 })).toEqual({
      id: 'a/b',
      name: 'B',
      contextLength: 1000,
      promptPricePerMillion: 3,
    })
  })
})
```

`extension/src/lib/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filterModels, modelLabel, providerDisclosure } from './models'

const models = [
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextLength: null, promptPricePerMillion: null },
  { id: 'openai/gpt-x', name: 'GPT X', contextLength: null, promptPricePerMillion: null },
]
const withKey = { hasOpenRouterKey: true, keyLast4: 'abcd', openRouterModel: null, effectiveModel: 'openai/gpt-x' }

describe('models', () => {
  it('filters by id or name, case-insensitively', () => {
    expect(filterModels(models, 'SONNET').map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5.5'])
    expect(filterModels(models, '').length).toBe(2)
  })

  it('labels the active model', () => {
    expect(modelLabel(null)).toBe('DeepSeek (firm default)')
    expect(modelLabel(withKey)).toBe('openai/gpt-x')
  })

  it('names where text is sent', () => {
    expect(providerDisclosure(null)).toBe('Text you share is sent to DeepSeek.')
    expect(providerDisclosure(withKey)).toBe('Text you share is sent to OpenRouter → openai.')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd extension && bun run test`
Expected: FAIL — `toBirdieSettings` not exported; `./models` unresolved.

- [ ] **Step 3: Add the API functions**

In `extension/src/lib/api.ts`, after `checkAuth`, add a shared JSON helper:

```ts
async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: await authHeaders() })
  await checkAuth(response)
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof payload?.detail === 'string' ? payload.detail : `Request failed (${response.status})`)
  return payload as T
}
```

Append:

```ts
export type BirdieSettings = {
  hasOpenRouterKey: boolean
  keyLast4: string | null
  openRouterModel: string | null
  effectiveModel: string | null
}
export type OpenRouterModel = { id: string; name: string; contextLength: number | null; promptPricePerMillion: number | null }

type ApiBirdieSettings = {
  has_openrouter_key: boolean
  key_last4: string | null
  openrouter_model: string | null
  effective_model: string | null
}
type ApiOpenRouterModel = {
  id: string
  name: string
  context_length: number | null
  prompt_price_per_million: number | null
}

export function toBirdieSettings(raw: ApiBirdieSettings): BirdieSettings {
  return {
    hasOpenRouterKey: raw.has_openrouter_key,
    keyLast4: raw.key_last4 ?? null,
    openRouterModel: raw.openrouter_model ?? null,
    effectiveModel: raw.effective_model ?? null,
  }
}

export function toOpenRouterModel(raw: ApiOpenRouterModel): OpenRouterModel {
  return {
    id: raw.id,
    name: raw.name,
    contextLength: raw.context_length ?? null,
    promptPricePerMillion: raw.prompt_price_per_million ?? null,
  }
}

export async function getBirdieSettings(): Promise<BirdieSettings> {
  return toBirdieSettings(await apiJson<ApiBirdieSettings>('/settings/birdie'))
}

export async function saveBirdieSettings(update: { apiKey?: string; model?: string | null }): Promise<BirdieSettings> {
  const body: Record<string, string | null> = {}
  if (update.apiKey) body.openrouter_api_key = update.apiKey
  if (update.model !== undefined) body.openrouter_model = update.model
  return toBirdieSettings(await apiJson<ApiBirdieSettings>('/settings/birdie', { method: 'PUT', body: JSON.stringify(body) }))
}

export async function removeOpenRouterKey(): Promise<BirdieSettings> {
  return toBirdieSettings(await apiJson<ApiBirdieSettings>('/settings/birdie/openrouter-key', { method: 'DELETE' }))
}

export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
  return (await apiJson<ApiOpenRouterModel[]>('/settings/birdie/models')).map(toOpenRouterModel)
}
```

Also refactor `fetchMe` to `return toUser(await apiJson<ApiUser>('/me'))`.

- [ ] **Step 4: Add `models.ts`**

`extension/src/lib/models.ts`:

```ts
import type { BirdieSettings, OpenRouterModel } from './api'

export function filterModels(models: OpenRouterModel[], query: string): OpenRouterModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
}

export function modelLabel(settings: BirdieSettings | null): string {
  return settings?.hasOpenRouterKey && settings.effectiveModel ? settings.effectiveModel : 'DeepSeek (firm default)'
}

export function providerDisclosure(settings: BirdieSettings | null): string {
  if (!settings?.hasOpenRouterKey || !settings.effectiveModel) return 'Text you share is sent to DeepSeek.'
  return `Text you share is sent to OpenRouter → ${settings.effectiveModel.split('/')[0]}.`
}
```

- [ ] **Step 5: Run tests**

Run: `cd extension && bun run test`
Expected: all suites pass.

- [ ] **Step 6: Write the Model view**

`extension/src/sidepanel/ModelView.tsx`:

```tsx
import { useEffect, useState } from 'react'
import {
  type BirdieSettings,
  listOpenRouterModels,
  type OpenRouterModel,
  removeOpenRouterKey,
  saveBirdieSettings,
} from '../lib/api'
import { filterModels } from '../lib/models'

type Props = { settings: BirdieSettings | null; onChange: (s: BirdieSettings) => void; onClose: () => void }

export function ModelView({ settings, onChange, onClose }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(settings?.openRouterModel ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasKey = settings?.hasOpenRouterKey ?? false

  useEffect(() => {
    listOpenRouterModels().then(setModels).catch((err) => setError(String(err)))
  }, [])

  async function run(action: () => Promise<BirdieSettings>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await action())
      setApiKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Birdie model</h2>
        <button className="text-xs underline" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Without your own OpenRouter key, Birdie uses the firm's DeepSeek model. With a key, prompts (including
        text you share) go to OpenRouter and the provider of the model you pick. This setting is shared with the
        LexCatalyst web app.
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-medium">OpenRouter API key</span>
        <input
          type="password"
          className="w-full rounded-md border border-stone-300 p-2"
          placeholder={hasKey ? `Key saved (…${settings?.keyLast4})` : 'sk-or-…'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          className="rounded-md bg-stone-900 px-3 py-1 text-white disabled:opacity-50"
          disabled={busy || (!apiKey && selected === (settings?.openRouterModel ?? null))}
          onClick={() => void run(() => saveBirdieSettings({ apiKey: apiKey || undefined, model: selected }))}
        >
          Save
        </button>
        {hasKey && (
          <button className="text-xs underline" disabled={busy} onClick={() => void run(removeOpenRouterKey)}>
            Remove key
          </button>
        )}
      </div>
      <input
        className="w-full rounded-md border border-stone-300 p-2 disabled:opacity-50"
        placeholder={hasKey || apiKey ? 'Search models' : 'Add a key to choose a model'}
        disabled={!hasKey && !apiKey}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {filterModels(models, query)
          .slice(0, 100)
          .map((model) => (
            <li key={model.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-100">
                <input
                  type="radio"
                  name="model"
                  disabled={!hasKey && !apiKey}
                  checked={selected === model.id}
                  onChange={() => setSelected(model.id)}
                />
                <span className="truncate">{model.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-stone-400">{model.id}</span>
              </label>
            </li>
          ))}
      </ul>
      {error && <p className="text-red-600">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `cd extension && bun run test && bun run build`
Expected: pass.

```bash
git add extension/src/lib/api.ts extension/src/lib/api.test.ts extension/src/lib/models.ts extension/src/lib/models.test.ts extension/src/sidepanel/ModelView.tsx
git commit -m "feat(extension): choose Birdie's OpenRouter model from the side panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Precedent tab, cases list and `sources` events

**Files:**
- Modify: `extension/src/lib/sse.ts`, `extension/src/lib/sse.test.ts`
- Modify: `extension/src/lib/api.ts`, `extension/src/lib/api.test.ts`
- Modify: `extension/src/lib/config.ts`
- Create: `extension/src/sidepanel/PrecedentTab.tsx`, `extension/src/sidepanel/CasesList.tsx`

**Interfaces:**
- Consumes: Task 3 SSE `sources` event; Task 5 `POST /precedent/search` response.
- Produces:
  - `SseEvent = { event: string; data: Record<string, unknown> }`
  - `CaseLink = { citation: string; title: string; decisionDate: string | null; url: string }`
  - `BirdieTurn = { role: 'user' | 'assistant'; content: string; cases?: CaseLink[] }`
  - `streamBirdie(opts)` gains `onSources?: (cases: CaseLink[]) => void`; `history` sent to the API strips `cases`.
  - `PrecedentResponse`, `PrecedentResult`, `toPrecedentResponse(raw)`, `searchPrecedent(text: string, url?: string): Promise<PrecedentResponse>`
  - `APP_URL` in `config.ts` (default `https://lexcatalyst.pages.dev`)
  - `<PrecedentTab selectionText={string | null} onUseInChat={(r: PrecedentResult) => void} />`
  - `<CasesList cases={CaseLink[]} />`

- [ ] **Step 1: Write the failing tests**

Append to `extension/src/lib/sse.test.ts` inside the `describe`:

```ts
  it('keeps structured data such as arrays', () => {
    const buffer = 'event: sources\ndata: {"cases":[{"citation":"[2011] SGCA 1"}]}\n\n'
    expect(splitSseBuffer(buffer).events[0].data).toEqual({ cases: [{ citation: '[2011] SGCA 1' }] })
  })
```

Append to `extension/src/lib/api.test.ts`:

```ts
import { toCaseLinks, toPrecedentResponse } from './api'

describe('precedent mapping', () => {
  it('maps the response', () => {
    const mapped = toPrecedentResponse({
      clause_type: 'option_period',
      terms_summary: [{ label: '21 days', count: 3 }],
      results: [
        {
          id: 'c1',
          source_type: 'document',
          excerpt: 'Option Period of 21 days',
          document_title: 'Signed SPA.pdf',
          matter_ref: 'MAT-2',
          date: '2024-05-06',
          author: 'Sam',
          status: 'executed',
          document_id: 'd1',
          term: { kind: 'days', value: '21', label: '21 days' },
        },
      ],
    })
    expect(mapped.clauseType).toBe('option_period')
    expect(mapped.termsSummary).toEqual([{ label: '21 days', count: 3 }])
    expect(mapped.results[0]).toMatchObject({ sourceType: 'document', documentTitle: 'Signed SPA.pdf', documentId: 'd1', termLabel: '21 days' })
  })
})

describe('case links', () => {
  it('maps and drops malformed entries', () => {
    expect(
      toCaseLinks([
        { citation: '[2011] SGCA 1', title: 'Holcim', decision_date: '2011-01-19', url: 'https://www.elitigation.sg/gd/s/2011_SGCA_1' },
        { citation: 'x' },
      ]),
    ).toEqual([{ citation: '[2011] SGCA 1', title: 'Holcim', decisionDate: '2011-01-19', url: 'https://www.elitigation.sg/gd/s/2011_SGCA_1' }])
  })

  it('drops links that are not eLitigation', () => {
    expect(toCaseLinks([{ citation: 'a', title: 'b', decision_date: null, url: 'https://evil.example' }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd extension && bun run test`
Expected: FAIL — `toPrecedentResponse` / `toCaseLinks` not exported. (The SSE test already passes at runtime; its type change comes next.)

- [ ] **Step 3: Widen SSE data**

In `extension/src/lib/sse.ts` change the type and cast:

```ts
export type SseEvent = { event: string; data: Record<string, unknown> }
```

and `events.push({ event, data: JSON.parse(data) as Record<string, unknown> })`.

- [ ] **Step 4: Extend `api.ts`**

Replace the `BirdieTurn` type with:

```ts
export type CaseLink = { citation: string; title: string; decisionDate: string | null; url: string }
export type BirdieTurn = { role: 'user' | 'assistant'; content: string; cases?: CaseLink[] }
```

Add:

```ts
const ELITIGATION_PREFIX = 'https://www.elitigation.sg/gd/s/'

export function toCaseLinks(raw: unknown): CaseLink[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const c = item as Record<string, unknown>
    if (typeof c.citation !== 'string' || typeof c.title !== 'string' || typeof c.url !== 'string') return []
    if (!c.url.startsWith(ELITIGATION_PREFIX)) return []
    const decisionDate = typeof c.decision_date === 'string' ? c.decision_date : null
    return [{ citation: c.citation, title: c.title, decisionDate, url: c.url }]
  })
}
```

In `streamBirdie`:
- add `onSources?: (cases: CaseLink[]) => void` to `opts`;
- send history without cases: `history: opts.history.slice(-40).map(({ role, content }) => ({ role, content }))`;
- replace the event loop body with:

```ts
    for (const { event, data } of events) {
      if (event === 'sources') opts.onSources?.(toCaseLinks(data.cases))
      else if (event === 'token') opts.onToken(String(data.content ?? ''))
      else if (event === 'done') return String(data.content ?? '')
      else if (event === 'error') throw new Error(String(data.detail ?? 'Birdie failed'))
    }
```

Append precedent types and call:

```ts
export type PrecedentResult = {
  id: string
  sourceType: 'document' | 'knowledge_bank'
  excerpt: string
  documentTitle: string
  matterRef: string | null
  date: string | null
  author: string | null
  status: string | null
  documentId: string | null
  termLabel: string | null
}
export type PrecedentResponse = {
  clauseType: string
  termsSummary: { label: string; count: number }[]
  results: PrecedentResult[]
}

type ApiPrecedentResult = {
  id: string
  source_type: 'document' | 'knowledge_bank'
  excerpt: string
  document_title: string
  matter_ref: string | null
  date: string | null
  author: string | null
  status: string | null
  document_id: string | null
  term: { kind: string; value: string; label: string } | null
}
type ApiPrecedentResponse = {
  clause_type: string
  terms_summary: { label: string; count: number }[]
  results: ApiPrecedentResult[]
}

export function toPrecedentResponse(raw: ApiPrecedentResponse): PrecedentResponse {
  return {
    clauseType: raw.clause_type,
    termsSummary: raw.terms_summary,
    results: raw.results.map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      excerpt: r.excerpt,
      documentTitle: r.document_title,
      matterRef: r.matter_ref,
      date: r.date,
      author: r.author,
      status: r.status,
      documentId: r.document_id,
      termLabel: r.term?.label ?? null,
    })),
  }
}

export async function searchPrecedent(text: string, url?: string): Promise<PrecedentResponse> {
  const raw = await apiJson<ApiPrecedentResponse>('/precedent/search', {
    method: 'POST',
    body: JSON.stringify({ text: text.slice(0, 5000), url: url ?? null }),
  })
  return toPrecedentResponse(raw)
}
```

In `extension/src/lib/config.ts` append:

```ts
export const APP_URL: string = (import.meta.env.VITE_APP_URL as string | undefined) ?? 'https://lexcatalyst.pages.dev'
```

- [ ] **Step 5: Run tests**

Run: `cd extension && bun run test`
Expected: all suites pass.

- [ ] **Step 6: Write `CasesList.tsx`**

```tsx
import type { CaseLink } from '../lib/api'

export function CasesList({ cases }: { cases: CaseLink[] }) {
  if (!cases.length) return null
  return (
    <div className="mt-2 border-t border-stone-200 pt-2 text-xs">
      <p className="mb-1 font-medium text-stone-600">Cases (eLitigation)</p>
      <ul className="space-y-1">
        {cases.map((c) => (
          <li key={c.url}>
            <a className="text-blue-600 underline" href={c.url} target="_blank" rel="noreferrer">
              {c.citation}
            </a>{' '}
            {c.title}
            {c.decisionDate && <span className="text-stone-400"> · {c.decisionDate}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 7: Write `PrecedentTab.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { type PrecedentResponse, type PrecedentResult, searchPrecedent } from '../lib/api'
import { APP_URL } from '../lib/config'

const AUTO_RUN_MS = 800
const CLAUSE_LABELS: Record<string, string> = {
  option_period: 'Option period',
  governing_law: 'Governing law',
  limitation_of_liability: 'Limitation of liability',
  termination: 'Termination',
  confidentiality: 'Confidentiality',
  payment_terms: 'Payment terms',
  notice: 'Notice',
  other: 'Clause',
}

type Props = { selectionText: string | null; onUseInChat: (result: PrecedentResult) => void; onError: (err: unknown) => void }

export function PrecedentTab({ selectionText, onUseInChat, onError }: Props) {
  const [data, setData] = useState<PrecedentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function run(text: string) {
    setLoading(true)
    try {
      setData(await searchPrecedent(text))
    } catch (err) {
      onError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!selectionText || selectionText.length < 3) return
    const timer = setTimeout(() => void run(selectionText), AUTO_RUN_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionText])

  async function copy(result: PrecedentResult) {
    await navigator.clipboard.writeText(result.excerpt)
    setCopied(result.id)
  }

  if (!selectionText) {
    return <p className="p-3 text-sm text-stone-500">Highlight a clause to see how the firm has drafted it before.</p>
  }

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{data ? CLAUSE_LABELS[data.clauseType] ?? 'Clause' : 'Precedent'}</span>
        <button className="text-xs underline" disabled={loading} onClick={() => void run(selectionText)}>
          {loading ? 'Searching…' : 'Find precedent'}
        </button>
      </div>
      {data && data.termsSummary.length > 0 && (
        <p className="rounded-md bg-stone-100 px-2 py-1 text-xs">
          {data.termsSummary.map((t) => `${t.label} ×${t.count}`).join(' · ')}
        </p>
      )}
      {data && data.results.length === 0 && <p className="text-stone-500">No firm precedent found for this clause.</p>}
      {data?.results.map((r) => (
        <article key={r.id} className="space-y-1 rounded-md bg-white p-2 shadow-sm">
          <p className="line-clamp-4 whitespace-pre-wrap">{r.excerpt}</p>
          <p className="text-[11px] text-stone-500">
            {r.documentTitle}
            {r.matterRef && ` · ${r.matterRef}`}
            {r.date && ` · ${r.date}`}
            {r.author && ` · ${r.author}`}
            {r.status && (
              <span
                className={`ml-1 rounded px-1 ${r.status === 'executed' ? 'bg-green-100 text-green-800' : 'bg-stone-200'}`}
              >
                {r.status === 'executed' ? 'Executed' : 'Draft'}
              </span>
            )}
            {r.termLabel && <strong className="ml-1">{r.termLabel}</strong>}
          </p>
          <div className="flex gap-3 text-xs">
            <button className="underline" onClick={() => void copy(r)}>
              {copied === r.id ? 'Copied' : 'Copy'}
            </button>
            <button className="underline" onClick={() => onUseInChat(r)}>
              Use in chat
            </button>
            {r.documentId && (
              <a className="underline" href={`${APP_URL}/documents/${r.documentId}`} target="_blank" rel="noreferrer">
                Open
              </a>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
```

- [ ] **Step 8: Typecheck and commit**

Run: `cd extension && bun run test && bun run build`
Expected: pass.

```bash
git add extension/src/lib/sse.ts extension/src/lib/sse.test.ts extension/src/lib/api.ts extension/src/lib/api.test.ts extension/src/lib/config.ts extension/src/sidepanel/PrecedentTab.tsx extension/src/sidepanel/CasesList.tsx
git commit -m "feat(extension): precedent tab, eLitigation case links and sources events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Wire the side panel (tabs, chips, New chat, model, cases)

**Files:**
- Modify (rewrite): `extension/src/sidepanel/BirdieSidePanel.tsx`
- Modify: `README.md` (extension section), `AGENTS.md` (extension disclosure line)

**Interfaces:**
- Consumes: everything from Tasks 6–10.

- [ ] **Step 1: Replace `BirdieSidePanel.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type BirdieSettings,
  type BirdieTurn,
  type CaseLink,
  type ExtensionUser,
  fetchMe,
  getBirdieSettings,
  type PrecedentResult,
  signIn,
  streamBirdie,
  UnauthorizedError,
} from '../lib/api'
import { clearToken, getToken } from '../lib/auth'
import { APP_URL } from '../lib/config'
import { clearTurns, loadTurns, saveTurns } from '../lib/conversation'
import { modelLabel, providerDisclosure } from '../lib/models'
import { buildWebContext } from '../lib/webContext'
import { CasesList } from './CasesList'
import { ContextChips } from './ContextChips'
import { MarkdownContent } from './MarkdownContent'
import { ModelView } from './ModelView'
import { PrecedentTab } from './PrecedentTab'
import { useBrowserContext } from './useBrowserContext'

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: ExtensionUser }
type View = 'chat' | 'precedent' | 'model'

const CASE_SEARCH_PROMPT = 'Find Singapore judgments on eLitigation relevant to the highlighted text.'

export function BirdieSidePanel() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [view, setView] = useState<View>('chat')
  const [turns, setTurns] = useState<BirdieTurn[]>([])
  const [turnsLoaded, setTurnsLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [streamingCases, setStreamingCases] = useState<CaseLink[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<BirdieSettings | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const browser = useBrowserContext()

  const handleError = useCallback((err: unknown) => {
    if (err instanceof UnauthorizedError) setAuth({ status: 'signedOut' })
    if (err instanceof Error && err.name === 'AbortError') return
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  useEffect(() => {
    getToken()
      .then((token) => (token ? fetchMe() : null))
      .then((user) => setAuth(user ? { status: 'signedIn', user } : { status: 'signedOut' }))
      .catch((err) => {
        setAuth({ status: 'signedOut' })
        if (!(err instanceof UnauthorizedError)) setError(String(err))
      })
    loadTurns()
      .then(setTurns)
      .finally(() => setTurnsLoaded(true))
  }, [])

  useEffect(() => {
    if (auth.status === 'signedIn') getBirdieSettings().then(setSettings).catch(handleError)
  }, [auth.status, handleError])

  useEffect(() => {
    if (turnsLoaded) saveTurns(turns).catch(console.error)
  }, [turns, turnsLoaded])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setTurns([])
    setStreaming('')
    setStreamingCases([])
    setDraft('')
    setError(null)
    browser.clearAll()
    setView('chat')
    clearTurns().catch(console.error)
  }, [browser])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  async function handleSignIn() {
    setError(null)
    try {
      setAuth({ status: 'signedIn', user: await signIn() })
    } catch (err) {
      handleError(err)
    }
  }

  async function handleSignOut() {
    newChat()
    await clearToken()
    setAuth({ status: 'signedOut' })
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    const history = turns
    const webContext = browser.selection ?? browser.page
    let cases: CaseLink[] = []
    setTurns([...history, { role: 'user', content: message }])
    setDraft('')
    browser.clearSelection()
    setStreaming('')
    setStreamingCases([])
    setError(null)
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      const answer = await streamBirdie({
        message,
        history,
        webContext,
        signal: abortRef.current.signal,
        onSources: (found) => {
          cases = found
          setStreamingCases(found)
        },
        onToken: (token) => setStreaming((prev) => prev + token),
      })
      setTurns((prev) => [...prev, { role: 'assistant', content: answer, cases }])
    } catch (err) {
      handleError(err)
    } finally {
      setStreaming('')
      setStreamingCases([])
      setBusy(false)
    }
  }

  function useInChat(result: PrecedentResult) {
    const ctx = buildWebContext({
      url: result.documentId ? `${APP_URL}/documents/${result.documentId}` : APP_URL,
      title: `Precedent: ${result.documentTitle}`,
      text: result.excerpt,
      source: 'selection',
    })
    if (ctx) browser.share(ctx)
    setView('chat')
  }

  if (auth.status === 'loading') return <p className="p-4 text-sm text-stone-500">Loading…</p>

  if (auth.status === 'signedOut') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Birdie</h1>
        <p className="text-sm text-stone-600">Sign in with your LexCatalyst Google account.</p>
        <button className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white" onClick={handleSignIn}>
          Sign in with Google
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    )
  }

  const tabClass = (active: boolean) =>
    `px-2 py-1 text-xs ${active ? 'border-b-2 border-stone-900 font-semibold' : 'text-stone-500'}`

  return (
    <main className="flex h-screen flex-col">
      <header className="space-y-1 border-b border-stone-200 px-3 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Birdie</span>
          <span className="flex items-center gap-2 text-xs text-stone-500">
            <button className="underline" title="New chat (⌘K)" onClick={newChat}>
              New chat
            </button>
            <button className="max-w-32 truncate underline" title="Choose model" onClick={() => setView('model')}>
              {modelLabel(settings)}
            </button>
            <button className="underline" onClick={handleSignOut}>
              Sign out
            </button>
          </span>
        </div>
        <nav className="flex gap-2">
          <button className={tabClass(view === 'chat')} onClick={() => setView('chat')}>
            Chat
          </button>
          <button className={tabClass(view === 'precedent')} onClick={() => setView('precedent')}>
            Precedent
          </button>
        </nav>
      </header>

      {view === 'model' && <ModelView settings={settings} onChange={setSettings} onClose={() => setView('chat')} />}

      {view === 'precedent' && (
        <PrecedentTab selectionText={browser.selection?.text ?? null} onUseInChat={useInChat} onError={handleError} />
      )}

      {view === 'chat' && (
        <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
          {turns.length === 0 && !streaming && (
            <p className="text-stone-500">
              Ask Birdie anything. Turn Birdie on for this site and highlight text to ask about it, or open
              Precedent to see how the firm drafted a clause before.
            </p>
          )}
          {turns.map((turn, index) =>
            turn.role === 'user' ? (
              <p key={index} className="ml-8 rounded-md bg-stone-200 px-3 py-2">
                {turn.content}
              </p>
            ) : (
              <div key={index} className="mr-4 rounded-md bg-white px-3 py-2 shadow-sm">
                <MarkdownContent markdown={turn.content} />
                <CasesList cases={turn.cases ?? []} />
              </div>
            ),
          )}
          {(streaming || streamingCases.length > 0) && (
            <div className="mr-4 rounded-md bg-white px-3 py-2 shadow-sm">
              <MarkdownContent markdown={streaming || '…'} />
              <CasesList cases={streamingCases} />
            </div>
          )}
          {error && <p className="text-red-600">{error}</p>}
        </section>
      )}

      {view !== 'model' && (
        <footer className="space-y-2 border-t border-stone-200 p-3">
          <ContextChips context={browser} onSearchCases={() => void send(CASE_SEARCH_PROMPT)} />
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setView('chat')
              void send(draft)
            }}
          >
            <textarea
              className="flex-1 resize-none rounded-md border border-stone-300 p-2 text-sm"
              rows={2}
              value={draft}
              placeholder="Ask Birdie…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  setView('chat')
                  void send(draft)
                }
              }}
            />
            <button className="rounded-md bg-stone-900 px-3 text-sm text-white disabled:opacity-50" disabled={busy}>
              Send
            </button>
          </form>
          <p className="text-[11px] text-stone-500">
            {providerDisclosure(settings)} Case searches send only a short phrase to eLitigation.
          </p>
        </footer>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Build and test**

Run: `cd extension && bun run test && bun run build`
Expected: pass.

- [ ] **Step 3: Update docs**

In `README.md` § "4. Birdie Chrome extension (optional)", replace the paragraph starting `Birdie only sees webpage text when…` with:

```markdown
Birdie only reads sites you turn on ("Turn on Birdie for this site", which grants that one origin). On those sites it shows your current highlight above the "Ask Birdie…" box and reads the page text (Google Docs via its text export; in Docs, copy (⌘C) or right-click to share a highlight). Nothing is sent until you press Send or open Precedent. Shared text goes to `POST /birdie/stream` (JWT required) as `web_context` (max 20,000 chars) and then to DeepSeek, or to OpenRouter and the chosen model's provider when you saved your own key — choose the model from the model name in the panel header (same setting as the web app). Case-law questions send only a short search phrase to eLitigation (https://www.elitigation.sg); Birdie cites only judgments found there. **New chat** (⌘K) clears the conversation and shared context. The **Precedent** tab calls `POST /precedent/search` with the highlighted clause.

`VITE_APP_URL` (default `https://lexcatalyst.pages.dev`) sets where "Open" links to documents point.
```

In `AGENTS.md`, replace the line beginning `The Chrome extension (\`extension/\`) sends user-shared webpage text…` with:

```markdown
The Chrome extension (`extension/`) runs its selection content script only on origins the user turns on, and sends user-shared webpage text to Birdie as `web_context` on `POST /birdie/stream` and highlighted clauses to `POST /precedent/search`; keep the side-panel disclosure in sync with the provider line above. Birdie cites case law only from eLitigation (`case_law_service.py`); only a search phrase is sent there.
```

- [ ] **Step 4: Manual end-to-end verification**

With backend (`cd backend && make dev`) and `cd extension && bun run build:local`, reload the unpacked extension:

1. Open a normal article, open Birdie → "Turn on Birdie for this site" → accept prompt. Expected: `Page: <title>` chip appears.
2. Highlight a sentence. Expected: `Highlighted: "…"` chip appears above "Ask Birdie…" within ~0.3 s; changes when the highlight changes; × removes it.
3. Ask "What does this mean?" Expected: answer streams; chip clears after send.
4. Click **Search eLitigation** on a highlighted legal sentence. Expected: a "Cases (eLitigation)" list under the answer with `elitigation.sg/gd/s/…` links; no other case citations, or a ⚠️ warning line if the model added one.
5. Open **Precedent** with a clause highlighted. Expected: results or "No firm precedent found for this clause."; executed results first; Copy puts the excerpt on the clipboard; Open goes to the web app document.
6. Click the model name → add an OpenRouter key → pick a model → Save. Expected: header shows the model id; disclosure reads "sent to OpenRouter → <provider>". Remove key → header shows "DeepSeek (firm default)".
7. Close and reopen the panel. Expected: conversation still there. Press ⌘K. Expected: conversation, chips and draft cleared.
8. Google Docs: repeat step 2 using ⌘C (per the Task 6 spike result).

- [ ] **Step 5: Commit**

```bash
git add extension/src/sidepanel/BirdieSidePanel.tsx README.md AGENTS.md
git commit -m "feat(extension): wire live context, precedent, new chat and model choice into Birdie

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Before shipping

- Confirm eLitigation's terms of use permit automated search queries at this rate. If not, change `ContextChips`' "Search eLitigation" to open `https://www.elitigation.sg/gd/Home/Index?SearchPhrase=<q>` in a new tab and disable `find_case_sources`.
- `chrome.permissions` for `<all_urls>` stays only as `optional_host_permissions` so per-origin requests are allowed; the extension never requests `<all_urls>` itself any more.
