import { useMemo, useState } from 'react'
import { CheckSquare, Plus, Tag, Trash2 } from 'lucide-react'
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
import { isManager, statusColumns, userLabel } from './config'
import { ActionDetailDialog } from './components/ActionDetailDialog'
import { CreateActionDialog } from './components/CreateActionDialog'
import { Button } from '../../shared/ui/Button'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import { useWorkspaceNavigation } from '../../app/routes'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

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
      body: 'Drag tickets between To Do → In Progress → Review → Done, or use the status menu inside a ticket. The board is shared — everyone can see all tickets.',
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
  const { current, selectActions } = useWorkspaceNavigation()
  const selectedActionId = current.view === 'actions' ? current.actionId : null

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

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#fafaf8]">
      <PanelHeader
        actions={
          <>
            <select
              aria-label="Filter by matter"
              className="h-8 max-w-56 rounded-lg border border-black/10 bg-[#f4f3ef] px-2.5 text-xs text-[#5a5a56] outline-none focus:border-black/25"
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
              className="h-8 max-w-44 rounded-lg border border-black/10 bg-[#f4f3ef] px-2.5 text-xs text-[#5a5a56] outline-none focus:border-black/25"
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
              <Button onClick={() => setIsCreating(true)} size="sm" variant="primary">
                <Plus size={13} />
                New ticket
              </Button>
            )}
          </>
        }
        description="Firm-wide workload. Everyone sees the same board."
        helpContent={WORKBOARD_HELP}
        icon={CheckSquare}
        title="Workboard"
      />

      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-black/10 bg-white px-5 py-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            <Tag size={11} /> Tags
          </span>
          <button
            className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-colors ${
              tagFilter === null
                ? 'bg-[#0f0f0f] text-white'
                : 'bg-[#f4f3ef] text-[#5a5a56] hover:bg-[#eeecea]'
            }`}
            onClick={() => setTagFilter(null)}
            type="button"
          >
            All
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-colors ${
                tagFilter === tag
                  ? 'bg-[#0f0f0f] text-white'
                  : 'bg-[#f4f3ef] text-[#5a5a56] hover:bg-[#eeecea]'
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

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden sm:p-6">
        {isInitialLoading ? (
          <BoardSkeleton />
        ) : actionsQuery.isError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getErrorMessage(actionsQuery.error)}
          </div>
        ) : (
          statusColumns.map((col) => (
            <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-64 sm:min-h-0">
              <div className="mb-3 flex items-center gap-2 border-t-2 border-[#0f0f0f] pt-3">
                <h3 className="text-xs font-semibold text-[#0f0f0f]">{col.label}</h3>
                <span className="text-[10px] text-[#9a9a94]">
                  {grouped[col.id].length}
                </span>
              </div>
              <div className="flex flex-1 flex-col sm:min-h-0 sm:overflow-y-auto">
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
                  <div className="py-6 text-center text-xs text-[#aaa9a3]">
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
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
        Matter
      </span>
      {Object.entries(counts).map(([type, count]) => (
        <span key={type} className="text-[10.5px] text-[#5a5a56]">
          <span className="font-medium">{count}</span>{' '}
          <span className="text-[#9a9a94]">{RESOURCE_LABELS[type] ?? type}</span>
        </span>
      ))}
    </div>
  )
}
