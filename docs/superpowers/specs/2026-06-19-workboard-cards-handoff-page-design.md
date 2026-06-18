# Workboard Cards & Handoff Review Page Design

**Date:** 2026-06-19  
**Status:** Approved

## Goal

Two improvements to the Workboard (ActionsPanel):
1. Revert the row-list ActionCard style to Jira-inspired boxes — card containers with a left priority accent, assignee avatar, and cleaner metadata layout.
2. Promote the PDF handoff review from a constrained modal tab to a full-panel dedicated page, accessible via a clean route and back navigation.

## Global Constraints

- Use `bun` not `npm`
- No new npm/bun packages
- No changes to ReviewPane, AnnotationRail, SuggestionEditor internals
- No ticket ID implementation
- All changes must work correctly on mobile (≤639px) and desktop

---

## Part 1: ActionCard — Jira-inspired box style

File: `frontend/src/features/actions/ActionsPanel.tsx`

### Card structure

Replace the row-list `ActionCard` with a card box:

```tsx
function ActionCard({
  item,
  onClick,
  onDelete,
}: {
  item: ActionItem
  onClick: () => void
  onDelete: () => void
}) {
  const priorityBorderColor =
    item.priority === 'high'
      ? 'border-l-[#e05252]'
      : item.priority === 'medium'
        ? 'border-l-[#d97706]'
        : 'border-l-black/15'

  const assigneeInitials = item.assignee
    ? (item.assignee.fullName ?? item.assignee.email)
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?'

  const assigneeName = item.assignee
    ? (item.assignee.fullName ?? item.assignee.email)
    : 'Unassigned'

  return (
    <article
      className={`group relative rounded-[10px] border border-black/8 border-l-[3px] bg-white transition-all hover:border-black/20 hover:shadow-sm ${priorityBorderColor}`}
    >
      <button
        className="w-full p-4 pr-10 text-left"
        onClick={onClick}
        type="button"
      >
        <p className="line-clamp-2 text-sm font-medium leading-5 text-[#0f0f0f]">
          {item.title}
        </p>

        {item.activeHandoffId && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            {item.status === 'in_progress' ? 'Returned for rework' : 'Review ready'}
          </div>
        )}

        {item.description && (
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[#8c8c86]">
            {item.description}
          </p>
        )}

        {item.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-[#eeecff] px-1.5 py-0.5 text-[10px] font-medium text-[#4a3db0]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-[9px] font-semibold text-[#1a4a8a]">
            {assigneeInitials}
          </div>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#6f6f69]">
            {assigneeName}
          </span>
          {item.dueDate && (
            <span className="shrink-0 text-[10px] text-[#9a9a94]">
              {new Date(item.dueDate).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>
      </button>

      <button
        aria-label={`Delete ${item.title}`}
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded text-[#aaa9a3] opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
        onClick={onDelete}
        title="Delete ticket"
        type="button"
      >
        <Trash2 size={12} />
      </button>
    </article>
  )
}
```

### BoardSkeleton — card style

```tsx
function BoardSkeleton() {
  return (
    <>
      {statusColumns.map((col) => (
        <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-72">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-16 rounded bg-[#eeecea]" />
            <div className="h-4 w-6 rounded-full bg-[#eeecea]" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-[10px] border border-black/8 border-l-[3px] border-l-[#eeecea] bg-white p-4"
              >
                <div className="h-3 w-3/4 rounded bg-[#eeecea]" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-[#f4f3ef]" />
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-5 w-5 rounded-full bg-[#f4f3ef]" />
                  <div className="h-2.5 w-20 rounded bg-[#f4f3ef]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
```

### Column header — restore Jira-style

Restore the previous column header styling (bold count badge, `text-[#5a5a56]` label):

```tsx
<div key={col.id} className="flex w-full shrink-0 flex-col sm:w-72 sm:min-h-0">
  <div className="mb-3 flex items-center gap-2">
    <h3 className="text-xs font-semibold text-[#5a5a56]">{col.label}</h3>
    <span className="rounded-full bg-[#f4f3ef] px-1.5 py-0.5 text-[10px] text-[#9a9a94]">
      {grouped[col.id].length}
    </span>
  </div>
  <div className="flex flex-1 flex-col gap-2 sm:min-h-0 sm:overflow-y-auto sm:pr-1">
```

### Board area

Keep existing board area padding and gap (restore from before the row-list change):

```tsx
<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
```

### Empty column state

Restore with dashed border:

```tsx
<div className="rounded-[10px] border border-dashed border-black/10 px-3 py-5 text-center text-[11px] text-[#aaa9a3]">
  No {col.label.toLowerCase()} tickets
</div>
```

### Restore ChevronRight import

The card uses `ChevronRight` — no, actually the new card above does NOT use `ChevronRight` (removed from the design). Do not re-add it.

However: `ClipboardList` was previously imported and removed. Leave it removed.

Import line should be:
```tsx
import { CheckSquare, Plus, Tag, Trash2 } from 'lucide-react'
```

### Handoff review navigation in ActionsPanel

When `current.view === 'handoff_review'`, ActionsPanel renders a full-panel review page instead of the kanban board. Add the following to the return statement (before the existing kanban layout):

```tsx
// At the top of the render, before the main section return:
if (current.view === 'handoff_review') {
  const reviewItem = allItems.find((item) => item.id === current.actionId) ?? null
  return (
    <HandoffReviewPage
      item={reviewItem}
      currentUser={currentUser}
      onBack={() => selectActions()}
      onActionStateChange={(patch) => {
        if (reviewItem) applyOptimistic(reviewItem.id, patch)
      }}
    />
  )
}
```

Add `HandoffReviewPage` as a new function in `ActionsPanel.tsx`:

```tsx
function HandoffReviewPage({
  item,
  currentUser,
  onBack,
  onActionStateChange,
}: {
  item: ActionItem | null
  currentUser: CurrentUser | null
  onBack: () => void
  onActionStateChange: (patch: Partial<ActionItem>) => void
}) {
  if (!item) {
    return (
      <div className="flex h-full flex-col bg-[#fafaf8]">
        <header className="flex shrink-0 items-center gap-3 border-b border-black/10 bg-white px-4 py-3 sm:px-6">
          <button
            aria-label="Back to Workboard"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#5a5a56] hover:bg-[#f4f3ef]"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-[#0f0f0f]">Review handoff</span>
        </header>
        <div className="flex flex-1 items-center justify-center text-sm text-[#9a9a94]">
          Ticket not found.
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#fafaf8]">
      <header className="flex shrink-0 items-center gap-3 border-b border-black/10 bg-white px-4 py-3 sm:px-6">
        <button
          aria-label="Back to Workboard"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#5a5a56] hover:bg-[#f4f3ef]"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            Review handoff
          </p>
          <p className="truncate text-sm font-semibold text-[#0f0f0f]">{item.title}</p>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ReviewPane
          action={item}
          currentUser={currentUser}
          onActionStateChange={onActionStateChange}
        />
      </div>
    </div>
  )
}
```

Add `ArrowLeft` and `ReviewPane` imports to `ActionsPanel.tsx`:
- `import { ArrowLeft, CheckSquare, Plus, Tag, Trash2 } from 'lucide-react'`
- `import { ReviewPane } from './components/ReviewPane'`

Also destructure `selectHandoffReview` from `useWorkspaceNavigation` in ActionsPanel:
```tsx
const { current, selectActions, selectHandoffReview } = useWorkspaceNavigation()
```

---

## Part 2: Routes — add handoff_review view

File: `frontend/src/app/routes.ts`

### New view type

Add to the type definitions:
```ts
type HandoffReviewView = { view: 'handoff_review'; actionId: string }
```

Update `AppView` union:
```ts
export type AppView =
  | HomeView
  | ChatView
  | WikiView
  | DocumentsView
  | MemoriesView
  | WellbeingView
  | KnowledgeBankView
  | ActionsView
  | HandoffReviewView
  | SettingsView
```

### Router — support 3-segment actions path

Change:
```ts
if (segments.length > 2) return { current: { view: 'home' }, isKnownRoute: false }
```

To:
```ts
if (segments.length > 2) {
  // Only allowed: /actions/[id]/review
  // `section` and `id` are already extracted above from segments[0] and segments[1]
  if (section === 'actions' && rawId && segments[2] === 'review') {
    return {
      current: { view: 'handoff_review', actionId: id! },
      isKnownRoute: true,
    }
  }
  return { current: { view: 'home' }, isKnownRoute: false }
}
```

### New navigation helper

Add `selectHandoffReview` to the returned object of `useWorkspaceNavigation`:

```ts
selectHandoffReview: useCallback(
  (actionId: string, options?: NavigationOptions) =>
    go(`/actions/${encodeURIComponent(actionId)}/review`, options),
  [go],
),
```

---

## Part 3: App.tsx — render ActionsPanel for handoff_review view

File: `frontend/src/app/App.tsx`

Change:
```tsx
) : current.view === 'actions' ? (
  <ActionsPanel matters={matters} currentUser={currentUser} />
```

To:
```tsx
) : current.view === 'actions' || current.view === 'handoff_review' ? (
  <ActionsPanel matters={matters} currentUser={currentUser} />
```

Also update `mobileViewTitle` and `BirdiePageContext` helpers if they reference `current.view === 'actions'` to also handle `'handoff_review'`:

In `mobileViewTitle`:
```ts
// Before
actions: 'Workboard',

// After — add:
handoff_review: 'Review',
```

In `BirdiePageContext` builder (around line 741):
```ts
if (current.view === 'handoff_review') return { ...base, actionTitle: current.actionId }
```

---

## Part 4: ActionDetailDialog — remove handoff tab, add review page button

File: `frontend/src/features/actions/components/ActionDetailDialog.tsx`

### Remove the tab system

- Remove `tab` state and `setTab`
- Remove `tabBar` JSX
- Remove the `handoff` tab render path (the `{tab === 'handoff' ? <ReviewPane ... /> : detailsBody}` branches)
- The dialog always shows `detailsBody` now
- Remove `ClipboardList` from lucide imports (no longer used)

### Add a "Review handoff" button in detailsBody

When `item.activeHandoffId` exists, show a prominent button at the bottom of `detailsBody` that navigates to the full review page:

```tsx
{item.activeHandoffId && (
  <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-amber-900">
          {item.status === 'in_progress' ? 'Draft returned for rework' : 'Handoff ready for review'}
        </p>
        <p className="mt-0.5 text-[11px] text-amber-700">
          Open the full review page to annotate and respond.
        </p>
      </div>
      <button
        className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
        onClick={() => {
          onClose()
          selectHandoffReview(item.id)
        }}
        type="button"
      >
        Open review
      </button>
    </div>
  </div>
)}
```

`selectHandoffReview` must be passed into `ActionDetailDialog` as a prop:
```ts
type ActionDetailDialogProps = {
  // ... existing props ...
  selectHandoffReview: (actionId: string) => void
}
```

And called from `ActionsPanel` where `ActionDetailDialog` is rendered:
```tsx
<ActionDetailDialog
  // ... existing props ...
  selectHandoffReview={(id) => selectHandoffReview(id)}
/>
```

### Remove ReviewPane import from ActionDetailDialog

`ReviewPane` is no longer used in the dialog — remove the import.

### Tab state initialization

Remove:
```ts
const [tab, setTab] = useState<'details' | 'handoff'>(
  item.activeHandoffId ? 'handoff' : 'details',
)
```

### Mobile layout

The mobile layout (`isMobile` branch) also showed the handoff tab. Simplify it to always show `detailsBody`:

```tsx
if (isMobile) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[#fafaf8]">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-black/10 bg-[#fafaf8]/95 px-3 py-3 backdrop-blur">
        <button
          aria-label="Back to Workboard"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#5a5a56] hover:bg-[#f4f3ef]"
          onClick={onBack ?? onClose}
          type="button"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1 text-sm font-semibold text-[#0f0f0f]">
          {titleContent}
        </div>
        {deleteBtn}
      </header>
      <div className="flex-1 overflow-y-auto">
        {detailsBody}
      </div>
    </div>
  )
}
```

### Desktop dialog

Remove the tab-conditional rendering — always render `detailsBody`:

```tsx
return (
  <Dialog
    bodyClassName="p-0"
    className="max-w-2xl"
    headerActions={deleteBtn}
    onClose={onClose}
    title={titleContent}
  >
    {detailsBody}
  </Dialog>
)
```

---

## Mobile considerations

- `HandoffReviewPage` takes `h-full flex-col` — on mobile the panel occupies full viewport height since the sidebar collapses
- The sticky header (`shrink-0`) + scrollable `ReviewPane` (`flex-1 min-h-0 overflow-hidden`) pattern works identically on both breakpoints
- Back button navigates to `/actions` (board) — on mobile this closes the review and shows the board
- `ActionDetailDialog`'s mobile view no longer has handoff tab; the amber "Open review" button navigates to `/actions/[id]/review` and closes the dialog first

---

## Out of Scope

- No changes to `ReviewPane`, `AnnotationRail`, `SuggestionEditor`
- No ticket ID implementation
- No changes to `CreateActionDialog`
- No backend changes
