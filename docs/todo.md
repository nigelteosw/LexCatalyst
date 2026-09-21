# TODO

Demo cleanup and redlining priorities are tracked in [`../TODO.md`](../TODO.md), starting with
the 2026-09-21 review. Use that ordered backlog for bug fixes and refactoring; this file tracks
product features. The existing review implementation needs refinement, not rebuilding from scratch.

## Document Redlining — next demo milestone

- [ ] Enforce reviewer permissions and PII approval on annotation promotion (D1–D2 in root TODO).
- [ ] Complete return/resubmit/history flow without losing replies or reusing stale anchors (D3–D4, R1–R2).
- [ ] Refine selection toolbar, multi-page marks, loading/errors, and scanned-PDF fallback (R3, R6–R9).
- [ ] Make exported marks and full reviewer notes match the viewer, including rotated/cropped pages (R4–R5).
- [ ] Rehearse the complete two-user review cycle and denied access for an unrelated user.

## Frontend State Management

- [x] Replace magic-string navigation with typed route-based views.
  - Implemented with React Router and the `AppView` union in `frontend/src/app/routes.ts`.
  - Zustand was an earlier proposal and is not installed; do not add it just to match this old checklist.

- [x] Migrate server state to TanStack Query.
  - Threads, messages, documents, and wiki pages are currently fetched manually with scattered `loadX` functions and no shared cache.
  - Replace with `useQuery` / `useMutation` hooks so components fetch their own data; use `queryClient.invalidateQueries` for post-mutation refresh instead of explicit `refreshThreads` calls.
  - Eliminates the manual guard checks in `handleSubmit` for `'wiki'` / `'documents'` thread IDs and removes the double-load pattern in `WikiPanel`.

## ReAct Agent Loop

- [x] Implement ReAct (Reasoning + Acting) loop for the LLM. See `rfc-react-agent-loop.md` for the original plan.
  - Replace single-shot RAG with a tool-calling loop (max 5 rounds).
  - Tools: `search_documents`, `search_knowledge_bank`, `search_memories`, `get_kb_entry`.
  - Stream `tool_call` and `tool_result` SSE events to the frontend.
  - Show tool steps inline above the final answer in the chat UI.
  - Build order: `deepseek.py` stream_with_tools → `agent_service.py` → `chat_service.py` → `main.py` → frontend types → `api.ts` → `App.tsx` → `ChatPanel.tsx`.
  - Implementation exists; final-round fallback, disconnect persistence and regression coverage remain
    engineering follow-ups in the root TODO. This checkmark does not certify those edge cases.

## Chat Context

- [x] Add thread summarization for long-running chats.
  - Current behavior sends only recent thread messages to the LLM prompt.
  - Store a rolling summary per chat thread so the assistant can preserve older context after days or long conversations.
  - Refresh the summary after new assistant responses, then include it alongside recent messages, long-term memory, and document search context.
  - Keep summaries scoped to the authenticated user and the specific thread.

## Authentication

- [ ] Fix user authentication timeout issue.
  - Currently, users are forced to log back in if their session times out.
  - Implement a mechanism (e.g., refresh tokens or persistent sessions) to keep users logged in or handle re-authentication gracefully.

## Document Ingestion

- [ ] Improve document ingestion workflow.
  - Ensure the LLM saves two distinct items:
    1. The original document content.
    2. An LLM-summarized version containing all important points.
  - The summarized version should be the one added to the Knowledge Bank.

---

## Feature roadmap

Each item has a full implementation plan under `docs/plans/`. They're listed in the order I'd recommend shipping them.

- [ ] **Wellbeing questionnaire polish + team monitor page** — Plan: [`docs/plans/wellbeing-questionnaire-monitor.md`](./plans/wellbeing-questionnaire-monitor.md)
  - Polish the existing weekly check-in: progress indicator, draft auto-save, and optional free-text context per question.
  - Extend the partner-only user dashboard with category snapshots, multi-week trend lines, flag indicators, and a recent context stream.

- [ ] **Rename KB `action` type → `skill`** — Plan: [`docs/plans/kb-skills-rename.md`](./plans/kb-skills-rename.md)
  - Reframe the third KB category as reusable hard-skill + soft-skill markdown blocks the agent can load into its context.
  - Migration to rename existing rows; update enum literals across schemas, frontend types, and KB panel UI.

- [x] **Dream agent — automatic memory consolidation**
  - "Dream" button next to "+ Add memory" in the Memories panel.
  - Durable worker reviews recent chat history and automatically applies additions, merges, updates, and drops.
  - Each automated memory stores a justification; the completion summary preserves reasons for dropped memories.

- [x] **PDF viewer + matter-wide comments** — Plan: [`docs/plans/pdf-viewer-comments.md`](./plans/pdf-viewer-comments.md)
  - Clicking a document opens a right-side drawer with an embedded PDF viewer.
  - Comments thread at the bottom, visible to anyone on the matter (or owner-only for `private` documents).
  - Present in `frontend/src/features/documents/DocumentDrawer.tsx`; live access-control rehearsal
    is still required. Anchored action-review redlining is a separate flow tracked above.
