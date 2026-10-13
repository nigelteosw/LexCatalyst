# Cut & Simplify — Design

**Sub-project 4 of 4.** Runs alongside the others in two phases:

- **Phase A** (any time, low risk): remove Dream and the catalogue backfill.
- **Phase B** (after sub-project 1 ships): fold practice-group teams away, drop document folders, refocus Home and the sidebar.

Siblings: `2026-10-13-mentorship-core-design.md`, `2026-10-13-team-knowledge-anywhere-design.md`, `2026-10-13-birdie-everywhere-design.md`.

## Intent

Remove what serves "run a firm" more than "grow juniors", and make the mentorship team the only grouping.

### Decisions already made (user)

- **Keep the Workboard** and its agent tools. Seniors use it to assign and track mentees' work.
- **Keep matters**, as an optional label. A matter is identified by its UUID. `case_number` is unique only within a team (`uq_matters_class_case_number`) and titles are not unique, so the same name can exist in several teams.
- Cut Dream and the catalogue backfill. Simplify documents.

## Phase A

### A1. Remove Dream memory consolidation

Removes:

- `services/dream_service.py`; Dream routes in `routers/memories.py`; the Dream job branch in `worker.py`; the `DreamJob` model and `dream_jobs` table (Alembic drop migration); Dream schemas.
- The `dream` entry in `llm_service.FEATURES` (and any stored per-feature tier setting for it, which is ignored if present).
- Frontend: the Dream button and status UI in `MemoriesPanel.tsx`; Dream types and calls in `workspace.ts` / `api.ts`.
- The Dream reference in `class_migration_service.py`; `tests/test_class_dream_isolation.py`.

Memories themselves (CRUD, retrieval, `search_memories`) stay.

### A2. Remove catalogue backfill

Removes the backfill endpoints and their UI triggers:

- `POST /kb/backfill-note-metadata`, plus `POST /kb/backfill-document-metadata` in `routers/document_metadata.py` (`backfill_document_metadata`), with the matching service functions.
- Admin buttons that call them.

**Kept:** catalogue extraction at upload time (`catalogue_service`), entry metadata for new notes, and metadata edits. These are cheap and still useful for uploaded source documents.

## Phase B

### B1. Fold practice-group teams into the mentorship team

Today there are two "team" concepts. `MentorshipClass` (shown as **Team**) is the security boundary. Inside it, `teams` / `team_members` are practice groups, and `matters.team_id` is required. `kb_entries.scope` is one of `firm_wide | team | matter | private`, where `team` means a practice group.

**Target:** one team (the class). Practice groups are removed.

**Migration (one Alembic revision, data first, then schema):**

1. **KB scope remap. Never widen silently.**
   - For each class with **exactly one** practice team, change `scope='team'` entries to `firm_wide`. The audience is the same, because everyone in the class can already be added to that one team. *Verify at migration time that the team's members equal the class's active members. If they don't, use the next rule.*
   - Otherwise, set `scope='team'` entries to `private`, owned by `created_by`. Write each affected entry id to `class_audit_events` (`kb_scope_narrowed`) so the owner can re-share it.
2. Rename the scope value `firm_wide` to `team` throughout (`KnowledgeBankScope = Literal["team", "matter", "private"]`).
3. Drop `team_id` from `kb_entries`, `matters`, `documents` and `resource_metadata`; drop `users.default_team_id`, `team_members` and `teams`.
4. Remove the four `(…, "team_id", "teams")` entries and `"teams"` from `class_boundary.py`.

**Code:** remove the `scope == "team"` practice-group branch in `knowledge_bank_service._resolve_scope`. Remove `team_id` handling from `organization_service`, `resource_metadata_service`, `document_service`, `kb_ingestion_service`, `dependencies.py`, the demo seeds and `api.ts`. Matter creation no longer asks for a team.

**Professional titles** stay on `users.firm_role` (partner, senior_associate, associate) and keep driving `require_partner_or_admin` and `created_by_role`. The `TeamMember.role` duplicate goes away.

**Matter access** is unchanged: `matter_members` still controls matter scope. Joining a team still does not enroll a user in every matter.

### B2. Drop document folders

- Drop the `document_folders` table, `routers/document_folders.py` and `Document.folder_id` (migration sets it to null and then drops the column).
- `MatterDocuments.tsx` becomes a flat list with upload ("Add source document"), rename and delete.
- Remove `tests/test_document_folders.py`, and the folder part of `test_class_folder_kb_access.py` (keep its KB assertions).

### B3. Refocus Home and the sidebar

**Sidebar order:** LexChat, Team Knowledge, Mentorship, Workboard, Matters, Memories, Settings. Team Management stays in the sidebar for owners and mentors.

**Home** (`features/home/`):

| Section | Shown to | Content |
|---|---|---|
| From my mentors | anyone with a mentor | 5 latest feedback items + "New lessons to distil" |
| My mentees | anyone with mentees | mentee cards with top themes (from `/mentorship/mentees/{id}/themes`) |
| Team guidance | everyone | 3 latest team guidance items |
| My Workboard | everyone | assigned items, open and overdue (existing `AttentionSection`, trimmed) |
| Matters | everyone | existing `MattersSection` |

Remove `RecentDocumentsSection.tsx`.

## Docs to update

- **AGENTS.md:** repo shape (no `document_folders`, `dream_service`, `teams`), the services list, Matters (no team), the KB scope names, current Alembic head, and a short Mentorship section.
- **README:** remove Dream, describe the mentorship flow, keep the provider disclosure in sync.

## Testing

- Phase A: the app imports cleanly (`test_no_undefined_names.py`), Memories CRUD still passes, and the removed routes return 404.
- B1 migration on Postgres covers three cases: (a) one practice team whose members equal the class, so entries become `team`; (b) two practice teams, so entries become `private` and audit events are written; (c) a single team with fewer members than the class, so entries become `private`. Check that no entry's audience is wider after migration than before.
- KB access matrix updated for three scopes. Matter creation works without a team.
- Frontend: `tsc --noEmit` is clean. Home renders for mentor-only, mentee-only, both and neither.

## Out of scope

Removing the Workboard, matters, memories, uploads or in-app review rounds.
