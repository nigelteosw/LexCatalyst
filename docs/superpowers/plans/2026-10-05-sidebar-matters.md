# Sidebar, Documents-in-KB, Matter-scoped LexChats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapsible icon sidebar with chats grouped by matter, a page per matter, Documents and Matters living inside Knowledge Bank, LexChat history scoped per matter, matter CRUD, and moving chats/documents between matters.

**Architecture:** Backend adds `DELETE /matters/{id}`, a `matter_id` filter on `GET /chat/threads`, and `matter_id` on the thread and document PATCH bodies. Frontend reuses the existing `documents` view under `/knowledge/documents`, adds a `matters` view, and keeps the threads cache keyed per matter.

**Tech Stack:** FastAPI + SQLAlchemy + unittest (MagicMock db), React + TypeScript + TanStack Query + Tailwind + lucide-react.

Spec: `docs/superpowers/specs/2026-10-05-sidebar-matters-design.md`

## Global Constraints

- All schema changes go through Alembic; this plan needs none (`chat_threads.matter_id` and `documents.matter_id` already exist).
- Every retrieval path checks user, matter membership (`require_matter_member`), and ownership.
- Matter delete is a hard delete; linked records move to General (`matter_id = NULL`). Matter-scoped KB entries become `private`.
- All frontend fetches go through `shared/api/api.ts`; snake_case↔camelCase mapping lives there.
- `localStorage` access is wrapped in try/catch.
- Backend tests: `cd backend && .venv/bin/pytest tests/<file> -v`. Frontend: the `tsc --noEmit` hook runs on save; also `cd frontend && bunx tsc --noEmit`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Change |
|---|---|
| `backend/app/services/organization_service.py` | `delete_matter` |
| `backend/app/routers/organizations.py` | `DELETE /matters/{id}` |
| `backend/app/services/chat_service.py` | `list_threads(matter_filter=…)`, `update_thread` replaces `rename_thread` |
| `backend/app/routers/chat.py` | `matter_id` query param, PATCH body |
| `backend/app/schemas.py` | `ChatThreadUpdate`, `ChatThreadResponse.matter_id`, `DocumentUpdate` |
| `backend/app/services/document_service.py` | `update_user_document` |
| `backend/app/routers/documents.py` | PATCH handles `matter_id` |
| `backend/tests/test_matter_scoping.py` | new |
| `README.md` | routes |
| `frontend/src/features/navigation/Sidebar.tsx` | collapse, remove Documents + Recent matters, scoped threads |
| `frontend/src/app/routes.ts` | `/knowledge/documents`, `/knowledge/matters`, legacy redirect |
| `frontend/src/app/App.tsx` | section bar, matters view, thread query keys, matter sync |
| `frontend/src/features/knowledge-bank/KnowledgeBankSections.tsx` | new |
| `frontend/src/features/knowledge-bank/MattersPanel.tsx` | new |
| `frontend/src/features/knowledge-bank/MatterPage.tsx` | new |
| `frontend/src/features/navigation/ChatsByMatter.tsx` | new |
| `frontend/src/shared/ui/MatterSelect.tsx` | new |
| `frontend/src/shared/api/api.ts` | matter + thread + document functions |
| `frontend/src/shared/types/workspace.ts` | `ChatThread.matterId` |
| `frontend/src/features/documents/DocumentDrawer.tsx` | matter select |

---

### Task 1: Backend — hard-delete a matter

**Files:**
- Modify: `backend/app/services/organization_service.py`
- Modify: `backend/app/routers/organizations.py`
- Test: `backend/tests/test_matter_scoping.py`

**Interfaces:**
- Produces: `delete_matter(db: Session, matter_id: str) -> bool`; `DELETE /matters/{matter_id}` → 204 / 403 / 404.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_matter_scoping.py
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from sqlalchemy.dialects import postgresql

from app.services.organization_service import delete_matter


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class DeleteMatterTests(unittest.TestCase):
    def test_returns_false_when_missing(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        self.assertFalse(delete_matter(db, "missing"))
        db.delete.assert_not_called()

    def test_moves_linked_records_to_general_then_deletes(self) -> None:
        db = MagicMock()
        matter = SimpleNamespace(id="m-1")
        db.get.return_value = matter

        self.assertTrue(delete_matter(db, "m-1"))

        statements = [_sql(call.args[0]) for call in db.execute.call_args_list]
        joined = "\n".join(statements)
        self.assertIn("UPDATE wiki_pages SET matter_id=NULL", joined)
        self.assertIn("UPDATE knowledge_bank_entries SET scope='private'", joined)
        self.assertIn("UPDATE resource_metadata SET scope='private'", joined)
        db.delete.assert_called_once_with(matter)
        db.commit.assert_called_once()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_matter_scoping.py -v`
Expected: FAIL with `ImportError: cannot import name 'delete_matter'`

- [ ] **Step 3: Implement `delete_matter`**

Check the table names first: `grep -n "__tablename__" backend/app/models.py | grep -E "wiki|knowledge|resource"`. If they differ from `wiki_pages`, `knowledge_bank_entries` and `resource_metadata`, update the test strings to match.

Add to `organization_service.py` (extend the existing `from sqlalchemy import …` and `from app.models import …` lines):

```python
from sqlalchemy import update

from app.models import KnowledgeBankEntry, ResourceMetadata, WikiPage


def delete_matter(db: Session, matter_id: str) -> bool:
    """Hard-delete a matter. Linked records fall back to General.

    FKs with ON DELETE SET NULL clear matter_id on chats, documents, KB
    entries, actions and reviews. wiki_pages.matter_id has no FK, so it is
    cleared here. Matter-scoped KB entries and resource metadata become
    private so they are not exposed more widely than before.
    """
    matter = db.get(Matter, matter_id)
    if not matter:
        return False
    db.execute(update(WikiPage).where(WikiPage.matter_id == matter_id).values(matter_id=None))
    db.execute(
        update(KnowledgeBankEntry)
        .where(KnowledgeBankEntry.matter_id == matter_id, KnowledgeBankEntry.scope == "matter")
        .values(scope="private")
    )
    db.execute(
        update(ResourceMetadata)
        .where(ResourceMetadata.matter_id == matter_id, ResourceMetadata.scope == "matter")
        .values(scope="private")
    )
    db.delete(matter)
    db.commit()
    return True
```

- [ ] **Step 4: Add the route** in `organizations.py` after `patch_matter`; add `delete_matter` to the service import.

```python
@router.delete("/matters/{matter_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_matter(
    matter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    require_partner_or_admin(current_user)
    try:
        deleted = delete_matter(db, matter_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Matter not found")
```

- [ ] **Step 5: Run tests** — `cd backend && .venv/bin/pytest tests/test_matter_scoping.py -v` → PASS.

- [ ] **Step 6: Manual check against the DB** (`make dev` running, admin JWT in `$T`): create a matter, start a chat under it, `curl -X DELETE -H "Authorization: Bearer $T" localhost:8000/matters/<id>` → 204; `psql … -c "select matter_id from chat_threads where id='<thread>'"` → NULL.

- [ ] **Step 7: Commit** — `git add backend && git commit -m "feat(backend): hard-delete matters, linked records fall back to General"`

---

### Task 2: Backend — scope and reassign chat threads

**Files:**
- Modify: `backend/app/schemas.py:57-73`
- Modify: `backend/app/services/chat_service.py:487-556`
- Modify: `backend/app/routers/chat.py:170-235`
- Test: `backend/tests/test_matter_scoping.py`

**Interfaces:**
- Produces: `GENERAL = "general"`; `list_threads(db, user_id, *, matter_filter: str | None = None, limit, offset)`; `update_thread(db, *, user_id, thread_id, title: str | None, matter_id: str | None, set_matter: bool) -> ChatThread | None`; `ChatThreadResponse.matter_id`.

- [ ] **Step 1: Failing tests** (append to `test_matter_scoping.py`)

```python
from app.services.chat_service import GENERAL, list_threads, update_thread


class ThreadScopingTests(unittest.TestCase):
    def _where(self, db) -> str:
        return _sql(db.scalars.call_args.args[0])

    def test_general_filter_selects_null_matter(self) -> None:
        db = MagicMock()
        list_threads(db, "u-1", matter_filter=GENERAL)
        self.assertIn("chat_threads.matter_id IS NULL", self._where(db))

    def test_matter_filter_selects_that_matter(self) -> None:
        db = MagicMock()
        list_threads(db, "u-1", matter_filter="m-1")
        self.assertIn("chat_threads.matter_id = 'm-1'", self._where(db))

    def test_no_filter_returns_all_user_threads(self) -> None:
        db = MagicMock()
        list_threads(db, "u-1")
        self.assertNotIn("matter_id", self._where(db))

    def test_update_thread_can_clear_matter(self) -> None:
        db = MagicMock()
        thread = SimpleNamespace(id="t-1", title="Old", matter_id="m-1", updated_at=None)
        db.scalar.return_value = thread
        update_thread(db, user_id="u-1", thread_id="t-1", title=None, matter_id=None, set_matter=True)
        self.assertIsNone(thread.matter_id)
        self.assertEqual(thread.title, "Old")
```

- [ ] **Step 2: Run** → FAIL (`cannot import name 'GENERAL'`).

- [ ] **Step 3: Schemas**

```python
class ChatThreadResponse(BaseModel):
    id: str
    title: str
    matter_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatThreadUpdate(BaseModel):
    """Omitted fields are unchanged. matter_id=null moves the thread to General."""

    title: str | None = Field(default=None, min_length=1, max_length=160)
    matter_id: str | None = None
```

- [ ] **Step 4: Service** — replace `list_threads` and `rename_thread` in `chat_service.py`:

```python
GENERAL = "general"


def list_threads(
    db: Session,
    user_id: str,
    *,
    matter_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ChatThread]:
    """matter_filter: None = all threads, GENERAL = no matter, else a matter id."""
    stmt = select(ChatThread).where(ChatThread.user_id == user_id)
    if matter_filter == GENERAL:
        stmt = stmt.where(ChatThread.matter_id.is_(None))
    elif matter_filter:
        stmt = stmt.where(ChatThread.matter_id == matter_filter)
    stmt = stmt.order_by(desc(ChatThread.updated_at)).offset(offset).limit(limit)
    return list(db.scalars(stmt))


def update_thread(
    db: Session,
    *,
    user_id: str,
    thread_id: str,
    title: str | None,
    matter_id: str | None,
    set_matter: bool,
) -> ChatThread | None:
    thread = db.scalar(
        select(ChatThread).where(
            ChatThread.id == thread_id, ChatThread.user_id == user_id,
        )
    )
    if not thread:
        return None
    if title is not None:
        thread.title = title.strip() or thread.title
    if set_matter:
        thread.matter_id = matter_id
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)
    return thread
```

Run `grep -rn "rename_thread" backend/app` and switch any other callers to `update_thread(..., matter_id=None, set_matter=False)`.

- [ ] **Step 5: Router** — in `chat.py`, import `GENERAL, update_thread` and `require_matter_member` (from `app.dependencies`); replace both handlers:

```python
@router.get("/chat/threads", response_model=list[ChatThreadResponse])
def chat_threads(
    matter_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatThreadResponse]:
    if matter_id and matter_id != GENERAL:
        require_matter_member(db, current_user, matter_id)
    try:
        return [
            ChatThreadResponse.model_validate(thread)
            for thread in list_threads(
                db, current_user.id, matter_filter=matter_id, limit=limit, offset=offset,
            )
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc


@router.patch("/chat/threads/{thread_id}", response_model=ChatThreadResponse)
def update_chat_thread(
    thread_id: str,
    schema: ChatThreadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatThreadResponse:
    set_matter = "matter_id" in schema.model_fields_set
    if set_matter and schema.matter_id:
        require_matter_member(db, current_user, schema.matter_id)
    try:
        thread = update_thread(
            db,
            user_id=current_user.id,
            thread_id=thread_id,
            title=schema.title,
            matter_id=schema.matter_id,
            set_matter=set_matter,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc
    if not thread:
        raise HTTPException(status_code=404, detail="Chat thread not found")
    return ChatThreadResponse.model_validate(thread)
```

Also check thread creation (`chat.py:54` and `:90`, which pass `request.matter_id`). If there's no membership check before them, add `if request.matter_id: require_matter_member(db, current_user, request.matter_id)` at the top of `chat` and `chat_stream`.

- [ ] **Step 6: Run** `.venv/bin/pytest tests -q` → all pass.
- [ ] **Step 7: Commit** — `feat(backend): filter and reassign chat threads by matter`

---

### Task 3: Backend — reassign documents + README

**Files:**
- Modify: `backend/app/schemas.py:92` (`DocumentUpdate`)
- Modify: `backend/app/services/document_service.py:470`
- Modify: `backend/app/routers/documents.py:199-224`
- Modify: `README.md`
- Test: `backend/tests/test_matter_scoping.py`

**Interfaces:**
- Produces: `update_user_document(db, *, user_id, document_id, filename: str | None, matter_id: str | None, set_matter: bool) -> Document | None`

- [ ] **Step 1: Failing test**

```python
from unittest.mock import patch

from app.services.document_service import update_user_document


class DocumentReassignTests(unittest.TestCase):
    def test_moves_document_and_resyncs_metadata(self) -> None:
        db = MagicMock()
        document = SimpleNamespace(id="d-1", filename="a.pdf", matter_id="m-1", user_id="u-1")
        db.scalar.return_value = document
        with patch("app.services.document_service.sync_document_metadata") as sync:
            update_user_document(
                db, user_id="u-1", document_id="d-1", filename=None, matter_id="m-2", set_matter=True,
            )
        self.assertEqual(document.matter_id, "m-2")
        self.assertEqual(document.filename, "a.pdf")
        sync.assert_called_once_with(db, document)
```

- [ ] **Step 2: Run** → FAIL (import error).

- [ ] **Step 3: Implement.** Schema:

```python
class DocumentUpdate(BaseModel):
    """Omitted fields are unchanged. matter_id=null moves the document to General."""

    filename: str | None = Field(default=None, min_length=1, max_length=255)
    matter_id: str | None = None
```

Service: rename `rename_user_document` to `update_user_document` with the new signature. Keep the existing filename validation body, but run it only when `filename is not None`. Then before the commit:

```python
    if set_matter:
        document.matter_id = matter_id
        sync_document_metadata(db, document)
```

Import `sync_document_metadata` from `app.services.resource_metadata_service` if it isn't already imported (check for a circular import with `python -c "import app.main"`).

Router: call it with `filename=schema.filename, matter_id=schema.matter_id, set_matter="matter_id" in schema.model_fields_set`, preceded by:

```python
    if "matter_id" in schema.model_fields_set and schema.matter_id:
        require_matter_member(db, current_user, schema.matter_id)
```

Update any other `rename_user_document` callers (`grep -rn rename_user_document backend`).

- [ ] **Step 4: README** — in the API routes section add:

```md
- `DELETE /matters/{id}` — partner/admin. Hard-deletes the matter; its chats, documents, KB entries and wiki pages move to General (matter-scoped KB entries become private).
- `GET /chat/threads?matter_id=<id|general>` — authenticated; matter members only for a matter id. Omit for all threads.
- `PATCH /chat/threads/{id}` — owner; body `{title?, matter_id?}`; `matter_id: null` moves to General.
- `PATCH /documents/{id}` — owner; body `{filename?, matter_id?}`; `matter_id: null` moves to General.
```

- [ ] **Step 5: Run** `.venv/bin/pytest tests -q` → pass.
- [ ] **Step 6: Commit** — `feat(backend): reassign documents between matters`

---

### Task 4: Frontend — collapsible sidebar

**Files:**
- Modify: `frontend/src/features/navigation/Sidebar.tsx`

**Interfaces:**
- Produces: localStorage key `lc.sidebar.collapsed` (`'1'` / `'0'`).

- [ ] **Step 1: State.** After the `width` state:

```tsx
const COLLAPSED_WIDTH = 64
const COLLAPSED_KEY = 'lc.sidebar.collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}
```

(Put the constants and helper at module level.) Inside the component:

```tsx
const [collapsed, setCollapsed] = useState(readCollapsed)
// Collapse is a desktop affordance; the mobile drawer always shows labels.
const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
useEffect(() => {
  const mq = window.matchMedia('(min-width: 1024px)')
  const onChange = () => setIsDesktop(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}, [])
const isCollapsed = collapsed && isDesktop

function toggleCollapsed() {
  setCollapsed((prev) => {
    const next = !prev
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // per-viewer convenience only
    }
    return next
  })
}
```

Set the aside style to `style={{ width: \`${isCollapsed ? COLLAPSED_WIDTH : width}px\` }}`, add `transition-[width]` to its classes, and render the resize handle only when `!isCollapsed`.

- [ ] **Step 2: Nav item component.** Replace the five hand-written nav buttons with a local component:

```tsx
function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
  onPrefetch,
  badge,
}: {
  icon: typeof Home
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  onPrefetch?: () => void
  badge?: number
}) {
  return (
    <button
      aria-label={label}
      title={collapsed ? label : undefined}
      onClick={onClick}
      onFocus={onPrefetch}
      onMouseEnter={onPrefetch}
      className={`${sidebarActionClass} relative min-h-10 gap-3 text-[13px] ${
        collapsed ? 'justify-center px-0' : ''
      } ${active ? sidebarNavActiveClass : sidebarNavClass}`}
      type="button"
    >
      <Icon size={20} className="shrink-0" />
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {badge ? (
        collapsed ? (
          <span
            aria-label={`${badge} pending`}
            className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-[#f0a000]"
          />
        ) : (
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#f0a000] px-1 text-[9.5px] font-semibold text-[#0f0f0f]">
            {badge}
          </span>
        )
      ) : null}
    </button>
  )
}
```

Workspace nav becomes (Documents removed; KB active for documents/matters):

```tsx
<NavItem icon={Home} label="Home" collapsed={isCollapsed} active={current.view === 'home'}
  onClick={() => { selectHome(); closeMobile() }} />
<NavItem icon={BookMarked} label="Knowledge Bank" collapsed={isCollapsed}
  active={['knowledge_bank', 'documents', 'matters'].includes(current.view)}
  onPrefetch={() => prefetchWorkspace('knowledge_bank')}
  onClick={() => { selectKnowledgeBank(); closeMobile() }} />
<NavItem icon={HeartPulse} label="Wellbeing" collapsed={isCollapsed} active={current.view === 'wellbeing'}
  onPrefetch={() => prefetchWorkspace('wellbeing')}
  onClick={() => { selectWellbeing(); closeMobile() }} />
<NavItem icon={CheckSquare} label="Workboard" collapsed={isCollapsed} active={current.view === 'actions'}
  badge={pendingTaskCount} onPrefetch={() => prefetchWorkspace('actions')}
  onClick={() => { selectActions(); closeMobile() }} />
```

Remove `'documents'` from `prefetchWorkspace` (its type and branch), plus the `FileText`, `listDocuments` and `selectDocuments` imports.

- [ ] **Step 3: Header.** When collapsed, show only the favicon (centred) and a `ChevronsRight` button. When expanded, keep the wordmark and add a `ChevronsLeft` button (desktop only, `hidden lg:grid`) next to the mobile `X`:

```tsx
<button
  onClick={toggleCollapsed}
  aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
  title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
  className="hidden h-8 w-8 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:grid"
  type="button"
>
  {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
</button>
```

Collapsed header layout: `flex flex-col items-center gap-2` with the favicon button (no wordmark), then the toggle. New LexChat collapses to an icon button (`Plus`, size 18, `aria-label="New LexChat"`). Birdie collapses to just the avatar circle with `aria-label`. Padding goes to `px-2`.

- [ ] **Step 4: Footer.** When collapsed, render a vertical stack: initials avatar button (opens Settings, `aria-label="Profile settings"`) and the logout icon. Hide the name/"Profile settings" text and `footerExtra`. Hide the whole chats `<nav>` (Task 7 replaces it).

- [ ] **Step 5: Verify.** `bunx tsc --noEmit` passes. In `bun run dev`: collapse → 64px rail shows LC icon, Home/KB/Wellbeing/Workboard, +, Birdie, avatar, logout; tooltips on hover; reload keeps it collapsed; expand restores the dragged width; mobile drawer unaffected.

- [ ] **Step 6: Commit** — `feat(frontend): collapsible icon sidebar`

---

### Task 5: Frontend — Documents and Matters inside Knowledge Bank

**Files:**
- Modify: `frontend/src/app/routes.ts`
- Create: `frontend/src/features/knowledge-bank/KnowledgeBankSections.tsx`
- Modify: `frontend/src/app/App.tsx:600-630`

**Interfaces:**
- Produces: `AppView` member `{ view: 'matters' }`; `selectMatters(options?)`; `selectDocuments(id?)` now navigates to `/knowledge/documents[/id]`; `<KnowledgeBankSections />`.

- [ ] **Step 1: Routes.** In `routes.ts`, add `type MattersView = { view: 'matters' }` to `AppView`. In `parseWorkspacePath`, before the `segments.length > 2` guard:

```ts
if (section === 'knowledge' && rawId === 'documents' && segments.length <= 3) {
  return { current: { view: 'documents', documentId: decodeSegment(segments[2]) }, isKnownRoute: true }
}
if (section === 'knowledge' && rawId === 'matters' && segments.length === 2) {
  return { current: { view: 'matters' }, isKnownRoute: true }
}
```

Change `selectDocuments` to `go(routeWithId('/knowledge/documents', documentId), options)` and add:

```ts
selectMatters: useCallback(
  (options?: NavigationOptions) => go('/knowledge/matters', options),
  [go],
),
```

The legacy `/documents[/id]` paths still parse to the `documents` view. Add a redirect in `useWorkspaceNavigation`:

```ts
useEffect(() => {
  if (location.pathname === '/documents' || location.pathname.startsWith('/documents/')) {
    navigate(`/knowledge${location.pathname}`, { replace: true })
  }
}, [location.pathname, navigate])
```

(import `useEffect`).

- [ ] **Step 2: Section bar**

```tsx
// frontend/src/features/knowledge-bank/KnowledgeBankSections.tsx
import { BookMarked, BriefcaseBusiness, FileText } from 'lucide-react'
import { useWorkspaceNavigation } from '../../app/routes'

const sections = [
  { view: 'knowledge_bank', label: 'Library', icon: BookMarked },
  { view: 'documents', label: 'Documents', icon: FileText },
  { view: 'matters', label: 'Matters', icon: BriefcaseBusiness },
] as const

export function KnowledgeBankSections() {
  const { current, selectKnowledgeBank, selectDocuments, selectMatters } = useWorkspaceNavigation()
  const open = {
    knowledge_bank: () => selectKnowledgeBank(),
    documents: () => selectDocuments(),
    matters: () => selectMatters(),
  }
  return (
    <nav
      aria-label="Knowledge Bank sections"
      className="flex shrink-0 gap-1 border-b border-neutral-100 bg-white px-4 pt-2 lg:px-6"
    >
      {sections.map(({ view, label, icon: Icon }) => {
        const active = current.view === view
        return (
          <button
            key={view}
            aria-current={active ? 'page' : undefined}
            onClick={open[view]}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
            type="button"
          >
            <Icon size={15} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 3: App.** Wrap the `documents` and `knowledge_bank` branches, and add the `matters` branch (`MattersPanel` comes in Task 8; until then render `<div className="p-6 text-sm text-neutral-500">Matters</div>`):

```tsx
) : current.view === 'documents' || current.view === 'knowledge_bank' || current.view === 'matters' ? (
  <div className="flex min-h-0 flex-1 flex-col">
    <KnowledgeBankSections />
    {current.view === 'documents' ? (
      <DocumentsPanel currentUser={currentUser} />
    ) : current.view === 'matters' ? (
      <MattersPanel currentUser={currentUser} matters={matters} onMatterChange={handleMatterChange} />
    ) : (
      <KnowledgeBankPanel
        matters={matters}
        selectedMatterId={selectedMatterId}
        onMatterChange={handleMatterChange}
        currentUser={currentUser}
      />
    )}
  </div>
```

Also: wrap `PanelErrorBoundary`/the panel `key` so switching sections doesn't replay the enter animation on the bar (`key={['documents','knowledge_bank','matters'].includes(current.view) ? 'kb' : current.view}`).

- [ ] **Step 4: Verify** — tsc passes. `/knowledge`, `/knowledge/documents`, `/knowledge/documents/<id>` (drawer opens), `/knowledge/matters` all render. `/documents/<id>` redirects. Upload works from KB → Documents. Sidebar KB item is highlighted on all three.
- [ ] **Step 5: Commit** — `feat(frontend): move Documents into Knowledge Bank`

---

### Task 6: Frontend — API + types

**Files:**
- Modify: `frontend/src/shared/types/workspace.ts:17-22`
- Modify: `frontend/src/shared/api/api.ts`

**Interfaces:**
- Produces:
  - `ChatThread.matterId: string | null`
  - `type ThreadScope = string | 'general' | 'all'`
  - `listChatThreads(scope: ThreadScope = 'all'): Promise<ChatThread[]>`
  - `moveChatThread(threadId: string, matterId: string | null): Promise<ChatThread>`
  - `updateMatter(id, patch: { title?; caseNumber?; clientName?; status? }): Promise<Matter>`
  - `deleteMatter(id: string): Promise<void>`
  - `moveDocument(id: string, matterId: string | null): Promise<WorkspaceDocument>`
  - `threadScopeKey(matterId: string | null): string` (returns `matterId ?? 'general'`)

- [ ] **Step 1: Types** — add `matterId: string | null` to `ChatThread`. Add `matter_id: string | null` to `BackendThread` and `matterId: thread.matter_id ?? null` to `mapThread`. Fix the optimistic thread in `App.tsx:323` to include `matterId: selectedMatterId`.

- [ ] **Step 2: Functions**

```ts
export type ThreadScope = string

export function threadScopeKey(matterId: string | null): ThreadScope {
  return matterId ?? 'general'
}

export async function listChatThreads(scope: ThreadScope = 'all'): Promise<ChatThread[]> {
  const query = scope === 'all' ? '' : `?matter_id=${encodeURIComponent(scope)}`
  const threads = await request<BackendThread[]>(`/chat/threads${query}`)
  return threads.map(mapThread)
}

export async function moveChatThread(threadId: string, matterId: string | null): Promise<ChatThread> {
  const thread = await request<BackendThread>(`/chat/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ matter_id: matterId }),
  })
  return mapThread(thread)
}

export async function updateMatter(
  id: string,
  patch: { title?: string; caseNumber?: string; clientName?: string | null; status?: Matter['status'] },
): Promise<Matter> {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.caseNumber !== undefined) body.case_number = patch.caseNumber
  if (patch.clientName !== undefined) body.client_name = patch.clientName
  if (patch.status !== undefined) body.status = patch.status
  return mapMatter(
    await request<BackendMatter>(`/matters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  )
}

export async function deleteMatter(id: string): Promise<void> {
  await request<void>(`/matters/${id}`, { method: 'DELETE' })
}

export async function moveDocument(id: string, matterId: string | null): Promise<WorkspaceDocument> {
  return mapDocument(
    await request<BackendDocument>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ matter_id: matterId }),
    }),
  )
}
```

Check that `request` handles a 204 empty body (look at its implementation; if it always calls `res.json()`, guard with `if (res.status === 204) return undefined as T`). Callers that pass `listChatThreads` directly as `queryFn` (`HomePanel.tsx:253`, `App.tsx:129`) must become `() => listChatThreads()`, because TanStack would otherwise pass its context object as `scope`.

- [ ] **Step 3: Verify** tsc. **Commit** — `feat(frontend): matter, thread and document reassignment API`

---

### Task 7: Frontend — "Chats by matter" sidebar

Layout (from the mockup): nav at the top (Home, LexChat, Knowledge Bank, Wellbeing, Workboard with count), then a **Chats by matter** section. Each matter is a folder row (`Folder` icon, `caseNumber · title`, truncated) with its threads indented under a left rule. **General** is always last. The section only renders when `current.view === 'chat'` and the sidebar is expanded.

**Files:**
- Create: `frontend/src/shared/ui/MatterSelect.tsx`
- Create: `frontend/src/features/navigation/ChatsByMatter.tsx`
- Modify: `frontend/src/features/navigation/Sidebar.tsx`
- Modify: `frontend/src/app/App.tsx`
- Modify: `frontend/src/features/home/HomePanel.tsx:253`

**Interfaces:**
- Consumes: Task 6 functions; `ChatThread.matterId`.
- Produces:
  - `<MatterSelect matters value onChange label? tone?: 'dark' | 'light' className? />`
  - `groupThreadsByMatter(threads: ChatThread[], matters: Matter[]): Array<{ matter: Matter | null; threads: ChatThread[] }>`
  - `<ChatsByMatter threads matters activeThreadId onSelectThread onSelectMatter />`
  - one threads cache, key `['threads', 'all']`

- [ ] **Step 1: MatterSelect** (used for "Move to…", the chat header and the document drawer)

```tsx
// frontend/src/shared/ui/MatterSelect.tsx
import type { Matter } from '../types/workspace'

export function MatterSelect({
  matters,
  value,
  onChange,
  label = 'Matter',
  tone = 'light',
  className = '',
}: {
  matters: Matter[]
  value: string | null
  onChange: (matterId: string | null) => void
  label?: string
  tone?: 'light' | 'dark'
  className?: string
}) {
  const toneClass =
    tone === 'dark'
      ? 'border-white/10 bg-white/[0.06] text-white/80'
      : 'border-neutral-200 bg-white text-neutral-800'
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full truncate rounded-lg border px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${toneClass} ${className}`}
    >
      <option value="">General</option>
      {matters.map((m) => (
        <option key={m.id} value={m.id}>
          {m.caseNumber} · {m.title}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Grouping (pure function first)**

```tsx
// frontend/src/features/navigation/ChatsByMatter.tsx
import { Folder } from 'lucide-react'
import type { ChatThread, Matter } from '../../shared/types/workspace'

export type MatterGroup = { matter: Matter | null; threads: ChatThread[] }

/** Matters ordered by their most recent thread; matters with no threads are hidden; General last. */
export function groupThreadsByMatter(threads: ChatThread[], matters: Matter[]): MatterGroup[] {
  const byId = new Map(matters.map((m) => [m.id, m]))
  const groups = new Map<string, MatterGroup>()
  const general: MatterGroup = { matter: null, threads: [] }
  // threads arrive newest first, so insertion order = recency order
  for (const thread of threads) {
    const matter = thread.matterId ? byId.get(thread.matterId) : undefined
    if (!matter) {
      general.threads.push(thread)
      continue
    }
    const group = groups.get(matter.id) ?? { matter, threads: [] }
    group.threads.push(thread)
    groups.set(matter.id, group)
  }
  return [...groups.values(), general]
}
```

A thread whose matter isn't in the active `matters` list (closed, or no longer a member) falls into General for display. That's intentional, and it doesn't change the thread.

- [ ] **Step 3: Component** (same file)

```tsx
export function ChatsByMatter({
  threads,
  matters,
  renderThread,
  onSelectMatter,
}: {
  threads: ChatThread[]
  matters: Matter[]
  renderThread: (thread: ChatThread) => React.ReactNode
  onSelectMatter: (matterId: string | null) => void
}) {
  const groups = groupThreadsByMatter(threads, matters)
  return (
    <div className="space-y-3">
      <div className="px-2.5 text-[11px] font-medium text-white/35">Chats by matter</div>
      {groups.map(({ matter, threads: groupThreads }) => (
        <section key={matter?.id ?? 'general'} aria-label={matter ? matter.title : 'General'}>
          <button
            type="button"
            onClick={() => onSelectMatter(matter?.id ?? null)}
            title={matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-white/85 hover:bg-white/[0.07]"
          >
            <Folder size={14} className="shrink-0 text-white/45" />
            <span className="truncate">{matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}</span>
          </button>
          <div className="ml-[17px] space-y-0.5 border-l border-white/10 pl-2">
            {groupThreads.length > 0 ? (
              groupThreads.map(renderThread)
            ) : (
              <div className="px-2 py-1 text-[11px] text-white/30">No LexChats yet</div>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
```

Clicking a folder header selects that matter and starts a new chat in it (`onMatterChange(id); startNewChat()`). The matter page link lives on the KB Matters list (Task 10).

- [ ] **Step 4: Sidebar wiring.**
  - Add a **LexChat** nav item (`MessageSquare` icon, active when `current.view === 'chat'`, onClick `startNewChat()`) between Home and Knowledge Bank. Final nav order: Home, LexChat, Knowledge Bank, Wellbeing, Workboard. The collapsed rail shows the same five icons.
  - Delete the "Recent matters" block and the old "Recent LexChats" heading.
  - Render `<ChatsByMatter …>` inside the chats `<nav>` only when `current.view === 'chat' && !isCollapsed`, using `renderThread={(t) => <ThreadRow key={t.id} thread={t} matters={matters} … />}`. Drop the per-index `dotClass` (the left rule replaces it).
  - In `ThreadRow`, change both `setQueryData<ChatThread[]>(['threads'], …)` calls to `queryClient.setQueriesData<ChatThread[]>({ queryKey: ['threads'] }, …)`. Add a "Move to…" menu item that toggles `isMoving` and shows:

```tsx
const moveMutation = useMutation({
  mutationFn: (matterId: string | null) => moveChatThread(thread.id, matterId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['threads'] })
    setIsMoving(false)
  },
})
```

```tsx
{isMoving && (
  <MatterSelect
    tone="dark"
    label={`Move "${thread.title}" to matter`}
    matters={matters}
    value={thread.matterId}
    onChange={(id) => moveMutation.mutate(id)}
  />
)}
```

- [ ] **Step 5: App queries.** One cache for the sidebar and Home:

```tsx
const threadsQuery = useQuery({
  queryKey: ['threads', 'all'],
  queryFn: () => listChatThreads(),
  enabled: isAuthenticated,
})
```

In `onThread` (`App.tsx:323`), call `queryClient.setQueryData(['threads', 'all'], …)` and include `matterId: selectedMatterId` in the optimistic thread. HomePanel uses `queryKey: ['threads', 'all'], queryFn: () => listChatThreads()`.

Keep the selected matter in sync with the open thread:

```tsx
useEffect(() => {
  const thread = threads.find((t) => t.id === threadId)
  if (thread && thread.matterId !== selectedMatterId) handleMatterChange(thread.matterId)
}, [threadId, threads]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 6: Chat header picker.** Replace the existing header matter selects (`App.tsx:663`, `:689`) with one `MatterSelect` bound to `selectedMatterId`. With an open thread, a change calls `moveChatThread(threadId, id)`, then `handleMatterChange(id)` and invalidates `['threads']`. Without a thread, it only calls `handleMatterChange(id)`, so the next message creates the thread in that matter.

- [ ] **Step 7: Verify.** tsc. Manual:
  - Off `/chat`, there are no chat groups.
  - On `/chat`, folders are ordered by recency and General is last.
  - Clicking a folder starts a new chat in that matter.
  - The first message lands under that folder.
  - "Move to…" re-files a thread.
  - Opening a General thread flips the header picker to General.
  - A non-member gets 403 for `GET /chat/threads?matter_id=<other>` (curl).

- [ ] **Step 8: Commit** — `feat(frontend): chats grouped by matter in the sidebar`

---

### Task 8: Frontend — Matters panel (CRUD)

**Files:**
- Create: `frontend/src/features/knowledge-bank/MattersPanel.tsx`
- Modify: `frontend/src/app/App.tsx` (replace the Task 5 placeholder; add a lazy import like the other panels)

**Interfaces:**
- Consumes: `listMatters`, `createMatter`, `updateMatter`, `deleteMatter`, shared `Dialog`, `Button`, `ErrorBanner`, `getErrorMessage` (check the exact export names in `shared/ui` and `shared/lib/errors.ts` before importing).
- Produces: `MattersPanel({ currentUser, matters, onMatterChange })`.

- [ ] **Step 1: Write the panel**

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { createMatter, deleteMatter, updateMatter } from '../../shared/api/api'
import type { CurrentUser, Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { getErrorMessage } from '../../shared/lib/errors'

type Draft = { id?: string; title: string; caseNumber: string; clientName: string; status: Matter['status'] }

const emptyDraft: Draft = { title: '', caseNumber: '', clientName: '', status: 'active' }

export function MattersPanel({
  currentUser,
  matters,
  onMatterChange,
}: {
  currentUser: CurrentUser | null
  matters: Matter[]
  onMatterChange: (matterId: string | null) => void
}) {
  const canManage = currentUser?.isAdmin === true || currentUser?.firmRole === 'partner'
  const queryClient = useQueryClient()
  const { startNewChat, selectMatter } = useWorkspaceNavigation()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Matter | null>(null)

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['matters'] })
    queryClient.invalidateQueries({ queryKey: ['threads'] })
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
  }

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? updateMatter(d.id, { title: d.title, caseNumber: d.caseNumber, clientName: d.clientName || null, status: d.status })
        : createMatter({ title: d.title, caseNumber: d.caseNumber, clientName: d.clientName || undefined }),
    onSuccess: () => {
      refresh()
      setDraft(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (m: Matter) => deleteMatter(m.id),
    onSuccess: (_, m) => {
      onMatterChange(null)
      refresh()
      setPendingDelete(null)
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (draft) saveMutation.mutate(draft)
  }

  return (
    <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Matters</h1>
        {canManage && (
          <Button onClick={() => setDraft(emptyDraft)}>
            <Plus size={14} /> New matter
          </Button>
        )}
      </div>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-2 pr-3">Title</th>
            <th className="py-2 pr-3">Case no.</th>
            <th className="py-2 pr-3">Client</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {matters.map((m) => (
            <tr key={m.id} className="border-b border-neutral-100">
              <td className="py-2 pr-3 font-medium text-neutral-900">
                <button type="button" className="hover:underline" onClick={() => selectMatter(m.id)}>
                  {m.title}
                </button>
              </td>
              <td className="py-2 pr-3 text-neutral-600">{m.caseNumber}</td>
              <td className="py-2 pr-3 text-neutral-600">{m.clientName ?? '—'}</td>
              <td className="py-2 pr-3 capitalize text-neutral-600">{m.status}</td>
              <td className="py-2 text-right">
                <div className="inline-flex gap-1">
                  <Button
                    aria-label={`Open LexChats for ${m.title}`}
                    variant="ghost"
                    onClick={() => { onMatterChange(m.id); startNewChat() }}
                  >
                    <MessageSquare size={14} />
                  </Button>
                  {canManage && (
                    <>
                      <Button
                        aria-label={`Edit ${m.title}`}
                        variant="ghost"
                        onClick={() =>
                          setDraft({ id: m.id, title: m.title, caseNumber: m.caseNumber, clientName: m.clientName ?? '', status: m.status })
                        }
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button aria-label={`Delete ${m.title}`} variant="ghost" onClick={() => setPendingDelete(m)}>
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {matters.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-neutral-500">No matters yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {draft && (
        <Dialog title={draft.id ? 'Edit matter' : 'New matter'} onClose={() => setDraft(null)}>
          <form onSubmit={submit} className="space-y-3">
            {saveMutation.error && <ErrorBanner message={getErrorMessage(saveMutation.error)} />}
            <label className="block text-sm">
              Title
              <input required maxLength={200} className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5"
                value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="block text-sm">
              Case number
              <input required maxLength={120} className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5"
                value={draft.caseNumber} onChange={(e) => setDraft({ ...draft, caseNumber: e.target.value })} />
            </label>
            <label className="block text-sm">
              Client name
              <input maxLength={255} className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5"
                value={draft.clientName} onChange={(e) => setDraft({ ...draft, clientName: e.target.value })} />
            </label>
            {draft.id && (
              <label className="block text-sm">
                Status
                <select className="mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5"
                  value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Matter['status'] })}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setDraft(null)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>Save</Button>
            </div>
          </form>
        </Dialog>
      )}

      {pendingDelete && (
        <Dialog title="Delete matter permanently?" onClose={() => setPendingDelete(null)}>
          <div className="space-y-3 text-sm">
            {deleteMutation.error && <ErrorBanner message={getErrorMessage(deleteMutation.error)} />}
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              <strong>{pendingDelete.title}</strong> ({pendingDelete.caseNumber}) will be deleted. This cannot be undone.
              Its LexChats, documents and wiki pages move to General. Matter-only Knowledge Bank entries become
              private to their authors. Matter members lose access.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(pendingDelete)}>
                Delete matter
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
```

Adjust to the real `Button` variants, `Dialog` props, `MatterStatus` values (`grep -n "MatterStatus" src/shared/types/workspace.ts`) and `ErrorBanner` props. The tsc hook flags any mismatch. `App.tsx` lists `listMatters('active')`, so closed matters vanish from the list. In `App.tsx`, switch the Matters view to its own query of `listMatters()` (all statuses) under key `['matters', 'all']`. `invalidateQueries(['matters'])` covers both keys.

- [ ] **Step 2: Wire into App** — replace the placeholder from Task 5 with the lazy-loaded `MattersPanel`.
- [ ] **Step 3: Verify** — as a partner: create → appears in the table and in the sidebar picker. Edit the title → updates. A duplicate case number shows an error in the dialog. Delete → warning shown; afterwards the matter's chats appear under General and its documents still exist with no matter. As an associate (Settings → View as, DEMO_MODE): table is read-only.
- [ ] **Step 4: Commit** — `feat(frontend): Matters panel with create, edit and delete`

---

### Task 9: Frontend — reassign documents and KB entries

**Files:**
- Modify: `frontend/src/features/documents/DocumentDrawer.tsx`
- Modify: the Knowledge Bank entry edit form (locate with `grep -rn "updateKnowledgeBankEntry\|patchKnowledgeBankEntry" frontend/src`)

- [ ] **Step 1: Document drawer.** The drawer needs `matters` (fetch with `useQuery({ queryKey: ['matters'], queryFn: () => listMatters('active') })` inside the drawer, so `DocumentsPanel` stays unchanged). When the document's `canManage` is true, render:

```tsx
<label className="block text-xs font-medium text-neutral-500">
  Matter
  <MatterSelect
    matters={matters}
    value={document.matterId ?? null}
    onChange={(id) => moveMutation.mutate(id)}
    className="mt-1"
  />
</label>
```

```tsx
const moveMutation = useMutation({
  mutationFn: (matterId: string | null) => moveDocument(document.id, matterId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
})
```

- [ ] **Step 2: KB entry form.** If the edit form already has a matter field, leave it. Otherwise add `MatterSelect` bound to the entry's `matterId` and include `matter_id` in the PATCH body through the existing api function (extend its payload type in `api.ts` with `matterId?: string | null` → `matter_id`). If moving to General leaves an entry with `scope === 'matter'`, the backend may reject it. In that case, disable the "General" option while scope is `matter`, with the hint "Change scope first".

- [ ] **Step 3: Verify** — move a document from General to a matter and back; the list reflects it after refresh. Move a KB entry between matters.
- [ ] **Step 4: Commit** — `feat(frontend): move documents and KB entries between matters`

---

### Task 10: Frontend — Matter page

Layout (from the mockup):
- A breadcrumb `Knowledge Bank / <caseNumber>`, then a serif title, then a meta line `caseNumber · client`.
- **Upload** (secondary) and **New LexChat in matter** (primary) buttons on the right.
- Tabs with counts: **Documents · Cases · LexChats · Pending**.
- Each row shows an icon tile, a name, meta below it, and the date on the right.

Tab sources (no new backend routes):
- **Documents**: `listDocuments()` filtered to `matterId === id`.
- **Cases**: `listKnowledgeBankEntryPage({ matterId: id, limit: 100 })` (Knowledge Bank entries for this matter).
- **LexChats**: `listChatThreads(id)`, which uses the Task 2 backend filter.
- **Pending**: `listActionItems()` filtered to `matterId === id && status !== 'done'`.

The mockup's "Lead" field doesn't exist in the schema. It's left out (YAGNI).

**Files:**
- Modify: `frontend/src/app/routes.ts`
- Create: `frontend/src/features/knowledge-bank/MatterPage.tsx`
- Modify: `frontend/src/app/App.tsx`
- Modify: `frontend/src/features/knowledge-bank/KnowledgeBankSections.tsx` (Matters is active on the matter page too)

**Interfaces:**
- Consumes: `listDocuments`, `uploadDocument`, `moveDocument`, `listKnowledgeBankEntryPage`, `listChatThreads`, `listActionItems`, `selectThread`, `selectDocuments`, `selectKnowledgeBank`, `selectActions`.
- Produces: `AppView` member `{ view: 'matter'; matterId: string }`; `selectMatter(matterId: string, options?)`; route `/knowledge/matters/:id`.

- [ ] **Step 1: Route.** In `parseWorkspacePath`, next to the Task 5 matters rule:

```ts
if (section === 'knowledge' && rawId === 'matters' && segments.length === 3) {
  return { current: { view: 'matter', matterId: decodeSegment(segments[2])! }, isKnownRoute: true }
}
```

Add `type MatterView = { view: 'matter'; matterId: string }` to `AppView`, and:

```ts
selectMatter: useCallback(
  (matterId: string, options?: NavigationOptions) =>
    go(`/knowledge/matters/${encodeURIComponent(matterId)}`, options),
  [go],
),
```

Add `'matter'` to the KB-family view checks: the sidebar active state (Task 4), the App branch and panel key (Task 5), and `KnowledgeBankSections` (Matters active when `current.view === 'matter'`).

- [ ] **Step 2: Page**

```tsx
// frontend/src/features/knowledge-bank/MatterPage.tsx
import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, FileText, MessageSquare, Scale } from 'lucide-react'
import {
  listActionItems,
  listChatThreads,
  listDocuments,
  listKnowledgeBankEntryPage,
  moveDocument,
  uploadDocument,
} from '../../shared/api/api'
import type { Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { Button } from '../../shared/ui/Button'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { getErrorMessage } from '../../shared/lib/errors'

type Tab = 'documents' | 'cases' | 'chats' | 'pending'

function shortDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function Row({ icon, title, meta, date, onClick }: {
  icon: ReactNode
  title: string
  meta?: string
  date: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-4 border-b border-neutral-100 px-1 py-4 text-left hover:bg-neutral-50"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-neutral-900">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-sm text-neutral-500">{meta}</span>}
      </span>
      <span className="shrink-0 text-sm text-neutral-500">{shortDate(date)}</span>
    </button>
  )
}

export function MatterPage({
  matterId,
  matters,
  onMatterChange,
}: {
  matterId: string
  matters: Matter[]
  onMatterChange: (matterId: string | null) => void
}) {
  const matter = matters.find((m) => m.id === matterId)
  const [tab, setTab] = useState<Tab>('documents')
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { selectKnowledgeBank, selectMatters, selectDocuments, selectThread, selectActions, startNewChat } =
    useWorkspaceNavigation()

  const docs = useQuery({ queryKey: ['documents'], queryFn: listDocuments })
  const cases = useQuery({
    queryKey: ['kbEntries', 'matter', matterId],
    queryFn: () => listKnowledgeBankEntryPage({ matterId, limit: 100, offset: 0 }),
  })
  const chats = useQuery({ queryKey: ['threads', matterId], queryFn: () => listChatThreads(matterId) })
  const actions = useQuery({ queryKey: ['actions'], queryFn: listActionItems })

  const matterDocs = (docs.data ?? []).filter((d) => d.matterId === matterId)
  const matterCases = cases.data?.items ?? []
  const matterChats = chats.data ?? []
  const pending = (actions.data ?? []).filter((a) => a.matterId === matterId && a.status !== 'done')

  const upload = useMutation({
    // Upload has no matter field; file it into this matter right after.
    mutationFn: async (file: File) => moveDocument((await uploadDocument(file)).id, matterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  })

  if (!matter) {
    return <div className="p-6 text-sm text-neutral-500">Matter not found or you don't have access.</div>
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'documents', label: 'Documents', count: matterDocs.length },
    { id: 'cases', label: 'Cases', count: matterCases.length },
    { id: 'chats', label: 'LexChats', count: matterChats.length },
    { id: 'pending', label: 'Pending', count: pending.length },
  ]

  return (
    <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <button type="button" className="underline" onClick={() => selectKnowledgeBank()}>Knowledge Bank</button>
        {' / '}
        <button type="button" className="hover:underline" onClick={() => selectMatters()}>Matters</button>
        {' / '}
        <span>{matter.caseNumber}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-neutral-900 lg:text-4xl">{matter.title}</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {[matter.caseNumber, matter.clientName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload.mutate(file)
              e.target.value = ''
            }}
          />
          <Button variant="secondary" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
          <Button onClick={() => { onMatterChange(matterId); startNewChat() }}>New LexChat in matter</Button>
        </div>
      </div>
      {upload.error && <ErrorBanner message={getErrorMessage(upload.error)} />}

      <div role="tablist" className="mt-8 flex gap-6 border-b border-neutral-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-3 text-sm ${
              tab === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t.label} <span className="text-neutral-400">{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'documents' &&
          matterDocs.map((d) => (
            <Row key={d.id} icon={<FileText size={18} />} title={d.filename}
              meta={`${d.contentType.includes('pdf') ? 'PDF' : 'DOCX'} · ${d.status}`}
              date={d.updatedAt} onClick={() => selectDocuments(d.id)} />
          ))}
        {tab === 'cases' &&
          matterCases.map((e) => (
            <Row key={e.id} icon={<Scale size={18} />} title={e.title} meta={e.entryType}
              date={e.updatedAt} onClick={() => selectKnowledgeBank(e.id)} />
          ))}
        {tab === 'chats' &&
          matterChats.map((c) => (
            <Row key={c.id} icon={<MessageSquare size={18} />} title={c.title}
              date={c.updatedAt} onClick={() => selectThread(c.id)} />
          ))}
        {tab === 'pending' &&
          pending.map((a) => (
            <Row key={a.id} icon={<CheckSquare size={18} />} title={a.title} meta={a.status}
              date={a.updatedAt} onClick={() => selectActions(a.id)} />
          ))}
        {tabs.find((t) => t.id === tab)?.count === 0 && (
          <p className="py-8 text-center text-sm text-neutral-500">Nothing here yet.</p>
        )}
      </div>
    </div>
  )
}
```

Confirm the field names against the types before relying on them (tsc flags any mismatch):
- the page shape returned by `listKnowledgeBankEntryPage` (`items`?);
- `KnowledgeBankEntry.title`, `entryType` and `updatedAt`;
- `ActionItem.title`, `status` and `updatedAt`;
- the `Button` variant names.

If `listKnowledgeBankEntryPage` with `matterId` 403s for non-members, `cases.error` shows nothing. That's acceptable, because a non-member wouldn't see the matter in `matters` in the first place.

- [ ] **Step 3: Wire into App** — in the KB-family branch, add `current.view === 'matter' ? <MatterPage matterId={current.matterId} matters={allMatters} onMatterChange={handleMatterChange} />`. Use the `['matters', 'all']` list from Task 8 so closed matters still open.

- [ ] **Step 4: Verify.** tsc. Manual:
  - The Matters list title opens `/knowledge/matters/<id>`.
  - The breadcrumb goes back.
  - Upload lands in the Documents tab and the count increments.
  - New LexChat in matter → the first message appears in that matter's sidebar folder and in the LexChats tab.
  - The Pending tab matches the Workboard items for that matter.
  - Refreshing on the URL works.

- [ ] **Step 5: Commit** — `feat(frontend): matter page with documents, cases, LexChats and pending`

---

## Final check

- [ ] `cd backend && .venv/bin/pytest tests -q` all pass.
- [ ] `cd frontend && bunx tsc --noEmit && bun run build` succeed.
- [ ] Walk through the spec's Testing section end to end.
