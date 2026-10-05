# Birdie Shared Harness Implementation Plan

**Goal:** One inspectable, matter-scoped Birdie across web and extension with durable conversations, task modes and editable learning.

**Architecture:** Direct FastAPI services own conversations, turns, context selection and preferences. Both React clients use a shared workspace component and typed API adapter. Existing review services continue to own anchored suggestions.

**Authorisation:** User requested implementation in a separate worktree and an MR. Execute inline, without importing uncommitted main changes.

## Constraints
- Existing Python/FastAPI, Postgres/Alembic, React/Vite stacks; no agent framework.
- User-owned conversations; recheck matter access on every retrieval and run.
- General retrieves only unassociated records plus authorised reusable firm guidance.
- Raw feedback remains immutable. User lesson overrides are separately stored.
- External text is untrusted. Shared text reaches OpenRouter and the chosen provider.
- Temporary chat retains no server-side conversation or context snapshots.

## Tasks
1. Add conversation/turn/preference models and migration. Implement owner/matter guards, immutable conversation scope, bounded history, atomic run admission, idempotent retries, interruption and failure states. Tests cover ownership, scope, concurrent admission and retries.
2. Add context preview/build service. Allow inclusion/exclusion of memories, lessons, workboard, KB and attached document excerpts. Persist actual excerpts and source versions per saved turn. Implement Ask/Draft/Review output contracts and personal instructions subordinate to safety rules. Tests cover General and cross-matter filtering, exclusions and untrusted text.
3. Add authenticated conversation/context/preferences/stream routes. Stream factual status and source events; save completion, failure and interruption. Add explicit lesson approval/edit/disable and explicit memory saving. Tests cover route authentication and terminal stream states.
4. Build shared React Birdie workspace: saved conversation selector, new/temporary/archive/delete/rename, matter selection, modes, editable context, instructions/preferences/lesson controls, stop/retry, source inspection and continuation links. Wire both clients through their API modules.
5. Add matter scope and editable suggestion wording to extension review; retain accept/reject/undo and clarify snapshot versus external-document effects. Document API, retention, provider disclosure and migration head.
6. Run full backend tests, frontend type/build/lint, extension tests/build, migration SQL checks and branch review. Commit only worktree files, push feature branch and open GitHub PR (MR).

## Review focus
- Matter changes never carry old conversation text into a new scope.
- Account changes never reuse another user's conversation storage.
- Cancel/retry preserves partial output and avoids duplicate completed turns.
- Context snapshots correspond to text actually provided to the model.
- Browser navigation never silently reuses a stale selection from another page.
