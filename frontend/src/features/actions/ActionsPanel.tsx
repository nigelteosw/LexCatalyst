import { useMemo, useState } from 'react'
import { CheckSquare, ChevronRight, ClipboardList, Plus, Tag, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteActionItem,
  listActionItems,
  listFirmUsers,
  updateActionItem,
} from '../../shared/api/api'
import type {
  ActionItem,
  ActionStatus,
  CurrentUser,
  Matter,
} from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { isManager, priorityColors, statusColumns, userLabel } from './config'
import { ActionDetailDialog } from './components/ActionDetailDialog'
import { CreateActionDialog } from './components/CreateActionDialog'
import { Button } from '../../shared/ui/Button'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import { useWorkspaceNavigation } from '../../app/routes'

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

      {mutationError && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
          {mutationError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
        {isInitialLoading ? (
          <BoardSkeleton />
        ) : actionsQuery.isError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getErrorMessage(actionsQuery.error)}
          </div>
        ) : (
          statusColumns.map((col) => (
            <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-72 sm:min-h-0">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-[#5a5a56]">{col.label}</h3>
                <span className="rounded-full bg-[#f4f3ef] px-1.5 py-0.5 text-[10px] text-[#9a9a94]">
                  {grouped[col.id].length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 sm:min-h-0 sm:overflow-y-auto sm:pr-1">
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
                  <div className="rounded-[12px] border border-dashed border-black/10 px-3 py-5 text-center text-[11px] text-[#aaa9a3]">
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
        <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-72">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-16 rounded bg-[#eeecea]" />
            <div className="h-4 w-6 rounded-full bg-[#eeecea]" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-[12px] border border-black/10 bg-white p-3.5"
              >
                <div className="h-3 w-3/4 rounded bg-[#eeecea]" />
                <div className="mt-2 h-2.5 w-1/2 rounded bg-[#f4f3ef]" />
                <div className="mt-3 flex gap-1.5">
                  <div className="h-3 w-12 rounded-full bg-[#f4f3ef]" />
                  <div className="h-3 w-16 rounded-full bg-[#f4f3ef]" />
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
  return (
    <article className="group relative rounded-[12px] border border-black/10 bg-white transition-all hover:border-black/20 hover:shadow-sm">
      <button
        className="w-full p-3.5 pr-14 text-left"
        onClick={onClick}
        type="button"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-xs font-medium text-[#0f0f0f]">{item.title}</p>
          <div className="mt-0.5 shrink-0">
            <ChevronRight size={13} className="text-[#aaa9a3]" />
          </div>
        </div>
        {item.activeHandoffId && (
          <div
            className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-medium ${
              item.status === 'in_progress'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-[#fff1d6] text-[#8a5a00]'
            }`}
          >
            <ClipboardList size={10} />
            {item.status === 'in_progress' ? 'Returned for rework' : 'Handoff ready'}
          </div>
        )}
        {item.description && (
          <p className="mt-1 line-clamp-1 text-[11px] text-[#8c8c86]">{item.description}</p>
        )}
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#eeecff] px-2 py-0.5 text-[9.5px] font-medium text-[#4a3db0]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium capitalize ${priorityColors[item.priority]}`}>
            {item.priority}
          </span>
          {item.assignee ? (
            <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[9.5px] font-medium text-[#1a4a8a]">
              {item.assignee.fullName ?? item.assignee.email}
            </span>
          ) : (
            <span className="rounded-full bg-[#f4f3ef] px-2 py-0.5 text-[9.5px] font-medium text-[#8c8c86]">
              Unassigned
            </span>
          )}
          {item.dueDate && (
            <span className="text-[9.5px] text-[#9a9a94]">
              Due {new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </button>
      <button
        aria-label={`Delete ${item.title}`}
        className="absolute right-8 top-3 grid h-5 w-5 place-items-center rounded text-red-600/40 transition-colors hover:bg-red-50 hover:text-red-600"
        onClick={onDelete}
        title="Delete ticket"
        type="button"
      >
        <Trash2 size={12} />
      </button>
    </article>
  )
}
