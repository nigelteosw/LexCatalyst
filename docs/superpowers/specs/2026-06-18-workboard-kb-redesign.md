# Workboard & Knowledge Bank Redesign

**Date:** 2026-06-18  
**Status:** Approved

## Goal

Replace the generic rounded-card / pill-badge aesthetic in ActionsPanel (Workboard) and KnowledgeBankPanel with a row-list editorial style that reads as a premium legal tool rather than AI-generated SaaS. Reference palette and tokens from WellbeingPanel; structural pattern is ruled rows (like Bloomberg/Westlaw) not tile cards.

## Global Constraints

- Use `bun` not `npm` for all commands
- No new npm/bun packages
- No changes to component logic, API calls, mutations, or query hooks
- No changes to dialogs: `ActionDetailDialog`, `CreateActionDialog`, `EntryFormDialog`, `MatterFormDialog`
- No changes to `KnowledgeBankReader`, `EntryContextPanel`, `ScopeAccessEditor`, `AuditLogView`
- No changes to `WellbeingPanel`, `MemoriesPanel`, `ChatPanel`, `HomePanel`, `Sidebar`
- All Tailwind class changes use exact values from this spec — no improvisation

---

## Part 1: Workboard (ActionsPanel)

File: `frontend/src/features/actions/ActionsPanel.tsx`

### 1.1 Board area padding

Current outer scroll container:
```tsx
<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
```

Change to:
```tsx
<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden sm:p-6">
```

Changes: `gap-4` → `gap-5`, `p-4` → `p-5 sm:p-6`

### 1.2 Column container and header

Current column wrapper + header:
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
  <div className="mb-3 border-t-2 border-[#0f0f0f] pt-3 flex items-center gap-2">
    <h3 className="text-xs font-semibold text-[#0f0f0f]">{col.label}</h3>
    <span className="text-[10px] text-[#9a9a94]">
      {grouped[col.id].length}
    </span>
  </div>
  <div className="flex flex-1 flex-col sm:min-h-0 sm:overflow-y-auto">
```

Changes: `sm:w-72` → `sm:w-64`, column header gets `border-t-2 border-[#0f0f0f] pt-3`, label color `text-[#5a5a56]` → `text-[#0f0f0f]`, count badge loses background pill (just plain text), inner div loses `gap-2 sm:pr-1`.

### 1.3 Empty column state

Current:
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

### 1.4 ActionCard — row list style

Replace the entire `ActionCard` function with:

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

Key changes vs current:
- No `rounded-[12px] border border-black/10 bg-white` box — rows use `border-b border-black/6` only
- Priority left accent via absolutely-positioned `div` with color mapped from priority
- Title: `text-xs` → `text-sm`, font stays `font-medium text-[#0f0f0f]`
- Assignee + due date: plain `text-[11px] text-[#6f6f69]` joined with `·`
- Tags: comma-separated `text-[10px] text-[#9a9a94]` — no pills
- Delete button: `opacity-0 group-hover:opacity-100` (hidden at rest)
- Remove `ChevronRight` icon from card (row style doesn't need it)
- Remove `ClipboardList` icon from handoff badge — plain text instead
- Remove `priorityColors` badge — replaced by left accent

Note: `ChevronRight` import may become unused in ActionsPanel — check and remove if so.

### 1.5 BoardSkeleton — update to match row style

Replace skeleton card shape:
```tsx
function BoardSkeleton() {
  return (
    <>
      {statusColumns.map((col) => (
        <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-64">
          <div className="mb-3 border-t-2 border-[#eeecea] pt-3 flex items-center gap-2">
            <div className="h-3 w-16 rounded bg-[#eeecea]" />
            <div className="h-3 w-4 rounded bg-[#f4f3ef]" />
          </div>
          <div className="flex flex-1 flex-col">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse border-b border-black/6 py-3.5 pl-4"
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

---

## Part 2: Knowledge Bank (KnowledgeBankPanel)

File: `frontend/src/features/knowledge-bank/KnowledgeBankPanel.tsx`

### 2.1 Main content area padding

Current:
```tsx
<main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-5">
```

Change to:
```tsx
<main className="min-w-0 flex-1 overflow-y-auto p-5 lg:p-6">
```

### 2.2 Entry grid — row list style

Current entry list wrapper:
```tsx
<div className="grid gap-3 xl:grid-cols-2">
  {filteredEntries.map((entry) => (
    <EntryCard ... />
  ))}
</div>
```

Replace with:
```tsx
<div className="divide-y divide-black/6">
  {filteredEntries.map((entry) => (
    <EntryCard ... />
  ))}
</div>
```

Changes: `grid gap-3 xl:grid-cols-2` → `divide-y divide-black/6` (entries stack as rows, single column always)

### 2.3 EntryCard — row list style

Replace the entire `EntryCard` function with:

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
        <h3 className="text-sm font-semibold text-[#0f0f0f] line-clamp-1">{entry.title}</h3>
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

Key changes vs current:
- No `rounded-[14px] border p-4` box — row with `py-4` only
- Icon: `rounded-[9px]` → `rounded-[8px]`, size 16 → 15
- Title: stays `text-sm font-semibold text-[#0f0f0f]`, `line-clamp-2` → `line-clamp-1`
- Body preview: `line-clamp-2` → `line-clamp-1` (less is more)
- Scope/type/status: single `text-[10px] text-[#9a9a94]` line — "firm-wide · precedent" — no `<Pill>` components
- Selected state: `bg-[#f7f6f3]` instead of border change
- ChevronRight stays but moves to flex sibling (outside icon+text group)
- Remove all `<Pill>` usage in this component — `Pill` import may become unused; check and remove if so

---

## Out of Scope

- No changes to `KnowledgeFilters`, `EntryFormDialog`, `MatterFormDialog`, `EntryContextPanel`, `ScopeAccessEditor`, `AuditLogView`, `KnowledgeBankReader`
- No changes to `ActionDetailDialog`, `CreateActionDialog`
- No changes to `PanelHeader`, `WellbeingPanel`, other panels
- No new components, no new files
- `Pill` component itself is not deleted — only its usage inside `EntryCard` is removed; it may be used elsewhere in KB
