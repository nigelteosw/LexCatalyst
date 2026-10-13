# Mentorship Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mentor ↔ mentee pairings, a source-agnostic feedback model, lessons with themes, and a mentor view, so Birdie and LexChat can coach from a mentor's feedback wherever it came from.

**Architecture:** Two new tables (`mentor_pairings`, `mentor_feedback`) plus an extended `review_lessons`. Two new services own the rules: `mentorship_service` (pairings and "can X read mentee Y") and `feedback_service` (feedback rows). `lesson_service` is generalised from per-round to per-mentee. A thin `/mentorship` router sits on top, and the old `/birdie/lessons*` routes become wrappers. Frontend adds a Mentorship page and a Mentoring section in Team Management.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Postgres (tests use in-memory SQLite, `unittest`), React + TypeScript + React Query, Bun.

**Spec:** `docs/superpowers/specs/2026-10-13-mentorship-core-design.md`

## Global Constraints

- Every read starts from `require_class_context` and checks the row's `class_id`. Admin status and `firm_role` never bypass access (AGENTS.md "Legal Data Rules").
- Mentee-audience feedback is readable only by: the mentee, its author, and a mentor with an **active** pairing to that mentee. Team-audience feedback is readable by every active member of that class.
- A mentee's chats, Birdie threads, memories and private documents are never exposed to mentors.
- Distilling runs on the **acting user's** OpenRouter key via `get_llm(db, user.id, feature="lessons")`. Feedback text and quoted passages leave for OpenRouter; keep the disclosure in the `lesson_service` docstring and README.
- Themes: normalised to title case, max 40 chars. Lessons per distil call: max 4 (`MAX_LESSONS`).
- Pairing eligibility: mentor must be an active member with role `owner` or `mentor`; mentee must be an active member; mentor ≠ mentee. Only `owner`/`mentor` create or end pairings; an owner may pair anyone, a mentor may only create pairings where they are the mentor.
- Backend errors use `ClassAccessError(detail, status_code)` (existing pattern). Routers translate it with `HTTPException(status_code=exc.status_code, detail=str(exc))`.
- All frontend API calls live in `frontend/src/shared/api/api.ts`, mapping snake_case to camelCase there.
- Alembic head moves from `b5c6d7e8f9a0` to `c6d7e8f9a0b1`; update `AGENTS.md` and `tests/test_class_schema.py`.

**Decisions that differ from the spec (made to limit churn):**
1. The table stays `review_lessons` and the model stays `ReviewLesson`. Renaming would touch `class_boundary.py`, `class_migration_service.py`, the b5c6 composite FK and several tests for no behavioural gain.
2. The LLM feature key stays `"lessons"` (stored per-user tier settings keep working) instead of a new `mentorship_lessons`.
3. `mentor_feedback.handoff_id` has no composite same-class FK; `feedback_service` checks `handoff.class_id == class_id` instead.

## Review Focus

- A mentor whose pairing ends (or who is demoted or removed) loses read access to that mentee's feedback and lessons immediately, but keeps feedback they authored. (Tasks 2, 3)
- Returning or completing the same round more than once never duplicates feedback. (Task 3)
- A mentor paired to mentee A cannot read mentee B's feedback or lessons. (Task 3)
- The model returning source ids that belong to someone else, or invalid JSON, writes no lessons and no partial rows. (Task 4)
- Feedback whose author account was deleted (`author_user_id` null) still lists, showing `author_name`. (Task 3)

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models.py` (modify) | `MentorPairing`, `MentorFeedback`; extend `ReviewLesson` |
| `backend/migrations/versions/c6d7e8f9a0b1_mentorship_core.py` (create) | Tables, columns, backfill |
| `backend/app/services/mentorship_service.py` (create) | Pairings and read-access predicates |
| `backend/app/services/feedback_service.py` (create) | Feedback rows, round snapshot, guidance; owns `is_feedback` |
| `backend/app/services/lesson_service.py` (modify) | Distil per mentee, themes, list, context |
| `backend/app/services/mentorship_class_service.py` (modify) | End pairings on removal/demotion |
| `backend/app/services/review_handoff_service.py` (modify) | Snapshot feedback on return/complete |
| `backend/app/routers/mentorship.py` (create) | `/mentorship/*` |
| `backend/app/routers/birdie.py` (modify) | Legacy lesson routes call the new service |
| `backend/app/schemas.py` (modify) | Request/response models |
| `backend/app/services/{birdie_service,chat_service}.py` (modify) | Use `format_mentorship_context` |
| `frontend/src/features/mentorship/` (create) | `MentorshipPage.tsx`, `themes.ts` |
| `frontend/src/features/classes/MentoringSection.tsx` (create) | Pairing management |

---

### Task 1: Schema, migration and registries

**Files:**
- Modify: `backend/app/models.py` (add models near `ReviewLesson`, ~line 971; alter `ReviewLesson`)
- Create: `backend/migrations/versions/c6d7e8f9a0b1_mentorship_core.py`
- Modify: `backend/tests/test_class_schema.py` (head id), `backend/app/services/property_workboard_demo_service.py:269`, `backend/tests/test_class_review_isolation.py:66`, `AGENTS.md` ("Current head" twice)
- Test: `backend/tests/test_mentorship_schema.py`

**Interfaces:**
- Produces: `MentorPairing(id, class_id, mentor_user_id, mentee_user_id, created_by, created_at, ended_at)`.
- Produces: `MentorFeedback(id, class_id, audience, mentee_user_id, author_user_id, author_name, source, handoff_id, annotation_id, source_url, source_title, anchor_quote, suggested_text, note, created_by, created_at, deleted_at)`.
- Produces: `ReviewLesson` gains `mentee_user_id: str` (NOT NULL), `theme: str` (default `"General"`), `source_feedback_ids: list` (replaces `source_annotation_ids`); `handoff_id` becomes nullable.

- [ ] **Step 1: Write failing tests** in `test_mentorship_schema.py`:
  - `test_new_tables_have_non_null_class_id` (both tables, `class_id` not nullable).
  - `test_pairing_rejects_self_pairing`: inserting `mentor_user_id == mentee_user_id` raises `IntegrityError` (SQLite, `CheckConstraint`).
  - `test_active_pairing_is_unique`: two rows with the same triple and `ended_at IS NULL` raise `IntegrityError`; an ended one plus a new active one is allowed.
  - `test_feedback_annotation_id_unique`: two rows with the same non-null `annotation_id` raise `IntegrityError`.
  - `test_lesson_handoff_id_nullable`.
- [ ] **Step 2: Run** `cd backend && source .venv/bin/activate && python -m pytest tests/test_mentorship_schema.py -v`. Expected: FAIL (names not defined).
- [ ] **Step 3: Implement the models** in `models.py`. `MentorPairing` has a `CheckConstraint("mentor_user_id <> mentee_user_id", name="ck_mentor_pairings_distinct")` and a partial unique `Index("uq_mentor_pairings_active", "class_id", "mentor_user_id", "mentee_user_id", unique=True, postgresql_where=text("ended_at IS NULL"), sqlite_where=text("ended_at IS NULL"))`. `MentorFeedback.annotation_id` is `ForeignKey("review_annotations.id", ondelete="SET NULL")` with `unique=True`; `handoff_id` `ondelete="SET NULL"`; `audience` and `source` are `String(20)`; a `CheckConstraint` limits `audience IN ('mentee','team')` and `source IN ('review_round','captured_comment','guidance')`. Add `author`/`mentee` relationships to `User` (`foreign_keys=` explicit).
- [ ] **Step 4: Implement the migration** `c6d7e8f9a0b1` (down_revision `b5c6d7e8f9a0`): create both tables and indexes; alter `review_lessons` (add `mentee_user_id` nullable, `theme` server_default `'General'`, `source_feedback_ids` JSON default `[]`; make `handoff_id` nullable). **Backfill in Python with core tables defined inline**: for each `review_handoffs` row with status in (`returned`,`completed`), insert one `mentor_feedback` per annotation passing the `is_feedback` rule (author ≠ submitter, no `previous_annotation_id`, non-blank note or suggested text), `source='review_round'`, `audience='mentee'`, `mentee_user_id=submitted_by`, `created_by=author_user_id or submitted_by`, `author_name` from the author's `full_name or email`. Then set each lesson's `mentee_user_id` from its handoff's `submitted_by`, translate `source_annotation_ids` to `source_feedback_ids` through `annotation_id`, then set `mentee_user_id` NOT NULL and drop `source_annotation_ids`. Downgrade reverses the schema changes (data loss for new rows is acceptable; say so in the docstring).
- [ ] **Step 5:** Update `ReviewLesson(...)` in `property_workboard_demo_service.py` to pass `mentee_user_id=<the round's submitter id>` and drop `source_annotation_ids` (create matching `MentorFeedback` rows with `source="review_round"`, and pass their ids as `source_feedback_ids`). Fix `test_class_review_isolation.py` and `test_property_workboard_demo.py` for the new required column. Change the head id in `test_class_schema.py` and the two "Current head" mentions in `AGENTS.md` to `c6d7e8f9a0b1`.
- [ ] **Step 6: Run** the new test file, then `python -m pytest tests -q`. Expected: all PASS (Postgres migration test skips without `TEST_DATABASE_URL`). If any registry test names tables with `class_id` (e.g. `CONTENT_TABLES`) and fails on the new tables, register them there.
- [ ] **Step 7:** If Postgres is available, run `TEST_DATABASE_URL=… python -m pytest tests/test_class_migration_postgres.py -v`, then `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` against local Docker Postgres.
- [ ] **Step 8: Commit** `feat(mentorship): pairing, feedback tables and lesson columns`.

---

### Task 2: Pairings service and membership hooks

**Files:**
- Create: `backend/app/services/mentorship_service.py`
- Modify: `backend/app/services/mentorship_class_service.py` (`remove_member` ~220, `set_member_role` ~254)
- Test: `backend/tests/test_mentorship_pairings.py`

**Interfaces:**
- Consumes: `ClassContext(user_id, class_id, role)`, `ClassAccessError`, `require_class_role` from `mentorship_class_service`.
- Produces (all in `mentorship_service`):
  - `create_pairing(db, *, context: ClassContext, mentor_user_id: str, mentee_user_id: str) -> MentorPairing`
  - `end_pairing(db, *, context: ClassContext, pairing_id: str) -> None`
  - `list_pairings(db, *, context: ClassContext) -> list[MentorPairing]` (active only)
  - `relationships_for(db, *, context: ClassContext) -> tuple[list[User], list[User]]` (mentors of me, mentees of me)
  - `is_active_mentor_of(db, *, class_id: str, mentor_user_id: str, mentee_user_id: str) -> bool`
  - `can_read_mentee(db, *, context: ClassContext, mentee_user_id: str) -> bool` (self, or active mentor of them)

- [ ] **Step 1: Write failing tests** (SQLite, create only the tables used: `User`, `MentorshipClass`, `ClassMembership`, `MentorPairing`, `ClassAuditEvent`):
  - `test_owner_can_pair_any_mentor_and_mentee`
  - `test_mentor_can_only_pair_themselves_as_mentor` → `ClassAccessError` status 403
  - `test_plain_member_cannot_create_pairing` → 403
  - `test_ineligible_mentor_role_rejected` (mentor is a plain `member`) → 422
  - `test_cross_class_or_inactive_user_returns_404`
  - `test_duplicate_active_pairing_rejected` → 409
  - `test_end_pairing_sets_ended_at_and_revokes_can_read_mentee`
  - `test_remove_member_ends_their_pairings_both_directions`
  - `test_demoting_mentor_to_member_ends_pairings_where_they_are_mentor` but leaves ones where they are the mentee
- [ ] **Step 2: Run** `python -m pytest tests/test_mentorship_pairings.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement `mentorship_service`** with the signatures above. Pairing creation locks both membership rows (`with_for_update()`, as the class service does) and writes a `ClassAuditEvent` (`pairing_created`, `pairing_ended`).
- [ ] **Step 4: In `mentorship_class_service`**, add a private `_end_pairings(db, class_id, user_id, *, mentor_only=False)` that sets `ended_at` on active `MentorPairing` rows directly (do **not** import `mentorship_service`: it imports this module). Call it in `remove_member` (both directions) and in `set_member_role` when `role == "member"` (`mentor_only=True`), before the commit.
- [ ] **Step 5: Run** the new tests plus `tests/test_class_membership.py`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(mentorship): mentor pairings with access predicates`.

---

### Task 3: Feedback service and round snapshot

**Files:**
- Create: `backend/app/services/feedback_service.py`
- Modify: `backend/app/services/lesson_service.py` (import `is_feedback` from `feedback_service`; keep the name importable), `backend/app/services/review_handoff_service.py` (`update_handoff_status` ~444, `_return_handoff` ~493)
- Test: `backend/tests/test_mentorship_feedback.py`; keep `tests/test_birdie_lessons.py` passing

**Interfaces:**
- Consumes: `mentorship_service.is_active_mentor_of`, `can_read_mentee`.
- Produces (in `feedback_service`):
  - `is_feedback(annotation, handoff) -> bool` (moved verbatim from `lesson_service`)
  - `snapshot_round_feedback(db, handoff: ReviewHandoff) -> int` (adds missing rows and flushes, no commit; returns the number created)
  - `create_guidance(db, *, context: ClassContext, audience: str, mentee_user_id: str | None, note: str, anchor_quote: str | None = None, suggested_text: str | None = None) -> MentorFeedback`
  - `list_feedback(db, *, context: ClassContext, mentee_user_id: str | None = None, source: str | None = None, audience: str | None = None, limit: int = 100) -> list[MentorFeedback]` (newest first, access-filtered, `deleted_at IS NULL`)
  - `update_feedback(db, *, context, feedback_id: str, note: str | None = None, anchor_quote: str | None = None, suggested_text: str | None = None) -> MentorFeedback`
  - `delete_feedback(db, *, context, feedback_id: str) -> None` (soft delete)

- [ ] **Step 1: Write failing tests** (SQLite; tables include `ReviewHandoff`, `ReviewAnnotation`, `Document`, `Matter`, `ActionItem`, `MentorPairing`, `MentorFeedback`):
  - `test_snapshot_copies_only_feedback_annotations` (own marks, carried-forward and blank comments skipped)
  - `test_snapshot_is_idempotent` (call twice → same row count, second call returns 0)
  - `test_snapshot_ignores_later_annotation_edits`
  - `test_snapshot_rejects_handoff_from_another_class` (raises `ClassAccessError`)
  - Access matrix on `list_feedback` for mentee-audience rows: mentee sees it; author sees it; active mentor sees it; **mentor paired to a different mentee sees nothing**; ended-pairing mentor sees nothing except rows they authored; plain member sees nothing; user in another class sees nothing; admin with `firm_role="partner"` and no pairing sees nothing.
  - `test_team_guidance_visible_to_every_active_member`, and `test_team_guidance_requires_owner_or_mentor`
  - `test_mentee_guidance_requires_active_pairing_or_owner`
  - `test_feedback_with_deleted_author_still_lists_with_author_name` (`author_user_id=None`)
  - `test_mentee_cannot_edit_or_delete_mentor_feedback`; `test_author_can_soft_delete` (row hidden afterwards); `test_owner_can_delete_team_guidance`
  - In `tests/test_review_lifecycle.py` style: `test_returning_then_completing_same_round_creates_feedback_once` via `update_handoff_status` / `return_handoff_for_rework`.
- [ ] **Step 2: Run** `python -m pytest tests/test_mentorship_feedback.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement `feedback_service`**. Snapshot values: `mentee_user_id=handoff.submitted_by`, `author_user_id=annotation.author_user_id`, `author_name` = author's `full_name or email` (or "a reviewer" if unknown), `created_by=annotation.author_user_id or handoff.submitted_by`, `source="review_round"`, `audience="mentee"`. Visibility is one SQL filter built from `context` (mentee id, author id, or `mentee_user_id IN` the active pairings where the caller is mentor).
- [ ] **Step 4: Hook the snapshot** into `update_handoff_status` when the new status is `returned` or `completed`, and into `_return_handoff`, both before `db.commit()` so rows land in the same transaction.
- [ ] **Step 5: Update `lesson_service`** to import `is_feedback` from `feedback_service`; confirm `tests/test_birdie_lessons.py` and `tests/test_review_lifecycle.py` still pass.
- [ ] **Step 6: Run** `python -m pytest tests -q`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(mentorship): feedback service and review-round snapshot`.

---

### Task 4: Lessons per mentee, themes, legacy round distil

**Files:**
- Modify: `backend/app/services/lesson_service.py`
- Modify: `backend/tests/test_birdie_lessons.py` (parse tests use new keys)
- Test: `backend/tests/test_mentorship_lessons.py`

**Interfaces:**
- Consumes: `feedback_service.list_feedback`, `mentorship_service.can_read_mentee`.
- Produces (in `lesson_service`):
  - `class NothingToDistill(RuntimeError)`
  - `parse_lessons(raw: str, valid_ids: set[str]) -> list[dict]`: items are `{"title", "body", "theme", "source_feedback_ids"}`; unknown ids dropped; `theme` normalised (title case, ≤40, default `"General"`); still raises `LessonDistillError` when nothing is usable
  - `async distill_lessons(db, *, user: User, mentee_user_id: str | None = None, feedback_ids: list[str] | None = None) -> list[ReviewLesson]`
  - `async distill_round_lessons(db, *, user: User, handoff_id: str) -> list[ReviewLesson]` (the old per-round behaviour, idempotent: returns stored lessons for that `handoff_id` if present)
  - `list_lessons(db, *, context: ClassContext, mentee_user_id: str | None = None) -> list[ReviewLesson]`
  - `@dataclass ThemeSummary(theme: str, count: int, latest: datetime, titles: list[str])`
  - `themes_for_mentee(db, *, context: ClassContext, mentee_user_id: str, days: int = 90) -> list[ThemeSummary]` (sorted by count desc, ≤3 titles each)

- [ ] **Step 1: Write failing tests** (monkeypatch `get_llm` to return an object with `async complete`, as `test_birdie_lessons.py` does):
  - `test_distill_defaults_to_undistilled_mentee_feedback_only` (ids already cited by an earlier lesson are excluded)
  - `test_distill_with_no_feedback_raises_nothing_to_distill`
  - `test_distill_rejects_feedback_ids_the_caller_cannot_read` (a mentor's `feedback_ids` including another mentee's row → `ClassAccessError` 404; no LLM call made)
  - `test_distill_by_active_mentor_stores_lessons_for_the_mentee`; `test_distill_by_unrelated_user_forbidden`
  - `test_invalid_model_json_writes_no_rows` and `test_model_citing_foreign_ids_drops_them_and_keeps_valid_lesson`
  - `test_theme_is_normalised_and_capped`
  - `test_round_distill_is_idempotent` (second call makes no LLM call)
  - `test_themes_group_counts_and_respect_days_window`
  - `test_themes_require_read_access_to_the_mentee`
  - Update `ParseLessonsTests` in `test_birdie_lessons.py` to the new keys.
- [ ] **Step 2: Run** `python -m pytest tests/test_mentorship_lessons.py tests/test_birdie_lessons.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** The prompt keeps the existing rules and adds `theme` and `source_feedback_ids` to the JSON shape. Message lines use `id=<feedback id>`, the quote, suggestion and note, clipped by `_clip`. As today, call `db.rollback()` before the provider call and write all lessons in one commit. The service reloads and re-checks access after the LLM call. `distill_round_lessons` selects feedback rows with that `handoff_id` and `mentee_user_id == user.id`, and stores lessons with `handoff_id` set. Update the module docstring (mentor feedback is no longer submitter-only; state who can distil).
- [ ] **Step 4: Run** `python -m pytest tests -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mentorship): per-mentee lessons with themes`.

---

### Task 5: Mentorship context for Birdie and LexChat

**Files:**
- Modify: `backend/app/services/lesson_service.py` (replace `format_feedback_context`), `backend/app/services/birdie_service.py:38,338`, `backend/app/services/chat_service.py` (system prompt assembly near lines 200–221 and ~407)
- Test: `backend/tests/test_mentorship_context.py`

**Interfaces:**
- Produces: `format_mentorship_context(db, *, user: User) -> str`. It returns `""` when the user has no active class or nothing to show. Otherwise it returns sections titled `"Lessons from the user's mentors:"` (the 8 newest lessons, `[theme] title: body` clipped), `"Recent undistilled feedback on the user's work:"` (5 newest `mentee` rows, in the old `format_feedback_context` line format), and `"Team guidance:"` (5 newest team rows).

- [ ] **Step 1: Write failing tests:**
  - `test_context_includes_own_lessons_feedback_and_team_guidance`
  - `test_context_excludes_other_users_lessons` (a mentor's own coaching context never contains their mentee's lessons)
  - `test_mentor_only_user_gets_team_guidance_only`
  - `test_context_empty_without_class`
  - `test_context_omits_soft_deleted_feedback`
- [ ] **Step 2: Run** `python -m pytest tests/test_mentorship_context.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `format_mentorship_context`; delete `format_feedback_context`. In `birdie_service.py` and `chat_service.py` append it to `system_content` next to the memory context (both LexChat paths, lines ~221 and ~407).
- [ ] **Step 4: Run** `python -m pytest tests -q`. Expected: PASS (update any test that imported `format_feedback_context`).
- [ ] **Step 5: Commit** `feat(mentorship): feed lessons and team guidance into Birdie and LexChat`.

---

### Task 6: API router, schemas and legacy routes

**Files:**
- Create: `backend/app/routers/mentorship.py`
- Modify: `backend/app/routers/__init__.py` (import and add `mentorship.router` after `mentorship_classes.router`), `backend/app/schemas.py` (near `LessonResponse`, ~line 718), `backend/app/routers/birdie.py:136-180`
- Test: `backend/tests/test_mentorship_routes.py` (pattern from `tests/test_class_routes.py`)

**Interfaces:**
- Consumes: all service functions above.
- Produces routes (all `Depends(get_current_user)`, active class required; the class gate already enforces it):

```txt
GET    /mentorship/pairings                       -> list[PairingResponse]
POST   /mentorship/pairings                       body PairingCreate{mentor_user_id, mentee_user_id}
DELETE /mentorship/pairings/{id}
GET    /mentorship/me                             -> MentorshipMeResponse{mentors[], mentees[]}
GET    /mentorship/feedback?mentee_id=&source=&audience=  -> list[MentorFeedbackResponse]
POST   /mentorship/feedback                       body GuidanceCreate{audience, mentee_user_id?, note, anchor_quote?, suggested_text?}
PATCH  /mentorship/feedback/{id}                  body FeedbackUpdate
DELETE /mentorship/feedback/{id}
GET    /mentorship/lessons?mentee_id=             -> list[MentorLessonResponse]
POST   /mentorship/lessons/distill                body DistillRequest{mentee_user_id?, feedback_ids?}
GET    /mentorship/mentees/{id}/themes?days=90    -> list[ThemeResponse]
```

- `PairingResponse` = `{id, mentor_user_id, mentor_name, mentee_user_id, mentee_name, created_at}`. `MentorFeedbackResponse` = `{id, audience, mentee_user_id, author_user_id, author_name, source, handoff_id, source_url, source_title, anchor_quote, suggested_text, note, created_at}`. `MentorLessonResponse` extends the existing `LessonResponse` fields with `theme`, `mentee_user_id`, `handoff_id`, `source_feedback_ids`, `created_at`. Keep `LessonResponse` for the legacy route but add `source_feedback_ids` in place of `source_annotation_ids`.
- Error mapping: `ClassAccessError` → its `status_code`; `NothingToDistill` → 409; `OpenRouterKeyMissing` → 409; `LessonDistillError`/`OpenRouterError` → 502 (same as `birdie.py` today). Validation: `audience="mentee"` requires `mentee_user_id`; `audience="team"` forbids it (422). `note` 1–4000 chars.

- [ ] **Step 1: Write failing route tests** (`TestClient` with dependency overrides, as in `test_class_routes.py`): create/list/end pairing round trip; `GET /mentorship/me` for mentor and mentee; guidance create/list/patch/delete; mentee-audience without `mentee_user_id` → 422; plain member `POST /mentorship/pairings` → 403; distil with mocked LLM returns lessons and a second distil returns 409; themes endpoint; cross-mentee feedback read returns an empty list (not 403, so existence isn't leaked); unauthenticated → 401.
- [ ] **Step 2: Run** `python -m pytest tests/test_mentorship_routes.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** schemas and `routers/mentorship.py`, register the router.
- [ ] **Step 4: Update `/birdie/lessons` and `/birdie/lessons/{handoff_id}/distill`** to call `distill_round_lessons`, mapping `LessonNotFound` → 404 as today; response shape unchanged except lessons carry `source_feedback_ids`. Update the extension and frontend consumers in Task 7 if they read `source_annotation_ids` (`grep -rn source_annotation frontend/src extension/src` — currently only `api.ts`).
- [ ] **Step 5: Run** `python -m pytest tests -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(mentorship): /mentorship API and lesson route wrappers`.

---

### Task 7: Frontend API client, routing and nav

**Files:**
- Modify: `frontend/src/shared/types/workspace.ts` (near `BirdieLesson`, ~line 420), `frontend/src/shared/api/api.ts` (near the lessons block, ~line 2150), `frontend/src/app/routes.ts`, `frontend/src/app/App.tsx` (~749 view switch, ~836 titles), `frontend/src/features/navigation/Sidebar.tsx` (~291)
- Create: `frontend/src/features/mentorship/themes.ts`
- Test: `frontend/tests/mentorship-themes.test.ts`

**Interfaces:**
- Produces types: `MentorPairing`, `MentorFeedback`, `MentorLesson` (adds `theme`, `menteeUserId`, `handoffId`, `sourceFeedbackIds`, `createdAt`), `ThemeSummary{theme,count,latest,titles}`, `MentorshipMe{mentors: ClassMember[]; mentees: ClassMember[]}`. `BirdieLesson.sourceAnnotationIds` becomes `sourceFeedbackIds`.
- Produces api.ts functions: `getMentorshipMe()`, `listPairings()`, `createPairing({mentorUserId, menteeUserId})`, `endPairing(id)`, `listMentorFeedback({menteeId?, source?, audience?})`, `createGuidance({audience, menteeUserId?, note, anchorQuote?, suggestedText?})`, `deleteMentorFeedback(id)`, `listMentorLessons(menteeId?)`, `distillMentorLessons({menteeUserId?, feedbackIds?})`, `getMenteeThemes(menteeId, days?)`.
- Produces route: `{ view: 'mentorship'; menteeId: string | null }` for `/mentorship` and `/mentorship/:menteeId`, plus `navigation.openMentorship(menteeId?)` alongside the existing navigation helpers.
- Produces `groupLessonsByTheme(lessons: MentorLesson[]): { theme: string; lessons: MentorLesson[] }[]` (groups sorted by size desc then theme name; lessons within a group newest first).

- [ ] **Step 1: Write failing tests** `mentorship-themes.test.ts`: groups by theme, sort order, empty input returns `[]`, a missing theme falls into `"General"`.
- [ ] **Step 2: Run** `cd frontend && bun test tests/mentorship-themes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `themes.ts`, the types, the api.ts functions (snake_case mapping inside api.ts) and update `mapLesson` for `source_feedback_ids`. Add the route parse/build in `routes.ts` and a `Mentorship` nav item (icon `GraduationCap` from lucide-react) after Knowledge in the Sidebar, visible to everyone with an active class. Render a placeholder `<MentorshipPage />` in `App.tsx` (component arrives in Task 8; for now return a stub in `MentorshipPage.tsx` that renders the page title so the route compiles).
- [ ] **Step 4: Run** `bun test tests/*.test.*` and `bunx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(mentorship): frontend client, route and nav`.

---

### Task 8: Mentorship page

**Files:**
- Modify: `frontend/src/features/mentorship/MentorshipPage.tsx` (replace the stub)
- Modify: `frontend/src/features/birdie/BirdiePanel.tsx` (use the new `sourceFeedbackIds` field if it reads it; otherwise untouched)

**Interfaces:**
- Consumes: Task 7 api functions and `groupLessonsByTheme`; `getClassStatus()` for `role` and the current user id (follow `ClassSettings.tsx`).
- Produces: `MentorshipPage({ menteeId }: { menteeId: string | null })`.

- [ ] **Step 1: Build the page** with React Query (query keys `['mentorship','me']`, `['mentorship','feedback',menteeId]`, `['mentorship','lessons',menteeId]`, `['mentorship','themes',menteeId]`):
  - **No `menteeId` → my view.** "From my mentors" lists my feedback grouped by source, with a **Distil new lessons** button (disabled and labelled "Nothing new" when there is none; on a 409 show an inline message). Below it, my lessons grouped by theme. If I have mentees, show a **My mentees** section of cards (name, top three themes with counts, link to `/mentorship/:id`).
  - **With `menteeId` → mentee detail** (only reachable for mentors; a 404/403 shows "You don't have access to this mentee"): feedback, lessons by theme, themes list with counts, and the guidance composer.
  - **Guidance composer:** audience radio (This mentee / Whole team; team only for owner/mentor), note textarea (4000 max), optional quote, submit → `createGuidance`, then invalidate queries.
  - Follow the AGENTS.md look: `bg-surface`, `font-serif` 4xl title (2xl in `PanelHeader`), `text-accent`, existing `Button`, `ErrorBanner` and `StatusBadge` from `shared/ui`. Use `getErrorMessage` from `shared/lib/errors`. Empty states for no mentor, no feedback and no lessons.
- [ ] **Step 2: Run** `bunx tsc --noEmit` and `bun run build`. Expected: clean.
- [ ] **Step 3: Manually verify** with the backend (`make dev`, `bun run dev`) in demo mode: sign in as two demo users, make one a mentor, pair them (via the API until Task 9), leave guidance, then check the mentee sees it and the themes update after distilling. Report anything that could not be checked.
- [ ] **Step 4: Commit** `feat(mentorship): Mentorship page`.

---

### Task 9: Mentoring section, docs and full verification

**Files:**
- Create: `frontend/src/features/classes/MentoringSection.tsx`
- Modify: `frontend/src/features/classes/TeamManagementPage.tsx`, `AGENTS.md` (services list: `mentorship_service`, `feedback_service`; Mentorship paragraph; new routes), `README.md` (routes, auth behaviour, OpenRouter disclosure for distilling)

**Interfaces:**
- Consumes: `listPairings`, `createPairing`, `endPairing`, `listClassMembers`, `getClassStatus`.
- Produces: `MentoringSection({ status }: { status: ClassStatus })` rendered under the members list; visible to all members (read-only for plain members), with add/end controls for `owner`/`mentor`.

- [ ] **Step 1: Build `MentoringSection`:** a list of active pairings (mentor → mentee, ended on click with a confirm), and an add form with a mentor `<select>` (active `owner`/`mentor` members; a mentor sees only themselves) and a mentee `<select>` (active members excluding the chosen mentor). Surface server errors with `ErrorBanner`.
- [ ] **Step 2: Docs:** list each new route with its auth rule in `README.md`; add the services to the `AGENTS.md` services list and a short "Mentorship" paragraph (pairings, who can read what, distilling uses the acting user's key); confirm "Current head" reads `c6d7e8f9a0b1` in both places.
- [ ] **Step 3: Full verification.** Run `cd backend && python -m pytest tests -q`; `cd frontend && bun test tests/*.test.* && bunx tsc --noEmit && bun run build`; and `cd extension && bun run build` (the extension is untouched by this plan but must still build). Expected: all PASS with no new failures.
- [ ] **Step 4: Manually verify** in the browser as owner, mentor and plain member: pairing add/end, access error for a plain member, mentee view after the pairing ends (mentor loses the mentee detail page). State plainly anything not checked.
- [ ] **Step 5: Commit** `feat(mentorship): pairing management UI and docs`.
