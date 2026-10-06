import { useMemo, useState } from 'react'
import { ArrowLeft, Plus, Tag, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteActionItem,
  listActionItems,
  listFirmUsers,
  listResourceMetadata,
  updateActionItem,
} from '../../shared/api/api'
import type {
  ActionItem,
  ActionStatus,
  CurrentUser,
  Matter,
  ResourceMetadata,
} from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { isManager, priorityColors, statusColumns, statusColors, userLabel } from './config'
import { ActionList } from './components/ActionList'
import { ActionDetailDialog } from './components/ActionDetailDialog'
import { CreateActionDialog } from './components/CreateActionDialog'
import { FeatureHelp } from '../../shared/ui/FeatureHelp'
import { useWorkspaceNavigation } from '../../app/routes'
import type { HelpContent } from '../../shared/ui/FeatureHelp'
import { ReviewPane } from './components/ReviewPane'

const WORKBOARD_HELP: HelpContent = {
  intro: 'A shared Kanban board for delegating, tracking, and reviewing legal work across your team.',
  steps: [
    {
      emoji: '📋',
      title: 'Create a ticket',
      body: 'Click "+ New action" (senior associates and partners only). Give it a title, set a priority (Low / Medium / High), and assign it to a team member.',
    },
    {
      emoji: '🗂️',
      title: 'Move it through the columns',
      body: 'Drag tickets between To do → Drafting → Internal review → With client / counterparty → Done, or use the status menu inside a ticket. The board is shared — everyone can see all tickets.',
    },
    {
      emoji: '📎',
      title: 'Submit work for review',
      body: 'Once a ticket reaches Review, the assignee uploads their draft as a PDF. The senior reviewer can then open it, highlight passages, and add redline comments directly in the app.',
    },
    {
      emoji: '✏️',
      title: 'Redline and annotate',
      body: 'Seniors highlight text, choose Highlight, Strikethrough, or Suggestion, and leave a note. The junior sees all comments and resolves them one by one.',
    },
    {
      emoji: '✅',
      title: 'Mark complete',
      body: 'Once all annotations are resolved, the senior marks the review complete and the ticket moves to Done automatically.',
    },
  ],
  roles: [
    {
      label: 'Partner / Senior Associate',
      tier: 'top',
      abilities: [
        'Create and assign tickets to team members',
        'Move any ticket to any status',
        'Open submitted PDFs and add redline annotations',
        'Mark reviews complete or return for rework',
        'Delete any ticket they assigned or are assigned to',
      ],
    },
    {
      label: 'Associate',
      tier: 'base',
      abilities: [
        'See all tickets on the board',
        'Update the status of tickets assigned to them',
        'Upload a PDF when their ticket reaches Review',
        'Resolve redline comments left by the senior',
        'Delete tickets they are the assignee of',
      ],
    },
  ],
  tips: [
    'The board is firm-wide — it\'s designed for transparency so everyone can see what\'s in flight.',
    'Filter by matter using the dropdown in the header to focus on a single case.',
    'Priority colours: red = High, amber = Medium, grey = Low.',
  ],
}

type ActionsPanelProps = {
  matters: Matter[]
  currentUser: CurrentUser | null
}

const ACTIONS_QUERY_KEY = ['actions'] as const

export function ActionsPanel({ matters, currentUser }: ActionsPanelProps) {
  const queryClient = useQueryClient()
  const manager = isManager(currentUser)
  const { current, selectActions, selectHandoffReview } = useWorkspaceNavigation()
  const selectedActionId = current.view === 'actions' ? current.actionId : null

  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [matterFilter, setMatterFilter] = useState<string | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Single keyed query — filters are applied in memory below. This is
  // what makes filter chips feel instant.
  const actionsQuery = useQuery({
    queryKey: ACTIONS_QUERY_KEY,
    queryFn: listActionItems,
    // 30s — the board rarely changes on a sub-second cadence and we'd
    // rather not bombard the API on every panel mount.
    staleTime: 30_000,
  })

  // Cross-resource matter snapshot — only fetched when a matter filter is active.
  const matterMetaQuery = useQuery({
    queryKey: ['resourceMetadata', 'matter', matterFilter],
    queryFn: () => listResourceMetadata({ matterId: matterFilter!, limit: 500 }),
    enabled: !!matterFilter,
    staleTime: 60_000,
  })

  // Firm roster changes infrequently; cache aggressively.
  const usersQuery = useQuery({
    queryKey: ['firmUsers'],
    queryFn: listFirmUsers,
    staleTime: 5 * 60_000,
  })

  const allItems = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data])
  const users = usersQuery.data ?? []
  const selectedItem = allItems.find((item) => item.id === selectedActionId) ?? null

  // Distinct tags from the full dataset (not filtered) so chips don't
  // disappear when their column empties.
  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const item of allItems) {
      if (Array.isArray(item.tags)) {
        item.tags.forEach((t) => tags.add(t))
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b))
  }, [allItems])

  // Client-side filtering. With the bounded page (<= 500) this is O(n)
  // over a few hundred items at most — well under a millisecond.
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (matterFilter && item.matterId !== matterFilter) return false
      if (assigneeFilter && item.assigneeId !== assigneeFilter) return false
      if (tagFilter) {
        const wanted = tagFilter.toLowerCase()
        if (!Array.isArray(item.tags) || !item.tags.some((t) => t.toLowerCase() === wanted)) return false
      }
      return true
    })
  }, [allItems, matterFilter, assigneeFilter, tagFilter])

  const grouped = useMemo(() => {
    const buckets: Record<ActionStatus, ActionItem[]> = {
      pending: [],
      in_progress: [],
      review: [],
      with_client: [],
      done: [],
    }
    for (const item of filteredItems) {
      if (item.status && buckets[item.status]) {
        buckets[item.status].push(item)
      } else {
        // Fallback to pending if status is invalid or missing, to avoid crash
        buckets.pending.push(item)
      }
    }
    return buckets
  }, [filteredItems])

  // Shared optimistic-update helper: write the patch into the cache,
  // return a rollback function for onError.
  function applyOptimistic(id: string, patch: Partial<ActionItem>): ActionItem[] | undefined {
    const previous = queryClient.getQueryData<ActionItem[]>(ACTIONS_QUERY_KEY)
    if (!previous) return undefined
    queryClient.setQueryData<ActionItem[]>(
      ACTIONS_QUERY_KEY,
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
    return previous
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateActionItem>[1] }) =>
      updateActionItem(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ACTIONS_QUERY_KEY })
      // Only carry forward keys actually present in the patch — spreading
      // undefined values into the cached item wipes real fields (e.g.
      // tags), which then crashes renders that call item.tags.map(...).
      const optimistic: Partial<ActionItem> = {}
      if (patch.status !== undefined) optimistic.status = patch.status
      if (patch.priority !== undefined) optimistic.priority = patch.priority
      if (patch.assigneeId !== undefined) optimistic.assigneeId = patch.assigneeId
      if (patch.matterId !== undefined) optimistic.matterId = patch.matterId
      if (patch.dueDate !== undefined) optimistic.dueDate = patch.dueDate
      if (patch.tags !== undefined) optimistic.tags = patch.tags
      if (patch.title !== undefined) optimistic.title = patch.title
      if (patch.description !== undefined) optimistic.description = patch.description
      const previous = applyOptimistic(id, optimistic)
      setMutationError(null)
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(ACTIONS_QUERY_KEY, context.previous)
      setMutationError(getErrorMessage(error))
    },
    onSuccess: (updated) => {
      // Reconcile with the server's canonical version (timestamps, joined
      // assignee/assigner expansions, normalised tags).
      queryClient.setQueryData<ActionItem[]>(ACTIONS_QUERY_KEY, (curr) =>
        curr?.map((item) => (item.id === updated.id ? updated : item)) ?? curr,
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteActionItem,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ACTIONS_QUERY_KEY })
      const previous = queryClient.getQueryData<ActionItem[]>(ACTIONS_QUERY_KEY)
      if (previous) {
        queryClient.setQueryData<ActionItem[]>(
          ACTIONS_QUERY_KEY,
          previous.filter((item) => item.id !== id),
        )
      }
      if (selectedActionId === id) selectActions(null, { replace: true })
      setMutationError(null)
      return { previous }
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(ACTIONS_QUERY_KEY, context.previous)
      setMutationError(getErrorMessage(error))
    },
  })

  const isInitialLoading = actionsQuery.isPending

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

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#fafaf8]">
      <header className="shrink-0 px-4 pt-5 sm:px-5 sm:pt-10 lg:px-12 lg:pt-14">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-4xl tracking-tight text-neutral-950">Workboard</h1>
          <FeatureHelp title="Workboard" content={WORKBOARD_HELP} />
        </div>
        <p className="mt-3 text-body leading-relaxed text-neutral-500">
          Firm-wide workload. Everyone sees the same board.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-5">
          <select
            aria-label="Filter by matter"
            className="h-10 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 sm:max-w-56"
            onChange={(e) => setMatterFilter(e.target.value || null)}
            value={matterFilter ?? ''}
          >
            <option value="">All matters</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.caseNumber} · {m.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by assignee"
            className="h-10 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 sm:max-w-56"
            onChange={(e) => setAssigneeFilter(e.target.value || null)}
            value={assigneeFilter ?? ''}
          >
            <option value="">
              {users.length > 0 ? `Everyone (${users.length})` : 'Everyone'}
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
          {manager && (
            <button type="button" onClick={() => setIsCreating(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#1e3a8a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#172e6e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
              <Plus size={13} />
              New ticket
            </button>
          )}
          <div role="group" aria-label="Workboard view" className="ml-auto inline-flex rounded-lg bg-neutral-100 p-1">
            {(['board', 'list'] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)} className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a] ${viewMode === mode ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}>
                {mode}
              </button>
            ))}
          </div>
        </div>
      </header>

      {availableTags.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-4 lg:px-12">
          <span className="inline-flex items-center gap-1 text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">
            <Tag size={11} /> Tags
          </span>
          <button
            className={`rounded-full px-2.5 py-0.5 text-meta font-medium transition-colors ${
              tagFilter === null
                ? 'bg-[#1e3a8a] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            onClick={() => setTagFilter(null)}
            type="button"
          >
            All
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              className={`rounded-full px-2.5 py-0.5 text-meta font-medium transition-colors ${
                tagFilter === tag
                  ? 'bg-[#1e3a8a] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              onClick={() => setTagFilter(tag === tagFilter ? null : tag)}
              type="button"
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {matterFilter && matterMetaQuery.data && matterMetaQuery.data.length > 0 && (
        <MatterSnapshot rows={matterMetaQuery.data} />
      )}

      {mutationError && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
          {mutationError}
        </div>
      )}

      <div className={`app-scroll-region min-h-0 flex-1 gap-4 overflow-y-auto px-4 pb-20 pt-4 sm:px-5 sm:pb-6 sm:pt-6 lg:px-8 ${viewMode === 'board' ? 'workboard-grid grid content-start' : 'flex flex-col'}`}>
        {isInitialLoading ? (
          <BoardSkeleton />
        ) : actionsQuery.isError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getErrorMessage(actionsQuery.error)}
          </div>
        ) : viewMode === 'list' ? (
          <ActionList items={filteredItems} matters={matters} onSelect={(id) => selectActions(id)} />
        ) : (
          statusColumns.map((col) => (
            <div key={col.id} className="flex min-w-0 w-full flex-col rounded-lg bg-neutral-100/70 p-2.5 sm:h-[min(65dvh,42rem)] sm:min-h-0">
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${statusColors[col.id]}`} />
                <h3 className="text-sm font-medium text-neutral-700">{col.label}</h3>
                <span className="text-xs tabular-nums text-neutral-400">
                  {grouped[col.id].length}
                </span>
              </div>
              <div className="workboard-column-scroll flex flex-1 flex-col gap-2 sm:min-h-0 sm:overflow-y-auto sm:pr-1">
                {grouped[col.id].map((item) => (
                  <ActionCard
                    key={item.id}
                    item={item}
                    onClick={() => selectActions(item.id)}
                    onDelete={() => {
                      if (window.confirm(`Delete "${item.title}"? This cannot be undone.`)) {
                        deleteMutation.mutate(item.id)
                      }
                    }}
                  />
                ))}
                {grouped[col.id].length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">
                    No {col.label.toLowerCase()} tickets
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {isCreating && (
        <CreateActionDialog
          matters={matters}
          users={users}
          selectedMatterId={matterFilter}
          onClose={() => setIsCreating(false)}
          onCreated={(newItem) => {
            setIsCreating(false)
            queryClient.setQueryData<ActionItem[]>(
              ACTIONS_QUERY_KEY,
              (prev) => (prev ? [newItem, ...prev] : [newItem]),
            )
          }}
        />
      )}

      {selectedItem && (
        <ActionDetailDialog
          item={selectedItem}
          currentUser={currentUser}
          matters={matters}
          users={users}
          onClose={() => selectActions()}
          onBack={() => selectActions()}
          onUpdate={(patch) => updateMutation.mutate({ id: selectedItem.id, patch })}
          onDelete={() => {
            if (window.confirm(`Delete "${selectedItem.title}"? This cannot be undone.`)) {
              deleteMutation.mutate(selectedItem.id)
            }
          }}
          onActionStateChange={(patch) => {
            applyOptimistic(selectedItem.id, patch)
          }}
          selectHandoffReview={(id) => selectHandoffReview(id)}
          isDeleting={deleteMutation.isPending}
          isUpdating={updateMutation.isPending}
        />
      )}
    </section>
  )
}

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
                className="animate-pulse rounded-[10px] border border-l-[3px] border-black/8 border-l-[#eeecea] bg-white p-4"
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

function ActionCard({
  item,
  onClick,
  onDelete,
}: {
  item: ActionItem
  onClick: () => void
  onDelete: () => void
}) {
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
      className="group relative rounded-lg border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#1e3a8a]"
    >
      <button
        className="w-full p-3 pr-8 text-left focus-visible:outline-none"
        onClick={onClick}
        type="button"
      >
        <span className={`mb-2 inline-flex rounded-md px-2 py-0.5 text-meta font-medium capitalize ${priorityColors[item.priority]}`}>
          {item.priority} priority
        </span>
        <p className="line-clamp-2 text-sm font-medium leading-5 text-neutral-900">
          {item.title}
        </p>

        {item.activeHandoffId && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 text-meta font-medium text-neutral-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-400" />
            {item.status === 'in_progress' ? 'Returned for rework' : 'Review ready'}
          </div>
        )}

        {item.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">
            {item.description}
          </p>
        )}

        {item.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                title={tag}
                className="max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-meta font-medium text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-micro font-semibold text-neutral-600">
            {assigneeInitials}
          </div>
          <span className="min-w-0 flex-1 truncate text-meta text-[#6f6f69]">
            {assigneeName}
          </span>
          {item.dueDate && (
            <span className="shrink-0 text-meta text-[#76766f]">
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
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded text-[#8a8a84] opacity-100 transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-red-50 hover:text-red-500"
        onClick={onDelete}
        title="Delete ticket"
        type="button"
      >
        <Trash2 size={12} />
      </button>
    </article>
  )
}

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
        <div className="flex flex-1 items-center justify-center text-sm text-[#76766f]">
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
          <p className="text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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

const RESOURCE_LABELS: Record<string, string> = {
  document: 'Docs',
  knowledge_bank_entry: 'KB',
  wiki_page: 'Wiki',
  review_handoff: 'Handoffs',
  action_item: 'Tickets',
}

function MatterSnapshot({ rows }: { rows: ResourceMetadata[] }) {
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.resourceType] = (acc[r.resourceType] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex items-center gap-3 border-b border-black/10 bg-[#fafaf8] px-5 py-1.5">
      <span className="text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">
        Matter
      </span>
      {Object.entries(counts).map(([type, count]) => (
        <span key={type} className="text-meta text-[#5a5a56]">
          <span className="font-medium">{count}</span>{' '}
          <span className="text-[#76766f]">{RESOURCE_LABELS[type] ?? type}</span>
        </span>
      ))}
    </div>
  )
}
