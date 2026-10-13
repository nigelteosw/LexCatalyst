# Mentorship Core — Design

**Sub-project 1 of 4** in the mentorship pivot. Order: **1 → 2 → 3**, with 4 alongside.
Siblings: `2026-10-13-team-knowledge-anywhere-design.md`, `2026-10-13-birdie-everywhere-design.md`, `2026-10-13-cut-and-simplify-design.md`.

## Intent

LexCatalyst becomes a mentorship tool for **firm training**: seniors mentor juniors on real work. Documents live in Word and Google Drive. LexCatalyst holds the team's know-how and the mentoring relationship. Birdie carries that guidance everywhere.

This sub-project adds the foundation the others build on:

- explicit **mentor ↔ mentee pairings** inside a team
- a single **feedback** model that does not depend on in-app review rounds
- **lessons** and recurring **themes** derived from feedback
- a **mentor view** of each mentee's lessons and themes

### Decisions already made (user)

- Audience is firm training (option A).
- Feedback arrives three ways: in-app review rounds (kept), comments captured from Google Docs or Word (sub-project 3), and guidance written directly by a mentor.
- Lessons are visible to the mentee **and their paired mentors**, with a recurring-themes view. Other team members see nothing. A mentee's chats, Birdie conversations and memories stay private from mentors.
- The Workboard stays.

### Assumptions (correct if wrong)

- A mentee can have several mentors, and a mentor several mentees.
- Only team `owner` or `mentor` roles can be the mentor in a pairing. Only `owner`/`mentor` can create or end pairings. A mentor can pair themselves with a mentee; an owner can pair anyone.
- Team-wide guidance (not aimed at one mentee) can be written by `owner`/`mentor` and is readable by every active member.

## Data model

### `mentor_pairings` (new)

| column | notes |
|---|---|
| `id` | uuid |
| `class_id` | FK `mentorship_classes`, RESTRICT |
| `mentor_user_id` | FK users |
| `mentee_user_id` | FK users; must differ from mentor |
| `created_by` | FK users |
| `created_at`, `ended_at` | `ended_at` null = active |

Partial unique index on `(class_id, mentor_user_id, mentee_user_id) WHERE ended_at IS NULL`.
Ending a pairing sets `ended_at`. History is kept so past feedback still shows who wrote it.
Removing a member from the team ends all their pairings in the same transaction.

### `mentor_feedback` (new)

One row per piece of feedback, whatever its source.

| column | notes |
|---|---|
| `id`, `class_id` | |
| `audience` | `mentee` or `team` |
| `mentee_user_id` | required when `audience = mentee`, null for `team` |
| `author_user_id` | nullable, so a captured comment whose author doesn't match a member still saves |
| `author_name` | display name as captured (for unmatched authors) |
| `source` | `review_round`, `captured_comment` or `guidance` |
| `handoff_id`, `annotation_id` | set for `review_round`; unique on `annotation_id` |
| `source_url`, `source_title` | set for `captured_comment` (sub-project 3) |
| `anchor_quote` | the text the feedback is about (nullable for guidance) |
| `suggested_text` | nullable |
| `note` | the feedback itself |
| `created_by` | the user who recorded it (capturer or author) |
| `created_at`, `deleted_at` | soft delete |

**Review rounds feed this table.** When a round moves to `returned` or `completed`, `review_handoff_service` snapshots every annotation that passes the existing `lesson_service.is_feedback` test into `mentor_feedback` with `source = review_round`. The unique `annotation_id` makes this idempotent. Later edits to the annotation do not rewrite the snapshot. A migration backfills feedback from rounds that are already returned or completed.

### `review_lessons` (altered in place)

- Keep the table name `review_lessons` and the model `ReviewLesson` (a rename would touch the class-boundary registries and the b5c6 composite keys for no behavioural gain).
- `handoff_id` becomes nullable.
- Add `mentee_user_id` (backfilled from the handoff submitter) and `theme` (short label, such as "Defined terms", "Passive voice", "Citation form").
- Replace `source_annotation_ids` with `source_feedback_ids` (backfilled through the snapshot above).
- `audience` is `mentee`. Team guidance is not distilled into lessons, because it is already general.

## Access rules (`mentorship_service.py`, new)

Every read first calls `require_class_context` and checks the row's `class_id`.

| Resource | Who can read | Who can write |
|---|---|---|
| Pairing list | all active members (names only) | `owner`/`mentor` create or end |
| Feedback with `audience = mentee` | the mentee; the author; mentors with an **active** pairing to that mentee | author edits or deletes their own feedback; mentee can't delete it |
| Feedback with `audience = team` | every active member | author; owner can delete |
| Lessons / themes for mentee M | M; mentors actively paired to M | distil: M or an active mentor of M |

When a pairing ends, the mentor loses read access to that mentee's feedback and lessons. The exception is feedback they wrote themselves, which they keep. Mentors never gain access to chats, Birdie threads, memories or private documents. Admin status and `firm_role` don't bypass these rules (as in AGENTS.md).

## Lessons and themes

`lesson_service.distill_lessons` is generalised to `distill_lessons(db, *, user, mentee_user_id, feedback_ids | None)`:

- With no ids, it distils every undistilled `mentee` feedback row for that mentee.
- The prompt returns `[{title, body, theme, source_feedback_ids}]`. `theme` comes from a short suggested list plus free text, normalised to title case and capped at 40 chars.
- It runs on the **acting user's** OpenRouter key and Mid tier (existing feature key `lessons` in `llm_service.FEATURES`, so stored tier settings keep working). Feedback text and quoted passages go to OpenRouter (keep the disclosure in the docstring and README).
- The existing per-round behaviour is unchanged: the "distil this round" button calls it with that round's feedback ids.

**Themes view:** `GET /mentorship/mentees/{id}/themes?days=90` groups lessons by `theme` and returns the count, the latest date and up to three lesson titles. It is computed live, with nothing stored.

## Birdie and LexChat context

`format_feedback_context` is replaced by `format_mentorship_context(db, user)`, used by both loops:

1. The user's 8 most recent lessons (title, theme, body clipped).
2. The 5 most recent undistilled `mentee` feedback rows (as today's format).
3. The 5 most recent team guidance rows.

A user who is only a mentor gets just (3). Context is assembled at request time, so a pairing or membership that ends between turns takes effect immediately (`revalidate_class_access` already runs on stream delivery).

## API (`routers/mentorship.py`, new; all need an active class)

```txt
GET    /mentorship/pairings                       list active pairings in my team
POST   /mentorship/pairings {mentor_user_id, mentee_user_id}   owner/mentor
DELETE /mentorship/pairings/{id}                  owner/mentor -> sets ended_at
GET    /mentorship/me                             {mentors[], mentees[]}
GET    /mentorship/feedback?mentee_id=&source=&audience=  filtered by access rules
POST   /mentorship/feedback {audience, mentee_user_id?, note, anchor_quote?, suggested_text?}  guidance
PATCH  /mentorship/feedback/{id}                  author only
DELETE /mentorship/feedback/{id}                  author (owner for team guidance)
GET    /mentorship/lessons?mentee_id=             default = me
POST   /mentorship/lessons/distill {mentee_user_id, feedback_ids?}
GET    /mentorship/mentees/{id}/themes?days=90
```

The existing `/birdie/lessons*` routes become thin wrappers over the new service, so the extension keeps working, and are removed once the clients move over.

## Frontend

- **Team Management page:** a "Mentoring" section listing pairings, with an add/end control for owner/mentor.
- **New `features/mentorship/` page** in the sidebar (route `/mentorship`):
  - *Mentee view:* "From my mentors", a feedback list grouped by source with a distil button, then lessons grouped by theme.
  - *Mentor view:* "My mentees" cards (name, top three themes with counts, last feedback date) → a mentee detail page with feedback, lessons and themes. Plus a **Guidance composer** (for one mentee or the whole team).
  - A user can be both, so the page shows both sections where relevant.
- All calls go through `shared/api/api.ts` with camelCase mapping.

## Errors

- Pairing an ineligible mentor (wrong role) → 422 with a clear message. Pairing across classes or with an inactive member → 404 (don't reveal membership).
- Distil while feedback is empty → 409 "Nothing new to distil".
- LLM failure → 502 with the existing `LessonDistillError` message. No partial lessons are saved.

## Testing

- Access matrix tests: mentee, active mentor, ended mentor, other member, other class, admin with `firm_role=partner`.
- The round snapshot is idempotent (returning twice gives no duplicates). Backfill migration test on Postgres (as in `test_class_migration_postgres.py`).
- Distil parses themes, rejects unknown feedback ids, and handles the empty case.
- `format_mentorship_context` excludes another mentee's lessons.
- Update `test_birdie_lessons.py` for the renamed table.

## Out of scope

Capturing comments from Google Docs or Word, and proactive nudges (sub-project 3). Saving knowledge from the web (sub-project 2). Removing practice-group teams (sub-project 4).
