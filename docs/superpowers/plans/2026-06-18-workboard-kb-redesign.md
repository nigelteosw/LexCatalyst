# Workboard & Knowledge Bank Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rounded-card / pill-badge aesthetic in Workboard and Knowledge Bank with an editorial row-list style (ruled rows, left-accent priority, plain-text metadata) that reads as premium legal software rather than generic SaaS.

**Architecture:** Pure JSX/Tailwind class changes across two files — no new components, no new packages, no logic changes. ActionCard and EntryCard are replaced in-place with row-list variants. BoardSkeleton is updated to match.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Bun

## Global Constraints

- Use `bun` not `npm` for all commands
- No new packages — pure Tailwind/JSX changes
- No changes to component logic, API calls, mutations, or query hooks
- No changes to dialogs: `ActionDetailDialog`, `CreateActionDialog`, `EntryFormDialog`, `MatterFormDialog`
- No changes to `KnowledgeBankReader`, `EntryContextPanel`, `ScopeAccessEditor`, `AuditLogView`
- No changes to `PanelHeader`, `WellbeingPanel`, or any other panel
- All Tailwind class values must match this plan exactly — no improvisation

---

### Task 1: Workboard row-list redesign

**Files:**
- Modify: `frontend/src/features/actions/ActionsPanel.tsx`

**Interfaces:**
- Consumes: existing `ActionItem` type, `statusColumns` config, `priorityColors` config (last one becomes unused — that's fine, leave it in config)
- Produces: no interface changes — purely visual

This task rewrites the board area, column structure, ActionCard, and BoardSkeleton in `ActionsPanel.tsx`. No other files change.

- [ ] **Step 1: Update lucide-react import — remove unused icons**

Open `frontend/src/features/actions/ActionsPanel.tsx`. Find:

```tsx
import { CheckSquare, ChevronRight, ClipboardList, Plus, Tag, Trash2 } from 'lucide-react'
```

Replace with:

```tsx
import { CheckSquare, Plus, Tag, Trash2 } from 'lucide-react'
```

`ChevronRight` and `ClipboardList` were only used in the old `ActionCard` — both are gone in the new row-list design.

- [ ] **Step 2: Update board area container**

Find:

```tsx
<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
```

Replace with:

```tsx
<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden sm:p-6">
```

- [ ] **Step 3: Update column wrapper and header**

Find the column wrapper + header block (inside `statusColumns.map`):

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

Replace with:

```tsx
<div key={col.id} className="flex w-full shrink-0 flex-col sm:w-64 sm:min-h-0">
  <div className="mb-3 flex items-center gap-2 border-t-2 border-[#0f0f0f] pt-3">
    <h3 className="text-xs font-semibold text-[#0f0f0f]">{col.label}</h3>
    <span className="text-[10px] text-[#9a9a94]">
      {grouped[col.id].length}
    </span>
  </div>
  <div className="flex flex-1 flex-col sm:min-h-0 sm:overflow-y-auto">
```

- [ ] **Step 4: Update empty column state**

Find:

```tsx
<div className="rounded-[12px] border border-dashed border-black/10 px-3 py-5 text-center text-[11px] text-[#aaa9a3]">
  No {col.label.toLowerCase()} tickets
</div>
```

Replace with:

```tsx
<div className="py-6 text-center text-xs text-[#aaa9a3]">
  No {col.label.toLowerCase()} tickets
</div>
```

- [ ] **Step 5: Replace ActionCard with row-list version**

Find and replace the entire `ActionCard` function (from `function ActionCard(` through its closing `}`):

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
        : 'border-l-black/10'

  const assigneeLabel = item.assignee
    ? (item.assignee.fullName ?? item.assignee.email)
    : 'Unassigned'

  const dueDateLabel = item.dueDate
    ? `Due ${new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null

  const meta = [assigneeLabel, dueDateLabel].filter(Boolean).join(' · ')

  return (
    <article className={`group relative border-b border-black/6 border-l-2 ${priorityBorderColor}`}>
      <button
        className="w-full py-3.5 pl-4 pr-10 text-left transition-colors hover:bg-[#f7f6f3]"
        onClick={onClick}
        type="button"
      >
        <p className="line-clamp-2 text-sm font-medium text-[#0f0f0f]">{item.title}</p>
        {item.activeHandoffId && (
          <p className="mt-0.5 text-[10px] text-[#d97706]">
            {item.status === 'in_progress' ? 'Returned for rework' : 'Handoff ready'}
          </p>
        )}
        {meta && (
          <p className="mt-1 text-[11px] text-[#6f6f69]">{meta}</p>
        )}
        {item.tags.length > 0 && (
          <p className="mt-0.5 text-[10px] text-[#9a9a94]">{item.tags.join(', ')}</p>
        )}
      </button>
      <button
        aria-label={`Delete ${item.title}`}
        className="absolute right-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-[#aaa9a3] opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
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

- [ ] **Step 6: Replace BoardSkeleton with row-list version**

Find and replace the entire `BoardSkeleton` function:

```tsx
function BoardSkeleton() {
  return (
    <>
      {statusColumns.map((col) => (
        <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-64">
          <div className="mb-3 flex items-center gap-2 border-t-2 border-[#eeecea] pt-3">
            <div className="h-3 w-16 rounded bg-[#eeecea]" />
            <div className="h-3 w-4 rounded bg-[#f4f3ef]" />
          </div>
          <div className="flex flex-1 flex-col">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse border-b border-black/6 border-l-2 border-l-[#eeecea] py-3.5 pl-4"
              >
                <div className="h-3 w-3/4 rounded bg-[#eeecea]" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-[#f4f3ef]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 7: Type-check**

```bash
cd /Users/nigel/Projects/LexCatalyst/LexCatalyst/frontend && bun run tsc --noEmit
```

Expected: no errors. If you see "ChevronRight is not defined" or "ClipboardList is not defined", you missed Step 1 — go back and fix the import.

- [ ] **Step 8: Start dev server and visually verify**

```bash
cd /Users/nigel/Projects/LexCatalyst/LexCatalyst/frontend && bun run dev
```

Open the app and navigate to Workboard. Confirm:
- Each column has a bold `border-t-2 border-[#0f0f0f]` top line with column label and plain count
- Tickets appear as rows separated by thin `border-b` lines, no box borders
- Left edge of each row shows a 2px priority color accent (red for High, amber for Medium, faint for Low)
- Assignee and due date show as plain text "Sarah M. · Due Jun 30" — no pill badges
- Tags show as comma-separated small grey text below metadata
- Delete button is invisible until you hover the row, then appears at right edge
- Empty columns show plain centred text "No pending tickets" — no dashed box
- Board has `p-5 sm:p-6` breathing room
- Skeleton on first load also uses row style

- [ ] **Step 9: Commit**

```bash
cd /Users/nigel/Projects/LexCatalyst/LexCatalyst && git add frontend/src/features/actions/ActionsPanel.tsx && git commit -m "polish: Workboard row-list redesign — editorial kanban style"
```

---

### Task 2: Knowledge Bank entry row-list

**Files:**
- Modify: `frontend/src/features/knowledge-bank/KnowledgeBankPanel.tsx`

**Interfaces:**
- Consumes: existing `KnowledgeBankEntry` type, `scopeLabels`, `typeTone` (still used), `scopeTone` and `piiTone` (still used elsewhere in the file — do not remove)
- Produces: no interface changes

This task updates the main content area padding, switches the entry grid from a card grid to a divided row list, and replaces `EntryCard` with a row-list version. All other subcomponents in the file (`KnowledgeBankReader`, `EntryContextPanel`, etc.) are untouched.

- [ ] **Step 1: Update main content area padding**

Open `frontend/src/features/knowledge-bank/KnowledgeBankPanel.tsx`. Find:

```tsx
<main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-5">
```

Replace with:

```tsx
<main className="min-w-0 flex-1 overflow-y-auto p-5 lg:p-6">
```

- [ ] **Step 2: Update entry list wrapper — grid to divided rows**

Find:

```tsx
<div className="grid gap-3 xl:grid-cols-2">
  {filteredEntries.map((entry) => (
    <EntryCard
```

Replace with:

```tsx
<div className="divide-y divide-black/6">
  {filteredEntries.map((entry) => (
    <EntryCard
```

(Only the wrapper `<div>` class changes. The `EntryCard` map itself is unchanged.)

- [ ] **Step 3: Replace EntryCard with row-list version**

Find and replace the entire `EntryCard` function (from `function EntryCard(` through its closing `}`):

```tsx
function EntryCard({
  entry,
  isSelected,
  onClick,
}: {
  entry: KnowledgeBankEntry
  isSelected: boolean
  onClick: () => void
}) {
  const scopeMeta = `${scopeLabels[entry.scope]} · ${entry.entryType.replaceAll('_', ' ')}`

  return (
    <button
      className={`flex w-full items-start gap-3 py-4 text-left transition-colors hover:bg-[#f7f6f3] ${
        isSelected ? 'bg-[#f7f6f3]' : ''
      }`}
      onClick={onClick}
      type="button"
    >
      <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[8px] ${typeTone(entry.entryType)}`}>
        <FileText size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-1 text-sm font-semibold text-[#0f0f0f]">{entry.title}</h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-[#777770]">
          {entry.status === 'processing'
            ? 'Processing document…'
            : entry.status === 'failed'
              ? entry.errorMessage ?? 'Processing failed.'
              : entry.bodyMarkdown}
        </p>
        <p className="mt-1 text-[10px] text-[#9a9a94]">
          {scopeMeta}
          {entry.status === 'processing' && ' · processing'}
          {entry.status === 'failed' && ' · failed'}
          {entry.piiStatus !== 'clean' && ` · ${entry.piiStatus.replaceAll('_', ' ')}`}
        </p>
      </div>
      <ChevronRight size={14} className="mt-1 shrink-0 text-[#aaa9a3]" />
    </button>
  )
}
```

Note: `Pill` is no longer used in `EntryCard` but IS still used in `KnowledgeBankReader` and `EntryContextPanel` — do NOT remove the `Pill` import or any helper functions (`scopeTone`, `piiTone`).

- [ ] **Step 4: Type-check**

```bash
cd /Users/nigel/Projects/LexCatalyst/LexCatalyst/frontend && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Start dev server and visually verify**

```bash
cd /Users/nigel/Projects/LexCatalyst/LexCatalyst/frontend && bun run dev
```

Open the app and navigate to Knowledge Bank. Confirm:
- Entry list shows as a single column of rows separated by thin `divide-y divide-black/6` lines — no card boxes
- Each row: coloured icon block (8px rounded) + title + one-line body preview + plain meta text
- Selected entry shows `bg-[#f7f6f3]` row highlight, no box border change
- Meta line reads e.g. "firm-wide · precedent · processing" — no pill badges
- Content area has more breathing room (`p-5 lg:p-6`)
- ChevronRight still appears as a flush-right affordance
- Clicking a row still opens the full reader view (logic unchanged)
- Filter sidebar, search, tab nav, audit log, context panel all unaffected

- [ ] **Step 6: Commit**

```bash
cd /Users/nigel/Projects/LexCatalyst/LexCatalyst && git add frontend/src/features/knowledge-bank/KnowledgeBankPanel.tsx && git commit -m "polish: Knowledge Bank entry row-list — editorial style, no card boxes"
```
