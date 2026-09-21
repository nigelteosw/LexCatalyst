# Engineering TODO — Review Findings

## Demo-first action plan — reviewed 2026-09-21

Start here. The older thematic inventory below is retained for context; this section supersedes
its priorities and verification claims. This pass explored the review UI, handoff/annotation
services and routes, schemas, KB promotion, document serving, navigation, and local checks.
Findings below are code-confirmed unless explicitly labelled as needing runtime verification.
They are **not implemented** unless checked. Use synthetic documents for the demo.

### Current verification and small fixes

- [x] Backend: `cd backend && .venv/bin/python -m unittest discover -s tests -v` — 22 pass
  in the existing working tree, including pre-existing uncommitted fixes. This is not a clean-main result.
- [x] Frontend production build: `cd frontend && bun run build` — passes; PDF.js eval and large-chunk warnings remain.
- [x] Removed the unused destructured callback in `ActionDetailDialog.tsx` that caused lint to fail.
- [x] Updated both Alembic head references in `AGENTS.md`; `alembic heads` reports `w8f9a0b1c2d3`.
- [ ] Browser rehearsal with two users, live Postgres/R2, and PDF export visual inspection.
  Not run in this pass; unit tests/build do not establish that the complete demo works.

### 1. Before rehearsing redlining: permissions and review lifecycle

- [x] **D1 — Enforce review write permissions on the server.** Done in `7695a26`: `can_review_handoff` /
  `can_remove_handoff` in `review_handoff_service.py`, enforced in the router, exposed as `can_review` /
  `can_remove` on the handoff response and consumed by `ReviewPane`. 18 tests in `test_review_permissions.py`.
  Original finding:
  `backend/app/routers/review_handoffs.py` uses the read-access helper for creating/editing/deleting
  annotations, completing/returning/rejecting handoffs, and deleting handoffs. Read access includes
  submitters and matter members; the UI's `isReviewer` is not an API boundary.
  Add explicit service-level capabilities for reviewer actions, participant replies, and handoff removal;
  keep document/matter access checks. Make UI controls reflect those same capabilities.
  **Accept:** a submitter/member can read and reply but cannot perform reviewer mutations by direct HTTP;
  authorized reviewers can; outsiders cannot read annotations, original files, or exports.

- [x] **D2 — Annotation promotion bypasses the promised PII review.** Done: `KnowledgeBankEntryCreate` never
  had a `pii_status` field, so the value was silently dropped. Extracted `create_pending_review_entry` from
  `promote_kb_entry`; wider-scope annotation promotion now creates a redacted `pending_review` entry plus
  `PiiRedaction` row, matter scope stays clean, and re-promoting an annotation is rejected.
  Tests in `test_annotation_promotion.py`. Original finding:
  `promote_annotation_to_kb` in `review_annotation_service.py` supplies `pending_review` for wider
  scopes, but `create_kb_entry` in `knowledge_bank_service.py` unconditionally persists `pii_status="clean"`.
  `AnnotationRail.tsx` nevertheless promises review before publishing. Route wider-scope promotion
  through the existing redaction/approval workflow; do not merely trust a client-provided PII status.
  **Accept:** synthetic names remain unavailable to wider-scope readers/search until approved;
  matter-scoped entries retain matter access; repeated promotion does not create duplicate entries.

- [x] **D3 — Returned/rejected drafts have no resubmit path.** Done: `ReviewPane` keeps every round with a
  round selector, shows “Upload revised PDF” once the latest round is returned, and keeps the uploaded
  document ID for a retry if handoff creation fails. `create_handoff` refuses a new round while one is still
  active. Original finding:
  `ReviewPane.tsx` renders its upload control only when there is no handoff; returned rounds still
  render the viewer. Add “Upload revised PDF” for the submitter, preserve previous rounds, and show a
  small round selector. Do not require deleting review history to upload again.
  **Accept:** upload → annotate → return → revise → upload → complete works without deleting a round;
  failed handoff creation after upload offers retry using the uploaded document ID.

- [x] **D4 — Old rounds can change the current action; terminal rounds remain editable.** Done in `dfbaa72`:
  `assert_transition` / `lock_active_handoff` in `review_handoff_service.py`, return/reject only touch the
  action when they are its active round, annotation writes 409 on closed rounds, `can_annotate` on the
  response. Tests in `test_review_lifecycle.py`. Original finding:
  `return_handoff_for_rework` and `reject_handoff` update the linked action without checking its
  `active_handoff_id` (completion/deletion already check it). Status transitions are unrestricted,
  and annotation writes do not check handoff status. The viewer hides completion controls for terminal
  rounds but still enables selection and rail edits using `isReviewer` alone.
  Centralize allowed transitions and current-round checks in `review_handoff_service.py`; enforce
  them transactionally, including completion racing with a new annotation. Preserve read-only history.
  **Accept:** returning/rejecting an old round cannot reset a newer round; completed rounds cannot
  acquire unresolved marks; two simultaneous terminal actions produce one consistent result.

### 2. Redlining fidelity and usability

- [ ] **R1 — Do not carry old coordinates onto a revised PDF.**
  `_carry_forward_annotations` copies `page_no` and `anchor_rects` unchanged into a different document.
  An inserted paragraph/page can place criticism on unrelated wording. For the demo, show carried
  items as “From previous round — locate in revised draft” without an overlay until explicitly re-anchored.
  Retain the quote, prior document link, and `previous_annotation_id`; automatic quote matching can wait.
  **Accept:** a revised draft with an inserted page never displays stale coordinates as a valid mark.

- [ ] **R2 — Preserve reply history across rounds.**
  The same function reassigns `reply.annotation_id`, removing replies from the previous annotation.
  Keep replies on their original round; display linked earlier discussion through the previous-annotation
  relationship (with access checks), or copy a clearly labelled snapshot.
  **Accept:** both old-round history and new-round context remain readable after resubmission.

- [ ] **R3 — Multi-page selections lose overlays after the first page.**
  `ReviewPane.renderHighlights` filters by `a.pageNo === pageIndex + 1` before filtering individual
  rectangles. Creation stores only the first page in `pageNo`, although rectangles can span pages.
  Select annotations by their rectangle page indexes; use `pageNo` only for rail grouping.
  **Accept:** one selection spanning two pages renders on both before/after refresh and at different zooms.

- [ ] **R4 — Export repeats every multiline mark and truncates review content.**
  `export_flattened_pdf` adds an annotation to a page's list once per rectangle, then loops all its
  rectangles again: N same-page rectangles generate N² drawing operations, darkening highlights.
  Group `(annotation, rectangle)` pairs or deduplicate annotations per page. `_append_notes_page`
  slices quotes/replacements/notes to 80/100/120 characters, does not wrap text, and omits highlight/
  strike notes. Export full wrapped text, page references, stable annotation numbers, and statuses;
  explicitly distinguish rejected suggestions from accepted changes.
  **Accept:** three-line marks draw once per rectangle; long clauses and Unicode survive export;
  each callout can be matched to its page mark. Export remains annotations, not Word tracked changes.

- [ ] **R5 — Verify and fix rotated/cropped PDF export geometry.**
  Export swaps width/height for 90°/270° but merges the overlay onto an unnormalized source page;
  it uses MediaBox and ignores CropBox origin. Likely misalignment needs rendered fixture verification.
  Normalize page rotation/boxes or apply explicit transforms shared by all annotation kinds.
  **Accept:** visually compare viewer and exported output for 0/90/180/270° pages, cropped pages,
  multiline selections, and mixed page sizes. Do not claim fidelity from byte-level tests alone.

- [ ] **R6 — Keep drafts and show actionable failures.**
  `ReviewPane` cancels selection/editor before the save request succeeds. Complete/return/export
  errors and rail status/delete failures have no visible feedback. Handoff-list errors can look like
  an empty upload state; removal errors are stored in state only rendered by the no-handoff branch.
  Keep suggestion text until save succeeds, show retryable errors at the relevant control, and disable
  duplicate/conflicting mutations. Reset file URL/error when the document changes and ignore stale loads.
  **Accept:** simulated 403/500/network errors preserve text and show a retry; switching PDFs after a
  failed load works; failed delete does not look successful; loading never looks like an empty review.

- [ ] **R7 — Place selection controls next to the selected text.**
  Both highlight render callbacks return absolutely positioned wrappers without selection-relative
  top/left placement. Use the plugin's selection region, clamp to the viewer, and verify after selection
  settles. Add selected-annotation emphasis, clear open/resolved filtering, and keyboard-accessible
  controls using the existing visual language.
  **Accept:** toolbar stays visible near selection at page edges and mobile widths; selecting text
  does not jump the viewport; clicking a rail card identifies the corresponding mark.

- [ ] **R8 — Validate annotation geometry and PDF review inputs.**
  `ReviewAnnotationCreate.anchor_rects` is `list[dict]`; missing keys reach exporter indexing and can
  cause 500s. Empty rectangles, invalid page indexes, non-finite/out-of-bounds percentages and explicit
  `status: null` updates need validation. `create_handoff` checks ownership but not PDF type/storage
  availability; the frontend's `accept=".pdf"` is only a picker hint.
  Introduce a typed rectangle schema and server-side PDF eligibility checks; allow extraction still
  processing when the original PDF is viewable. **Accept:** malformed requests return 4xx, valid
  cross-page rectangles survive API mapping, and DOCX cannot enter the PDF review flow.

- [ ] **R9 — Handle scanned PDFs honestly.**
  `ingestion_service._extract_pdf_ocr` produces text blocks, not a searchable replacement PDF;
  the viewer fetches the original file. OCR ingestion therefore does not make image-only PDFs selectable.
  Show a no-text-layer explanation and offer document-level comments for the demo; defer OCR PDF
  regeneration or area annotations. **Accept:** a scan has a usable fallback and never misleadingly
  instructs the reviewer to select unavailable text. Correct the assumption in the redlining design doc.

### 3. Focused refactors — fold into the fixes they support

- [ ] **F1 — Extract review data/mutations from `ReviewPane.tsx`.** Add a feature-local
  `useReviewHandoff` hook owning query keys, active/history selection, mutations and invalidation;
  separate upload/round controls and the PDF viewer. Refresh detail, action list and review-count
  queries together. Extract the annotation overlay renderer with R3, and reuse the shared dialog
  for reject/promote forms. Avoid adding another state library.
- [ ] **F2 — Separate export layout from annotation CRUD.** Move PDF drawing/appendix logic out of
  `review_annotation_service.py` into `review_pdf_export_service.py`; keep authorization at the
  service boundary and storage loading separate from pure bytes/annotation rendering. Add synthetic
  fixtures covering R4/R5 as part of the extraction, rather than a cosmetic file split.
- [ ] **F3 — Centralize review policy, not a generic workflow engine.** Share explicit capability
  and transition helpers between handoff and annotation services for D1/D4. Keep thin routers,
  existing SQLAlchemy transactions, and the embedded worker.
- [ ] **F4 — Split API implementation behind the existing `shared/api/api.ts` facade.** Start with
  shared authenticated JSON/blob/form/SSE transport, then a review/documents module. Preserve the
  established import path and snake_case mapping boundary; regression-check errors and aborts.
  Broader App/KB decomposition is post-demo unless it is required for a concrete bug.

### 4. Demo checks and what can wait

- [ ] Add CI for the actual current commands: backend `unittest` discovery, frontend lint and build.
  Add focused policy/transition/export tests and frontend review mutation/overlay tests with these fixes.
- [ ] Rehearse with submitter, reviewer and unrelated user: upload PDF → annotate → reply → return →
  resubmit → resolve → complete → export → promote → retrieve approved KB content. Repeat with reload,
  expired login, failed save, scan, long clause, rotated PDF, and a narrow viewport.
- [ ] Address the single-response survey validation and chat final-answer/disconnect cases in the
  retained inventory next, each with a regression test. Reproduce before changing agent-loop policy.
- [ ] Align `plan.md`'s old email/password and hosting recommendations with Google OAuth/Railway in
  `AGENTS.md` and README. Keep the source-of-truth file in place; moving it alone provides little benefit.
- [ ] Explicitly document single-firm synthetic demo scope. Defer multi-tenant rollout, refresh-token
  redesign, independent worker infrastructure, broad performance work and whole-app refactoring.
  Permission and PII bugs above still need fixes; “demo” is not a reason to bypass access checks.

**Recommended implementation slices:** D1/D2 → D3/D4/R1/R2 + F1/F3 → R3/R6/R7/R8 → R4/R5 + F2 →
R9 and end-to-end rehearsal → CI/remaining demo bugs → F4 and post-demo work.
Each slice should leave a working review flow and its own regression checks.

---

## Earlier engineering inventory (not fully revalidated)

Repo review of `backend/` (~9k LOC Python) and `frontend/` (~16k LOC TS/TSX), plus infra and tests.
This is the **engineering** backlog: bugs, security, architecture, performance, testing, hygiene.
Product/feature backlog lives in [`docs/todo.md`](docs/todo.md) — the two are meant to be read together.

Severity: **P0** = broken or exploitable now · **P1** = will bite in production · **P2** = cleanup / long-term health.

---

## 1. Bugs

### ~~P0 — Test suite is red on `main`~~ ✅ fixed
The threshold of `5` was the deliberate cost decision; the test was the stale side. Extracted
`needs_resummary(archived, summarised_up_to)` from `_maybe_refresh_summary` and replaced the
constant assertion with two behavioural tests. CI still outstanding (see §5).

### ~~P0 — `MAX_MEMORY_RESULTS` is declared but never applied~~ ✅ fixed
`list_memories` gained a `contains` filter (SQL `ilike`, wildcards escaped); the `search_memories`
tool now passes it along with `limit=MAX_MEMORY_RESULTS`.

### P1 — Single-response survey endpoint skips validation the batch endpoint performs
`submit_survey_responses` (`app/services/survey_service.py`) verifies every `question_id` exists and
`is_active`. `submit_survey_response` — behind `POST /survey/responses` — does not. An unknown
`question_id` reaches the DB and surfaces as an unhandled `IntegrityError` → 500, and an *inactive*
question can still be answered, quietly polluting cohort aggregates.

Extract the validation and call it from both paths.

### P1 — Agent loop can end with no answer at all
`run_agent_loop` (`app/services/agent_service.py`) breaks out of the round loop only when the model
returns no tool calls. If the model emits tool calls on the final forced round (tools disabled, but
DeepSeek does sometimes emit its DSML markup regardless), the loop falls through to a bare
`db.commit()` and yields nothing. The router then reports "DeepSeek returned an empty response" and
the user's turn is lost after 5 LLM round-trips.

Add an explicit final fallback: if the final round produced no content, re-ask without tools, or
surface the accumulated tool results as a degraded answer.

### P1 — Duplicate-tool-call detection is too aggressive
`previous_fingerprints` accumulates across **all** rounds, so a legitimate repeat of the same query
later in a multi-step investigation short-circuits the loop to "you are repeating yourself". Scope
the fingerprint set to consecutive rounds only.

### P1 — Client disconnect mid-stream discards the assistant message
In `POST /chat/stream` (`app/routers/chat.py`), the message is persisted only after the generator
finishes. Close the tab mid-answer and the user's question is saved but the reply is gone forever.
Persist incrementally, or catch disconnect and flush what was generated.

### P2 — Lint failure fixed in this pass
Removed the unused `_onActionStateChange` destructuring binding from
`frontend/src/features/actions/components/ActionDetailDialog.tsx`; retained the public prop contract.

### P2 — Dead code in the chat layer
`create_chat_request` (`app/services/chat_service.py:319`) is unreachable — superseded by
`prepare_agent_context`. `save_assistant_response` (`:461`) is imported in
`app/routers/chat.py:35` and never called. Delete both.

---

## 2. Security

### ~~P0 — Encryption key is derived from `JWT_SECRET_KEY`~~ ✅ fixed
Added `FIELD_ENCRYPTION_KEY`; new values are written with an `enc:v1:` key-id prefix. Legacy bare
`enc:` values still decrypt via the JWT-derived key, so nothing existing is lost and the JWT secret
is now free to rotate. **Follow-up:** a backfill that re-encrypts legacy `enc:` values as `enc:v1:`,
after which the legacy path can be deleted.

### ~~P0 — Production admin defaults to a personal email address~~ ✅ fixed
`admin_emails` now defaults to `[]`, and `Settings` raises at startup when `ADMIN_EMAILS` or
`FIELD_ENCRYPTION_KEY` is unset outside development (new `ENVIRONMENT` setting; dev/local/test are
treated as development). `ADMIN_EMAILS` must be set on every non-dev deployment.

### P1 — No tenant isolation; `firm_wide` means "every user in the database"
There is no organization/firm entity. `list_firm_users` returns every `User` row to any
authenticated caller; `firm_wide` KB entries are readable by anyone who logs in; `/audit-log`
returns all audit rows; the action board is global by design. For a demo with one firm this is
consistent — as a *legal* product it's the biggest architectural liability here, and it gets
expensive to retrofit once data exists.

Decide now: document "single-tenant by design" prominently, or add `organization_id` to `User`,
`Team`, `Matter`, `Document`, `KnowledgeBankEntry` and thread it through every access filter.

### P1 — Bearer token accepted as a URL query parameter
`GET /documents/{id}/file?token=...` (`app/routers/documents.py`) accepts the JWT in the query
string so `<iframe>`/PDF.js can load it. That token — valid for **7 days**, non-revocable — lands in
access logs, proxy logs, browser history, and `Referer` headers.

Replace with a short-lived (60s), single-purpose signed URL token scoped to one document id.

### P1 — JWTs: 7-day lifetime, no revocation, stored in `localStorage`
`access_token_expire_minutes = 60 * 24 * 7` (`app/config.py`), stored via
`localStorage.setItem('token', ...)` (`frontend/src/app/App.tsx:240`). Any XSS is a week-long full
account takeover, and a compromised token cannot be invalidated — role changes and de-provisioning
don't take effect until expiry.

Short-lived access token + refresh token, and a `jti`/token-version column checked on each request.
Note `docs/todo.md` already has "fix authentication timeout" open — solve both together.

### P1 — Google token verification doesn't check `email_verified`
`verify_google_token` (`app/auth.py`) accepts any successfully-verified ID token and
`get_or_create_user` trusts `google_info["email"]` outright. Assert `email_verified is True` (and,
if this is ever firm-internal, pin the `hd` domain claim) before minting a session.

### P1 — Prompt injection through uploaded documents
`read_document` returns up to 100KB of untrusted document text straight into the context of a model
that holds live, RBAC-bearing tools. A crafted PDF can instruct the agent to fetch and echo other
KB entries. The tools do re-check permissions per call (`check_kb_read` in `_execute_tool`) — which
is the right defence and worth preserving — but nothing constrains what the model is told to *do*.

Delimit tool output as untrusted data in the prompt, and add an integration test that uploads a
document containing an injection payload and asserts no cross-scope leak.

### P2 — Unredacted PII is persisted alongside the redacted copy
`PiiRedaction.original_content` (`promote_kb_entry`) stores the full pre-redaction text in plaintext,
indefinitely, with no TTL — defeating much of the point of the redaction flow. Encrypt it or expire
it after approval.

### P2 — Redaction is naive string replacement
`_propose_redactions` does `redacted.replace(original, replacement)` — exact-match only. Case
variants, possessives ("Acme's"), hyphenation, and line-wrapped names survive. The regex fallback
covers only case numbers, emails, and currency. Add case-insensitive and word-boundary matching, and
surface a confidence signal in the review UI rather than implying completeness.

### P2 — `/config` is unauthenticated
`app/routers/system.py` exposes the model name and DeepSeek base URL to anonymous callers. Minor,
but free to fix.

### P2 — No rate limiting on LLM endpoints
`/chat/stream` and `/birdie/stream` have no per-user throttle. Upload guards landed recently
(`_check_upload_limits`); chat is the more expensive surface. One authenticated user can run the
DeepSeek bill up without limit.

---

## 3. Architecture

### P1 — DB connections are held for the entire LLM stream
`get_db` yields a session that stays open for the whole SSE response — verified: FastAPI closes
`yield` dependencies *after* the streaming generator completes. With a Pro-model agent turn running
minutes and `create_engine(..., pool_pre_ping=True)` (`app/database.py:10`) using SQLAlchemy's
default pool of 5 + 10 overflow, roughly 15 concurrent chats exhaust the pool and every other
request blocks.

Fix in two parts: set explicit `pool_size` / `max_overflow` / `pool_recycle`, and have the streaming
path open short-lived sessions per tool call instead of holding one across the whole turn.

### P1 — `frontend/src/shared/api/api.ts` is a 1,968-line module
Every backend call for every domain lives in one file, and the auth-header logic is duplicated **five
times** (lines 256, 531, 575, 737, 1478, 1942) because `request()` doesn't cover FormData, blobs, or
SSE. A change to auth handling means six edits.

Split into `shared/api/{chat,documents,kb,wiki,actions,surveys,birdie}.ts` over a shared
`http.ts` exposing `request`, `requestBlob`, `requestForm`, and `requestStream`.

### P1 — `App.tsx` is a 778-line god component
It owns auth, navigation, streaming, matter selection, model selection, upload state, and error
state, then prop-drills into every panel. `KnowledgeBankPanel.tsx` (1,406 lines) and
`ReviewPane.tsx` (754) have the same problem one level down.

Extract `useAuthSession`, `useChatStream`, and `useMatterSelection` hooks; move cross-cutting state
(user, selected matter, model) into context so panels stop taking a dozen props.

### P1 — Embedded worker shares the API process
`main.py` runs the worker on a thread inside the web process. Deliberate and documented — but it
means a document OCR spike starves the API's CPU, deploys interrupt in-flight jobs (mitigated by
`_release_active_claims`, which is good), and worker and API can't scale independently.
`GLOBAL_CONCURRENCY = 2` caps throughput firm-wide.

Path forward: keep the embedded worker as the default for demos, but make it opt-out
(`RUN_EMBEDDED_WORKER=false`) so a separate Railway service can run `make worker` in production.

### P2 — `print()` instead of `logging`
33 `print()` calls across `app/`; only `resource_metadata_service.py` uses the `logging` module. No
levels, no request correlation, no structure. Standardise on `logging` with a JSON formatter and a
request id in middleware.

### P2 — 41 broad `except Exception` blocks
Worker slots and tool dispatch legitimately need them, but several swallow errors that should
surface — e.g. `_execute_tool` turns any failure into the string "search unavailable", which the LLM
then narrates to the user as fact. Narrow the catches and log with tracebacks.

### P2 — `boto3` client rebuilt on every R2 operation
`storage_service.py` calls `r2_client()` fresh in `upload`/`download`/`delete` (lines 61, 79, 101).
Each call re-resolves credentials and builds a botocore session — tens of ms per document operation.
Cache it with `@lru_cache`.

### P2 — `resource_metadata` duplicates access control
The metadata index re-implements the scope rules that already live in `dependencies.py` and each
service's access filter. Two RBAC implementations will drift, and the one that drifts silently is
the one that over-shares. Derive the metadata filter from the same predicates rather than restating
them.

### P2 — Import ordering in `resource_metadata_service.py`
Module-level code (`sync_metadata_safe`) is defined before the `from app.models import ...` block at
line 18. It works, but it reads as an accident and will confuse the next reader.

---

## 4. Performance & cost

### P1 — Memory extraction runs a second full LLM call on every chat turn
`extract_memory_candidates` (`app/services/memory_service.py`) uses the **default model**
(`deepseek-v4-pro`) after every single message. It roughly doubles per-turn cost for a background
task where Flash is plenty. Pass `model="deepseek-v4-flash"` and consider batching it every N turns
rather than every turn.

### P1 — `backfill_missing_kb_embeddings` loads the entire KB into memory
`app/services/knowledge_bank_service.py` selects **all** entries with their 1536-dimension vectors,
then computes staleness in Python. At a few thousand entries that's hundreds of MB per admin click.
Compare `embedding_content_hash` in SQL and page the results.

### P1 — Thread summarisation re-reads the whole thread
`_maybe_refresh_summary` → `_get_all_messages` fetches every message in the thread each time it
fires. Fetch only the un-summarised slice using the existing `summary_up_to` cursor.

### P2 — `save_memory_candidates` loads all of a user's memories to dedupe
Replace the Python set-membership check with a `SELECT ... WHERE lower(content) IN (...)`.

### P2 — Survey trend query is unbounded in time
`_survey_trends_statement` aggregates every week ever recorded and returns it all to the dashboard.
Add a rolling window (e.g. last 12 weeks).

### P2 — OCR converts every page at 150 DPI with no page cap
`_extract_pdf_ocr` (`app/services/ingestion_service.py`) calls `convert_from_bytes` on the whole
document at once. A 500-page scanned PDF inside the 25MB limit will OOM the extraction subprocess —
which is precisely the "possible OOM or timeout" failure the retry logic already anticipates. Stream
page-by-page and cap the page count.

### P2 — Upload size is checked only after the full body is read
`upload_document` (`app/routers/documents.py`) does `await file.read()` and *then* compares against
`MAX_UPLOAD_BYTES`. Starlette spools to disk so it isn't a memory kill, but there's no bound on what
a client can push before rejection. Check `Content-Length` up front and stream to a bounded buffer.

### P2 — RAG search has no relevance floor
`search_documents` always returns the top 6 chunks regardless of cosine distance, so a question with
no relevant documents still gets six irrelevant chunks presented as context. Add a distance
threshold.

---

## 5. Testing

Coverage remains limited. The current working tree passes 22 unittest tests, including behavioral
summary tests and pre-existing security/encryption fixes. Review lifecycle, export fidelity and
real-database authorization still need regression coverage; old LOC counts are not current evidence.

- [ ] **P0 — Add CI.** No GitHub Actions workflow exists. Run `pytest`, `tsc -b`, and `eslint` on
      every push. Use the verified unittest command above for the current backend suite.
- [ ] **P0 — Integration tests for RBAC.** The security model is the product. Test with a real
      Postgres (testcontainers or a CI service container) that: an associate cannot read another
      matter's documents; `check_kb_read` holds for all four scopes; a non-member cannot reach
      `/documents/{id}/file`; the agent's `get_kb_entry` tool denies out-of-scope entries.
- [ ] **P1 — Worker claim tests.** `SELECT ... FOR UPDATE SKIP LOCKED`, stale reclaim, and
      `MAX_PROCESSING_ATTEMPTS` exhaustion are subtle concurrency code with zero coverage.
- [ ] **P1 — Agent loop tests** against a stubbed provider: tool dispatch, the DSML stripper
      (including a marker split across chunk boundaries), cycle detection, and the final-round
      fallthrough from §1.
- [ ] **P2 — Frontend tests.** No test runner is configured at all. Start with Vitest over
      `api.ts` mapping functions and the SSE parser in `streamChatMessage`.

---

## 6. Hygiene

- [x] **P1 — `AGENTS.md` migration head corrected.** Both references now match
      `alembic heads`: `w8f9a0b1c2d3` (`add_document_file_size`).
- [ ] **P2 — Delete or relocate `lexcatalyst-v2.html`.** An 88KB static design prototype sitting in
      the repo root, tracked in git, mode `600`, superseded by the React app. Move it to `docs/` or
      drop it.
- [ ] **P2 — `outputs/` holds a stray UUID directory.** Untracked build noise; add to `.gitignore`
      or remove.
- [ ] **P2 — `.DS_Store` files** exist under `frontend/` and `frontend/src/`. Gitignored, so
      untracked — just delete them.
- [ ] **P2 — Type-check hook only runs on `Edit|Write`.** `.claude/settings.json` swallows all
      output with `2>/dev/null || true`, so a type error produces silence. Let it report.
- [ ] **P2 — `plan.md` at root vs `docs/`.** Every other design doc lives under `docs/`; `plan.md`
      is the declared source of truth but sits outside it. Move it to `docs/plan.md`.

---

## Earlier suggested order (superseded by the demo-first plan above)

1. **§1 P0 bugs** — red test, unbounded memory tool. Hours, not days.
2. **§2 P0 security** — the `JWT_SECRET_KEY`-derived encryption key and the hardcoded admin email.
   Both are one-line changes with a migration; both are catastrophic if left.
3. **§5 CI** — lock in 1 and 2 so they can't regress, before touching anything else.
4. **§3 P1 connection pooling** — the first thing that breaks under real concurrent use.
5. **§2 P1 tenancy decision** — not necessarily *build* it, but decide and write it down. The cost
   of retrofitting only goes up.
6. Everything else, opportunistically.
