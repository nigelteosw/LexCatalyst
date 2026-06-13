import { useEffect, useMemo, useState } from 'react'
import { Check, CheckSquare, ChevronRight, Pencil, Plus, Tag, Users, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createActionItem,
  deleteActionItem,
  listActionItems,
  listFirmUsers,
  updateActionItem,
} from '../lib/api'
import type {
  ActionItem,
  ActionPriority,
  ActionStatus,
  CurrentUser,
  FirmUser,
  Matter,
} from '../types/workspace'

type ActionsPanelProps = {
  matters: Matter[]
  currentUser: CurrentUser | null
}

const ACTIONS_QUERY_KEY = ['actions'] as const

const statusColumns: Array<{ id: ActionStatus; label: string }> = [
  { id: 'pending', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

const priorityColors: Record<ActionPriority, string> = {
  low: 'bg-[#f4f3ef] text-[#6f6f69]',
  medium: 'bg-[#fef3dc] text-[#8a5a00]',
  high: 'bg-[#fdeeed] text-[#8a1f1f]',
}

function isManager(user: CurrentUser | null) {
  return !!user && (user.isAdmin || user.firmRole === 'partner' || user.firmRole === 'senior_associate')
}

function userLabel(u: FirmUser) {
  return u.fullName?.trim() ? u.fullName : u.email
}

export function ActionsPanel({ matters, currentUser }: ActionsPanelProps) {
  const queryClient = useQueryClient()
  const manager = isManager(currentUser)

  const [matterFilter, setMatterFilter] = useState<string | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ActionItem | null>(null)
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

  const allItems = actionsQuery.data ?? []
  const users = usersQuery.data ?? []

  // Distinct tags from the full dataset (not filtered) so chips don't
  // disappear when their column empties.
  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const item of allItems) item.tags.forEach((t) => tags.add(t))
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
        if (!item.tags.some((t) => t.toLowerCase() === wanted)) return false
      }
      return true
    })
  }, [allItems, matterFilter, assigneeFilter, tagFilter])

  const grouped = useMemo(() => {
    const buckets: Record<ActionStatus, ActionItem[]> = {
      pending: [], in_progress: [], review: [], done: [],
    }
    for (const item of filteredItems) buckets[item.status].push(item)
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
      const previous = applyOptimistic(id, {
        status: patch.status,
        priority: patch.priority,
        assigneeId: patch.assigneeId,
        matterId: patch.matterId,
        tags: patch.tags,
      } as Partial<ActionItem>)
      setSelectedItem((current) =>
        current?.id === id ? { ...current, ...(patch as Partial<ActionItem>) } : current,
      )
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
      setSelectedItem((current) => (current?.id === updated.id ? updated : current))
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
      setSelectedItem(null)
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
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-black/10 bg-white px-5 py-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0f0f0f] text-white">
            <CheckSquare size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#0f0f0f]">Actions board</h2>
            <p className="text-[10px] text-[#8c8c86]">
              Firm-wide workload. Everyone sees the same board.
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-3 text-xs font-medium text-white transition-colors hover:bg-[#333]"
              onClick={() => setIsCreating(true)}
              type="button"
            >
              <Plus size={13} />
              New ticket
            </button>
          )}
        </div>
      </header>

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
            <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-72">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-[#5a5a56]">{col.label}</h3>
                <span className="rounded-full bg-[#f4f3ef] px-1.5 py-0.5 text-[10px] text-[#9a9a94]">
                  {grouped[col.id].length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {grouped[col.id].map((item) => (
                  <ActionCard
                    key={item.id}
                    item={item}
                    onClick={() => setSelectedItem(item)}
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
          onClose={() => setSelectedItem(null)}
          onUpdate={(patch) => updateMutation.mutate({ id: selectedItem.id, patch })}
          onDelete={() => {
            if (window.confirm(`Delete "${selectedItem.title}"? This cannot be undone.`)) {
              deleteMutation.mutate(selectedItem.id)
            }
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
}: {
  item: ActionItem
  onClick: () => void
}) {
  return (
    <button
      className="rounded-[12px] border border-black/10 bg-white p-3.5 text-left transition-all hover:border-black/20 hover:shadow-sm"
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-xs font-medium text-[#0f0f0f]">{item.title}</p>
        <ChevronRight size={13} className="mt-0.5 shrink-0 text-[#aaa9a3]" />
      </div>
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
  )
}

function ActionDetailDialog({
  item,
  currentUser,
  matters,
  users,
  onClose,
  onUpdate,
  onDelete,
  isDeleting,
  isUpdating,
}: {
  item: ActionItem
  currentUser: CurrentUser | null
  matters: Matter[]
  users: FirmUser[]
  onClose: () => void
  onUpdate: (patch: Parameters<typeof updateActionItem>[1]) => void
  onDelete: () => void
  isDeleting: boolean
  isUpdating: boolean
}) {
  const manager = isManager(currentUser)
  const isAssignee = item.assigneeId === currentUser?.id
  const canMove = manager || isAssignee
  const [tagDraft, setTagDraft] = useState('')

  // Inline title / description editors. Managers click the pencil to
  // enter edit mode; the local draft is reset whenever the underlying
  // item changes so successive opens of different cards don't share
  // state.
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(item.description ?? '')

  useEffect(() => {
    setTitleDraft(item.title)
    setEditingTitle(false)
  }, [item.id, item.title])

  useEffect(() => {
    setDescriptionDraft(item.description ?? '')
    setEditingDescription(false)
  }, [item.id, item.description])

  function addTag() {
    const next = tagDraft.trim()
    if (!next) return
    if (item.tags.some((t) => t.toLowerCase() === next.toLowerCase())) {
      setTagDraft('')
      return
    }
    onUpdate({ tags: [...item.tags, next] })
    setTagDraft('')
  }

  function removeTag(tag: string) {
    onUpdate({ tags: item.tags.filter((t) => t !== tag) })
  }

  function commitTitle() {
    const next = titleDraft.trim()
    if (!next || next === item.title) {
      setEditingTitle(false)
      setTitleDraft(item.title)
      return
    }
    onUpdate({ title: next })
    setEditingTitle(false)
  }

  function commitDescription() {
    const next = descriptionDraft.trim()
    const current = item.description ?? ''
    if (next === current) {
      setEditingDescription(false)
      return
    }
    onUpdate({ description: next || null })
    setEditingDescription(false)
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] border border-black/10 bg-[#fafaf8] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-black/35"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTitle()
                    }
                    if (e.key === 'Escape') {
                      setTitleDraft(item.title)
                      setEditingTitle(false)
                    }
                  }}
                  onBlur={commitTitle}
                  value={titleDraft}
                  maxLength={200}
                />
                <button
                  aria-label="Save title"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#1a6b4a] hover:bg-[#e8f5ee]"
                  disabled={isUpdating}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={commitTitle}
                  type="button"
                >
                  <Check size={13} />
                </button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[#0f0f0f]">{item.title}</h3>
                {manager && (
                  <button
                    aria-label="Edit title"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#9a9a94] opacity-0 transition-opacity hover:bg-[#f4f3ef] hover:text-[#5a5a56] group-hover:opacity-100"
                    onClick={() => setEditingTitle(true)}
                    type="button"
                  >
                    <Pencil size={11} />
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#8c8c86] hover:bg-[#eeecea]"
            onClick={onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          {/* Description (editable for managers) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
                Description
              </span>
              {manager && !editingDescription && (
                <button
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-[#5a5a56] hover:text-[#0f0f0f]"
                  onClick={() => setEditingDescription(true)}
                  type="button"
                >
                  <Pencil size={10} />
                  {item.description ? 'Edit' : 'Add'}
                </button>
              )}
            </div>
            {editingDescription ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  className="w-full resize-y rounded-lg border border-black/15 bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-black/35"
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setDescriptionDraft(item.description ?? '')
                      setEditingDescription(false)
                    }
                  }}
                  placeholder="What needs to happen here?"
                  rows={4}
                  value={descriptionDraft}
                />
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-lg px-3 py-1.5 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
                    onClick={() => {
                      setDescriptionDraft(item.description ?? '')
                      setEditingDescription(false)
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-lg bg-[#0f0f0f] px-3 py-1.5 text-xs font-medium text-white disabled:bg-[#aaa9a3]"
                    disabled={isUpdating}
                    onClick={commitDescription}
                    type="button"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : item.description ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-[#5a5a56]">
                {item.description}
              </p>
            ) : (
              <p className="text-xs text-[#aaa9a3]">No description.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Assigned to</div>
              {manager ? (
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs"
                  value={item.assigneeId ?? ''}
                  onChange={(e) => onUpdate({ assigneeId: e.target.value || null })}
                  disabled={isUpdating}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-1 text-[#0f0f0f]">
                  {item.assignee ? (item.assignee.fullName ?? item.assignee.email) : 'Unassigned'}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Priority</div>
              {manager ? (
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs capitalize"
                  value={item.priority}
                  onChange={(e) => onUpdate({ priority: e.target.value as ActionPriority })}
                  disabled={isUpdating}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              ) : (
                <div className="mt-1">
                  <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium capitalize ${priorityColors[item.priority]}`}>
                    {item.priority}
                  </span>
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Matter</div>
              {manager ? (
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs"
                  value={item.matterId ?? ''}
                  onChange={(e) => onUpdate({ matterId: e.target.value || null })}
                  disabled={isUpdating}
                >
                  <option value="">No matter</option>
                  {matters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.caseNumber} · {m.title}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-1 text-[#0f0f0f]">
                  {item.matterId
                    ? matters.find((m) => m.id === item.matterId)?.title ?? '—'
                    : '—'}
                </div>
              )}
            </div>
            {item.dueDate && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Due date</div>
                <div className="mt-1 text-[#0f0f0f]">
                  {new Date(item.dueDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
                <Tag size={11} /> Tags
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-[#eeecff] px-2 py-0.5 text-[10.5px] font-medium text-[#4a3db0]"
                >
                  {tag}
                  {manager && (
                    <button
                      aria-label={`Remove ${tag}`}
                      className="rounded-full text-[#4a3db0] hover:text-[#2e2585]"
                      onClick={() => removeTag(tag)}
                      type="button"
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {item.tags.length === 0 && (
                <span className="text-[11px] text-[#aaa9a3]">No tags yet</span>
              )}
            </div>
            {manager && (
              <div className="mt-2 flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-black/30"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                  placeholder="Add a tag (e.g. due-diligence)"
                  value={tagDraft}
                />
                <button
                  className="rounded-lg bg-[#0f0f0f] px-3 py-1.5 text-xs text-white disabled:bg-[#aaa9a3]"
                  disabled={!tagDraft.trim() || isUpdating}
                  onClick={addTag}
                  type="button"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Status</div>
            <div className="flex flex-wrap gap-2">
              {statusColumns.map((col) => (
                <button
                  key={col.id}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    item.status === col.id
                      ? 'bg-[#0f0f0f] text-white'
                      : 'bg-[#f4f3ef] text-[#5a5a56] hover:bg-[#eeecea]'
                  }`}
                  disabled={!canMove || isUpdating}
                  onClick={() => onUpdate({ status: col.id })}
                  type="button"
                >
                  {col.label}
                </button>
              ))}
            </div>
            {!canMove && (
              <p className="mt-2 text-[10.5px] text-[#9a9a94]">
                Only the assignee or a senior+ can move this ticket.
              </p>
            )}
          </div>
        </div>
        {manager && (
          <footer className="border-t border-black/10 px-5 py-3">
            <button
              className="text-xs text-red-700 hover:underline disabled:opacity-50"
              disabled={isDeleting}
              onClick={onDelete}
              type="button"
            >
              {isDeleting ? 'Deleting...' : 'Delete ticket'}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

function CreateActionDialog({
  matters,
  users,
  selectedMatterId,
  onClose,
  onCreated,
}: {
  matters: Matter[]
  users: FirmUser[]
  selectedMatterId: string | null
  onClose: () => void
  onCreated: (item: ActionItem) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [matterId, setMatterId] = useState(selectedMatterId ?? '')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<ActionPriority>('medium')
  const [tagsRaw, setTagsRaw] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      createActionItem({
        title,
        description: description || null,
        matterId: matterId || null,
        assigneeId: assigneeId || null,
        priority,
        tags: tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: onCreated,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create'),
  })

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] border border-black/10 bg-[#fafaf8] shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-[#0f0f0f]">New ticket</h3>
          <button
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#8c8c86] hover:bg-[#eeecea]"
            onClick={onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </header>
        <div className="space-y-3 p-5">
          <input
            autoFocus
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ticket title"
            value={title}
          />
          <textarea
            className="w-full resize-y rounded-lg border border-black/10 px-3 py-2 text-xs leading-5 outline-none focus:border-black/30"
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            value={description}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
                <Users size={11} /> Assign to
              </span>
              <select
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
                onChange={(e) => setAssigneeId(e.target.value)}
                value={assigneeId}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
                Priority
              </span>
              <select
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
                onChange={(e) => setPriority(e.target.value as ActionPriority)}
                value={priority}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
              Matter (optional)
            </span>
            <select
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
              onChange={(e) => setMatterId(e.target.value)}
              value={matterId}
            >
              <option value="">No matter</option>
              {matters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.caseNumber} · {m.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
              <Tag size={11} /> Tags (comma separated)
            </span>
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-xs outline-none focus:border-black/30"
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="e.g. due-diligence, urgent, indemnity"
              value={tagsRaw}
            />
          </label>
          {error && (
            <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-xs text-[#8a1f1f]">{error}</div>
          )}
          <button
            className="w-full rounded-lg bg-[#0f0f0f] px-3 py-2.5 text-xs font-medium text-white disabled:bg-[#aaa9a3]"
            disabled={!title.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            {createMutation.isPending ? 'Creating...' : 'Create ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
