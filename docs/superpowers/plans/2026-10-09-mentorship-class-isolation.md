# Mentorship Team Isolation Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes for tracking. Implementation is in progress; the release gates below still apply.

**Goal:** Let users create or join a mentorship team using a six-digit code displayed as `123-456`, with server-enforced separation between teams and explicit sharing within a team.

**Product terminology update (user clarification):** People **join a team**, never a class. The UI provides a dedicated **Team Management** page in the sidebar. The existing `Team` table still represents inner practice-group sharing; internal `MentorshipClass` names in this plan distinguish the two models during implementation.

**Architecture:** Add a mentorship class as the outer access boundary around existing teams, matters, and content. Keep Google login, FastAPI services, Postgres/Alembic, and the existing web/extension clients. Membership is necessary for access but never sufficient to read another member's private content.

**Tech stack:** Existing FastAPI, SQLAlchemy, Postgres, React/TypeScript, Bun, and Chrome extension; no new orchestration framework.

**Spec:** The proposed design below is the specification for this plan. Assumptions are explicit so the user can revise them before implementation.

## Proposed design

### Intent and assumptions

The requested outcome is segregation of users into mentorship classes, joined using a six-digit code, so information can stay within its intended class.

Recommended first-version defaults:

- A user can have one active class membership. Store memberships separately from users to allow multiple classes later without redesigning identity. Multi-class switching is out of scope for v1.
- Signed-in users can create a class and become its owner, or enter a code to request membership. A mentor/owner approves requests before any class content is accessible.
- Membership roles are `owner`, `mentor`, and `member`. These are separate from professional titles such as partner or associate and from platform administration.
- Personal chats, Birdie conversations, memories, and unshared documents are private, including from mentors. Being a mentor does not grant access to personal material.
- Uploads to General default to private. Uploading into a matter is an explicit sharing action with a visible audience notice. Joining a class does not enroll someone into every matter.
- Documents and manual KB notes can be explicitly shared with the whole class. Matter content requires matter membership. Private memories can be deliberately copied into a reviewed class KB note; raw personal memories and chat threads are not made class-readable in v1.
- Class content stays attached to its original class when its creator leaves. Former members lose access, including creator access to private content created in that class. A new class never inherits old material. This retention choice must be clear in the leave/remove UI.
- A user without an approved class may access login, their own account/settings, and create/join onboarding only. No workspace data endpoints are available.

### Options considered

| Approach | Trade-off |
| --- | --- |
| Reuse each existing Team as a class | Fewer new entities, but mixes team sharing and the outer security boundary, and still requires extensive changes for General and global scopes. |
| **Add MentorshipClass above teams and matters** | Recommended: a clear boundary independent of existing team/matter permissions; requires schema backfill and a service-wide access audit. |
| Separate database per class | Stronger infrastructure separation but adds provisioning, migrations, and operational work beyond the demo's needs. |

### User flow

```text
Google login
  -> approved class membership? -> class workspace
  -> otherwise: Create class / Join class
       Create -> name -> class owner -> generate code
       Join -> enter 123-456 -> pending approval -> class workspace
```

Class settings show the name, member roster, pending requests, and owner/mentor controls. Only owners can grant mentor roles, transfer ownership, or archive the class. Mentors can approve requests and remove ordinary members. The last owner cannot leave or be removed without transferring ownership or archiving the class. Archived classes deny content access and joins; archive does not delete content.

Each workspace displays the class name. Sharing controls show `Only me`, `Matter members`, or `Class: <name>` where supported. Existing team sharing remains available only inside the class. No global directory of classes or users is exposed.

### Access contract

Every content read, write, search, download, assignment, and AI tool call must satisfy:

```text
authenticated user
AND active membership in the resource's class
AND class is active
AND resource-level audience/operation permission
```

Check the class boundary before owner, professional-role, or admin shortcuts. Platform administrators have no application-level bypass for class content. Infrastructure operators with database access remain outside this application permission guarantee.

| Resource | Allowed audience inside the same class |
| --- | --- |
| Personal chat, memory, Birdie history, private document/note | Creator only |
| Explicit class-shared document/note | Active class members; sharing does not grant editing rights |
| Team-shared KB note | Members of that team |
| Matter and matter-shared content | Explicit matter members, with operation-specific roles |
| Workboard ticket / review handoff | Existing assignment and review rules, additionally bounded by class |
| Account settings / provider keys | Account owner only; not class-shared |

Class membership does not replace matter restrictions. General means no matter **inside the current class**, never a global bucket. Existing `firm_wide` KB entries must stop meaning all application users; replace with class scope during migration. Do not silently broaden content access on matter deletion, reassignment, or scope changes.

Sharing derived notes must not expose source excerpts more widely without a deliberate owner-approved sharing action. Citations/previews still check current source permissions; inaccessible source titles and URLs must not leak through search metadata.

### Code and enrollment contract

- Generate uniformly random six-digit strings with a cryptographically secure generator; preserve leading zeroes. Accept exactly `123456` or `123-456` after trimming outer whitespace; reject other characters/formats.
- Codes initiate join requests, not authentication or immediate content access. Require Google login first.
- Codes expire after 24 hours, can be disabled, and can be rotated. Rotation invalidates the old code but does not remove existing members. Repeated requests are idempotent.
- Store a keyed HMAC digest using a dedicated deployment secret, not the plaintext code or an unkeyed digest. Display plaintext once on generation; regenerate if lost. Never put codes in URLs, telemetry, or application logs.
- Enforce uniqueness among usable codes with a database constraint and collision retry. Approval rechecks class status and the user's membership limit under a database lock; concurrent approvals cannot enroll one user into two classes.
- Apply shared, database-backed attempt limits: 5 attempts per user per 15 minutes and 30 per source IP per 15 minutes, counting failures and successes. Use only trusted proxy IP configuration. Return `429` with retry timing; invalid/expired/disabled codes share one generic error response without revealing class details.
- Pending membership grants no roster, class metadata, search, or document access. Only the approved join flow reveals the class workspace. Owners/mentors can reject pending requests.

### Data model

Add `MentorshipClass(id, name, status, created_by, created_at)` and `ClassMembership(id, class_id, user_id, role, status, requested_at, joined_at, removed_at)`. Membership statuses are `pending`, `active`, `rejected`, and `removed`. Enforce uniqueness of `(class_id, user_id)` and a partial unique index on `user_id WHERE status = 'active'`. Lock the user row during activation.

Add `ClassInvite(id, class_id, code_digest, expires_at, revoked_at, created_by)` with at most one unrevoked invite per class and unique unrevoked digests; revoke expired records before regeneration. Add bounded-retention join-attempt and class-audit records. Audit membership, role, invite, sharing, and archive operations without content bodies or raw codes.

Add non-null `class_id` to independently queried content roots: Team, Matter, Document, DocumentFolder, ChatThread, Memory, KnowledgeBankEntry, ResourceMetadata, ActionItem, ReviewHandoff, ReviewLesson, BirdieReview, DreamJob, and RetrievalAuditEvent. Keep user identity and UserSetting account-scoped. Children such as chunks, messages, annotations, suggestions, replies, KB access logs, and redactions inherit class through mandatory parents; all child lookups join their authorized parent.

Use composite foreign keys/unique pairs where resources link to a team, matter, folder, or document, so mismatched class associations fail in the database. Review every model in `models.py` when finalizing the migration; polymorphic metadata links additionally require service validation. Scope team-name and matter-case-number uniqueness to class so unrelated classes cannot conflict or infer each other's names/references.

Membership checks are live database checks, not trusted JWT role claims. Treat `default_team_id` as a preference that must belong to the active class; never let it grant access or fall back to a shared global team.

## Global constraints

- Keep the existing stack, Google OAuth, per-user OpenRouter keys, and provider disclosure.
- No automatic global-team enrollment; no cross-class professional-role or admin bypass.
- No content APIs before approved membership; fail closed on missing/ambiguous class context.
- No private-to-shared conversion from joining, changing class, background extraction, or AI inference.
- All schema changes go through Alembic; update README and AGENTS migration-head references.
- Scope both clients and both streaming and non-streaming APIs; frontend filtering is not authorization.
- No production cutover while old unscoped application instances or workers remain active.

## Repository findings informing this plan

Verified during planning on 2026-10-09; initial working tree was clean:

- `app/auth.py` calls `ensure_default_team`; `organization_service.py` enrolls users into the same named team.
- `dependencies.py` permits global admin KB access, treats `firm_wide` KB as globally readable, and bypasses matter membership for partner/admin roles.
- `organization_service.py` lists all matters/teams for partner/admin users.
- `routers/auth.py` exposes `/users` through a global roster service and has a global role-update route.
- Document helpers currently authorize by ownership or matter membership, without a class boundary.
- Existing entities already support team/matter sharing, so a new class boundary must compose with these permissions.

Prior context also motivates explicit coverage of Birdie history and context transitions; this plan does not assume those older findings are current verified defects.

## Review focus

1. Same-class classmates and mentors must not see private material — Task 3.
2. A forged resource, parent, reviewer, or assignee ID must not cross class boundaries — Tasks 2–4.
3. Removal during a running stream/job must prevent subsequent retrieval, mutation, and output delivery — Task 4.
4. Two concurrent approvals must not activate memberships in two classes — Task 2.
5. Ambiguous legacy rows, old browser caches, and old clients must fail closed — Tasks 1, 5, and 6.

## Implementation tasks

### Task 1: Add schema and a conservative migration path

**Files:** Modify `backend/app/models.py`; add Alembic revisions under `backend/migrations/versions/`; create `backend/app/services/class_migration_service.py`, `backend/scripts/backfill_classes.py`, and `backend/tests/test_class_migration.py`.

**Interfaces:** `build_class_backfill_report(db: Session) -> dict` reports ownership, associations, conflicts, and unmapped rows without modifying data. `apply_class_backfill(db: Session, *, mapping: dict) -> dict` applies a reviewed explicit ID-to-class mapping transactionally and returns counts.

- [ ] Write real-Postgres migration tests for fresh installation, legacy shared-team data, General content, conflicting parent ownership, missing creators, and cross-class composite foreign keys. Assert ambiguous rows never become shared and no content is copied into multiple classes.
- [ ] Run the new tests and confirm they fail before schema implementation.
- [ ] Add expand/backfill/constraint migrations and model fields described above. Determine the actual Alembic head with `.venv/bin/alembic heads`; do not copy a stale head from documentation.
- [ ] Implement dry-run reporting and explicit mapping import. Do not infer class membership from the existing shared default team. Unmapped content goes to an inaccessible archived quarantine class; no user is automatically enrolled there. Owner-only legacy data remains owner-only after assignment.
- [ ] Run migration tests against a disposable Postgres database, inspect row counts and constraints, and confirm rerunning the backfill is idempotent. Keep old columns through cutover to support investigation; do not prescribe a destructive downgrade as rollback.

### Task 2: Implement membership, invites, and request context

**Files:** Create `backend/app/services/mentorship_class_service.py`, `backend/app/services/access_service.py`, `backend/app/routers/mentorship_classes.py`, `backend/tests/test_class_membership.py`, and `backend/tests/test_class_invites.py`. Modify `backend/app/{auth,dependencies,schemas,config,main}.py`, `backend/app/services/organization_service.py`, and `backend/app/services/user_service.py`.

**Interfaces:** `ClassContext(user_id: str, class_id: str, role: str)`; `require_class_context(db, user) -> ClassContext`; `require_class_role(context, allowed_roles: set[str]) -> None`. Service operations: `create_class(db, *, user, name)`, `rotate_invite(db, *, context)`, `request_join(db, *, user, code, source_ip)`, `approve_member(db, *, context, target_user_id)`, and `remove_member(db, *, context, target_user_id)` return schema-backed records, with plaintext invite returned only at generation.

- [ ] Test `000-123`, invalid formats, collisions, expiry, rotation, throttling across server instances, duplicate submissions, pending access denial, unauthorized approval, owner transfer, and simultaneous cross-class approvals. Assert professional titles and platform admin status cannot bypass membership.
- [ ] Confirm tests fail; implement service transactions, role checks, attempt counters, HMAC storage, and audit events.
- [ ] Add authenticated routes: `POST /classes`, `POST /classes/join`, `GET /classes/current`, `GET /classes/current/members`, `POST /classes/current/invite`, `DELETE /classes/current/invite`, `POST /classes/current/members/{user_id}/approve`, `POST /classes/current/members/{user_id}/reject`, `PATCH /classes/current/members/{user_id}/role`, `DELETE /classes/current/members/{user_id}`, `POST /classes/current/leave`, `POST /classes/current/transfer-owner`, and `POST /classes/current/archive`. `/me` returns membership/onboarding status without exposing unrelated classes.
- [ ] Remove `ensure_default_team` from login and implicit list paths; create a class-local default team only after activation, with no automatic matter membership. Disable role-management paths that currently mutate global authority from class controls.
- [ ] Run membership/invite tests and verify database concurrency with separate connections, not mocked sessions.

### Task 3: Enforce class and audience rules across normal APIs

**Files:** Modify `backend/app/dependencies.py`; routers for organizations, auth, documents, folders, metadata, KB, memories, actions, reviews, chat, system, and precedent; their corresponding service files. Extend `access_service.py`. Create `backend/tests/test_class_resource_access.py` and `backend/tests/test_class_sharing.py`.

**Interfaces:** `require_resource_access(db, *, context: ClassContext, resource, operation: str) -> None` composes class and audience checks. SQL predicate helpers used by list/search paths must implement the same policy as direct-ID checks. Existing helpers such as `document_access_filter` gain explicit context; remove compatibility fallbacks that silently allow unscoped calls.

- [ ] Seed two classes, two members and a mentor in each, and private/matter/class-shared examples. Test every content router for list, direct read, create, update, delete, export, counts, and foreign-ID assignment. Assert out-of-class requests return indistinguishable not-found responses; pending users get an onboarding-required response.
- [ ] Confirm tests fail; replace global list/admin bypasses with class-first predicates. Restrict `/users`, assignee/reviewer selection, team/matter membership edits, and role changes to authorized members of the same class.
- [ ] Implement explicit document and KB audiences; preserve owner-only editing unless an existing authorized workflow grants it. Enforce source-access rules for catalogue metadata, promoted annotations, lessons, and document-derived KB entries.
- [ ] Derive class on creation from context, never from a client-controlled value. Validate all linked IDs and enforce class immutability on updates. Matter deletion leaves records in the same class and narrows matter-shared audiences to private.
- [ ] Authorize R2 download/export requests before returning bytes. Prefer authenticated streaming for private documents to avoid usable bearer URLs surviving removal; ensure underlying objects are not public. Scope storage prefixes to class for new objects without treating path names as authorization.
- [ ] Run resource/sharing tests and existing review, document, matter, and security suites. Assert same-class mentors cannot read private chats, memories, or private documents.

### Task 4: Contain AI retrieval, history, and background execution

**Files:** Modify `backend/app/services/{agent_tools,agent_service,birdie_service,birdie_document_service,birdie_review_service,rag_service,knowledge_bank_service,memory_service,chat_service,dream_service,document_service,kb_ingestion_service,lesson_service,resource_metadata_service}.py`, relevant precedent/audit services, and `backend/app/worker.py`. Create `backend/tests/test_class_ai_isolation.py` and `backend/tests/test_class_job_isolation.py`.

**Interfaces:** Pass `ClassContext` explicitly into both AI loops and shared tool execution. Persist immutable `class_id` and actor identity with background work; resolve a fresh authorized context when work starts and before publishing results.

- [ ] Use unique canary phrases in each class and private resource. Assert prompts, retrieved snippets, citations, history summaries, tool results, and audit metadata never contain unauthorized canaries, including for streaming and non-streaming chat, Birdie, precedent search, and Dream.
- [ ] Test revocation while a job runs and while a stream is open; assert no later tool read/write or output delivery succeeds. Test cache reuse and explicit foreign matter/document IDs from webpage context.
- [ ] Confirm failures, then apply class plus resource predicates before retrieval/ranking, limits, counts, and prompt assembly. Keep tool authorization server-side; prompts are not an access control.
- [ ] Bind histories and summaries to user/class/matter; never combine class contexts. Include user, class, and resource scope in caches and invalidate on membership/scope changes. Reject stale or foreign resource context instead of silently searching broadly.
- [ ] Recheck membership at every tool dispatch and before streamed output delivery; stop/cancel on revocation. Work already sent to an external model cannot be recalled, and already delivered text cannot be erased. Revalidate job access before persisting derived results; fail closed when the actor is removed.
- [ ] Run new isolation tests and existing agent/retrieval suites. Capture a controlled integration test's actual model-request payload with a stub provider to verify content boundaries end to end.

### Task 5: Add onboarding and sharing UI to web and extension

**Files:** Create `frontend/src/features/classes/{ClassOnboarding,ClassSettings}.tsx` and `frontend/tests/class-access.test.ts`. Modify `frontend/src/app/{App.tsx,routes.ts}`, `frontend/src/shared/api/api.ts`, `frontend/src/shared/types/workspace.ts`, and existing auth/settings/navigation/document/KB sharing components. Modify `extension/src/lib/{api,auth,conversation}.ts` and side-panel UI; add `extension/src/lib/classAccess.test.ts`.

**Interfaces:** Map backend class/membership fields to camelCase in the web API adapter. Both clients use `/me` membership state and the backend-derived class; no client class value authorizes access.

- [ ] Test onboarding for no membership, pending approval, rejection, and active membership; sharing labels and default private scope; stale API responses arriving after removal/account changes.
- [ ] Implement create/join/pending screens, accessible code input/paste, class name display, roster/approval controls, invite regeneration, and explicit leave/archive consequences. Follow existing surface/accent/serif tokens and mobile patterns.
- [ ] Key query caches, local conversation storage, and drafts by user/class. Clear visible workspace state and abort pending requests/streams when membership changes, on logout, or account change. Revalidate `/me` on focus and reconnect; do not hydrate content from a former class.
- [ ] Give the extension a clear onboarding link and revoked-access state. Clear prior conversation context on account/class changes. Older clients fail closed through backend guards instead of inheriting a default class.
- [ ] Run `bun run test` and `bun run build` in both `frontend/` and `extension/`. Verify browser flows at desktop and mobile widths, using distinct browser sessions for the two classes and testing the live extension against the backend.

### Task 6: Verify isolation and deploy as one guarded cutover

**Files:** Create `backend/tests/test_class_isolation_e2e.py`; update `README.md`, `AGENTS.md`, and demo seed/reset services and tests.

- [ ] Build a route/service inventory accounting for every model and endpoint, including admin insights, rosters, search facets/counts, export, retrieval audits, demo impersonation/reset, failed-job retries, and child-resource endpoints. Every content path must have an isolation test or a documented parent authorization test.
- [ ] Run `.venv/bin/python -m unittest discover -s tests` from `backend/`, plus the disposable-Postgres migration/concurrency/integration tests. Run both client test/build commands from Task 5. Treat unavailable integration infrastructure as an unresolved release gate, not a pass.
- [ ] Demo with classes A/B: A uploads a private PDF, explicitly shares a note to A, B cannot discover either, another A member sees only the note, mentors cannot read the private PDF, foreign-ID requests fail, and removed members lose backend access despite an old JWT and open tab.
- [ ] Isolate demo seeding and switching to synthetic classes. `DEMO_MODE` must not turn class role controls or content access into an application-wide bypass; real-data deployments keep it disabled.
- [ ] Document routes/authentication, membership and retention behavior, invitation secret setup/rotation, provider disclosure, migration commands, and verified migration head.
- [ ] Back up database/object manifests; pause content traffic and workers; run expand migration and reviewed backfill; resolve/quarantine ambiguities; apply constraints; deploy scoped backend/worker/clients; invalidate old client state; smoke-test A/B isolation; then reopen traffic.
- [ ] If cutover validation fails, keep content traffic closed and repair or restore the pre-cutover backup in maintenance mode. Do not resume the old unscoped app against a partially migrated database.

## Completion criteria

The feature is complete only when an approved user can enter their class, explicitly share selected material within it, and no tested HTTP, AI, storage, background, or client-history path exposes another class's content or a classmate's private material. A working code-entry screen alone does not meet this requirement.

Implementation has begun in the working tree. This plan does not authorize deployment; migration and isolation release gates remain open.
