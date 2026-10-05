# Sidebar redesign, Documents → Knowledge Bank, matter-scoped LexChats

Date: 2026-10-05

## Goals

1. Collapsible left sidebar with larger, icon-first navigation.
2. Remove Documents from the sidebar; documents live inside Knowledge Bank.
3. LexChat history only appears on the LexChat page, filtered by matter. Users manage matters (CRUD) from Knowledge Bank.

## 1. Collapsible sidebar (frontend)

- `Sidebar.tsx` gains a `collapsed` state, persisted in `localStorage` (`lc.sidebar.collapsed`, read/write wrapped in try/catch). Desktop (`lg+`) only; the mobile drawer is unchanged.
- Collapsed width 64px. Visible: LC favicon, icon buttons for Home, Knowledge Bank, Wellbeing, Workboard, then New LexChat (`+`), Birdie avatar; footer shows Settings, user avatar, Logout. Each icon button has `aria-label` and `title`.
- Nav icons become 20px in 40px hit targets in both states, so expanding only reveals labels.
- Toggle button in the header: `ChevronsLeft` when expanded, `ChevronsRight` when collapsed.
- Resizing is disabled while collapsed; the last dragged width is restored on expand.
- Workboard pending count shows as a dot on the icon when collapsed.

## 2. Documents inside Knowledge Bank

- Remove the Documents nav item and its prefetch branch from the sidebar.
- Knowledge Bank gets a section bar: Library | Documents | Matters. Audit stays where it is inside Library (permission-gated).
- The section bar is a new `features/knowledge-bank/KnowledgeBankSections.tsx`, rendered by `App.tsx` above whichever panel is active, so `KnowledgeBankPanel.tsx` (55K) and `DocumentsPanel` stay unchanged.
- Routing (`app/routes.ts`):
  - `/knowledge/documents` and `/knowledge/documents/:id` → the existing `{ view: 'documents', documentId }` view.
  - `/knowledge/matters` → new `{ view: 'matters' }` view.
  - `/knowledge/:entryId` keeps working for entries (entry ids are UUIDs, so no collision).
  - The Knowledge Bank sidebar item is active for `knowledge_bank`, `documents` and `matters`.
  - Legacy `/documents` and `/documents/:id` redirect (replace) to the new paths.
  - `selectDocuments()` keeps its signature and points at the new path, so callers need no change.

## 3. Matters and matter-scoped LexChats

### Backend

- `DELETE /matters/{matter_id}` — partner or admin (same guard as `POST /matters`). Hard delete, implemented in `organization_service.delete_matter`:
  - Explicitly `UPDATE wiki_pages SET matter_id = NULL WHERE matter_id = :id` (that column has no FK).
  - Knowledge Bank entries with `scope='matter'` for this matter become `scope='private'` (creator only), so they are neither lost nor exposed more widely. Their resource metadata rows follow (`scope='private'`).
  - Document resource metadata rows for this matter become `scope='private'`, matching `sync_document_metadata` for a matterless document.
  - Delete the matter. FKs with `ON DELETE SET NULL` move chats, documents, KB entries and other records to "General"; `matter_members` cascade.
  - Returns 204. 404 if missing, 403 if not partner/admin.
- `GET /chat/threads?matter_id=<id>` returns that matter's threads after `require_matter_member`. `matter_id=general` returns threads with `matter_id IS NULL`. Omitted returns all of the user's threads (Home dashboard keeps working). Always scoped to the current user's threads.
- `ChatThreadResponse` gains `matter_id`.
- Thread creation already accepts `matter_id`; add a membership check if not present.
- Reassigning items to a matter (or back to General):
  - `PATCH /chat/threads/{id}` accepts optional `title` and optional `matter_id` (explicit `null` = General). Membership checked on the target matter.
  - `PATCH /documents/{id}` accepts optional `filename` and optional `matter_id` (explicit `null` = General). Owner only, membership checked on the target matter, resource metadata re-synced.
  - Knowledge Bank entries and action items already accept `matter_id` on PATCH; only UI is needed.
- README: document reassignment, `DELETE /matters/{id}` and the `matter_id` filter on `GET /chat/threads`.

### Frontend

- `shared/api/api.ts`: `updateMatter`, `deleteMatter`, and `listChatThreads(matterId: string | null)`. `null` = General.
- Sidebar:
  - "Recent LexChats" renders only when `current.view === 'chat'`.
  - Above it, a matter switcher (`<select>`): "General" plus the user's matters.
  - Thread query key: `['threads', matterId ?? 'general']`. Existing optimistic updates switch to this key.
  - The "Recent matters" block is removed.
- Selected matter follows context: opening a thread sets `selectedMatterId` to the thread's matter (or General); New LexChat creates the thread under the selected matter.
- Knowledge Bank → Matters tab (`features/knowledge-bank/MattersTab.tsx`):
  - Table: title, case number, client, status, updated.
  - Create/Edit dialog (title, case number, client name, status) via shared `Dialog`.
  - Delete with a confirm dialog that states that chats and documents move to General.
  - Create/edit/delete visible to partner/admin only; others see a read-only list.
  - Row action "Open LexChats" sets the matter and navigates to `/chat`.
  - Deleting the currently selected matter resets selection to General and invalidates `['threads']`, `['matters']`, `['documents']`.

### Reassignment UI

- Shared `shared/ui/MatterSelect.tsx`: a `<select>` with "General" plus matters, `value: string | null`, `onChange(matterId | null)`.
- LexChat header: a MatterSelect for the open thread. Changing it PATCHes the thread, sets the selected matter, and invalidates `['threads']`.
- Sidebar thread row menu: "Move to matter…" opens a small dialog with MatterSelect.
- Documents list rows: a MatterSelect in the document drawer (owner only).
- Knowledge Bank entry edit form: confirm a matter field exists; add MatterSelect if not.

## Error handling

- API errors surface through the existing `ErrorBanner`.
- 409 on duplicate `case_number` (unique column) shows inline in the dialog.

## Testing

- Backend: tests for matter delete (permissions, chats/documents/wiki pages nulled) and thread filtering (member vs non-member, General).
- Frontend: `tsc` hook, plus manual run-through: collapse/expand + reload, KB documents upload, legacy `/documents/:id` redirect, matter switch changes thread list, delete matter moves its chats to General.

## Delivery

Three commits in order: (1) collapsible sidebar, (2) documents move, (3) matters + scoped chats.
