import { useState } from 'react'
import { CheckSquare, ChevronRight, Plus, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createActionItem, deleteActionItem, listActionItems, updateActionItem } from '../lib/api'
import type { ActionItem, ActionPriority, ActionStatus, CurrentUser, Matter } from '../types/workspace'

type ActionsPanelProps = {
  matters: Matter[]
  currentUser: CurrentUser | null
}

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

function canCreate(user: CurrentUser | null) {
  return user?.isAdmin || user?.firmRole === 'partner' || user?.firmRole === 'senior_associate'
}

export function ActionsPanel({ matters, currentUser }: ActionsPanelProps) {
  const queryClient = useQueryClient()
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ActionItem | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const actionsQuery = useQuery({
    queryKey: ['actions', selectedMatterId],
    queryFn: () =>
      listActionItems({
        matterId: selectedMatterId ?? undefined,
      }),
  })

  const items = actionsQuery.data ?? []
  const isCreator = canCreate(currentUser)

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ActionStatus }) =>
      updateActionItem(id, { status }),
    onSuccess: (updated) => {
      setMutationError(null)
      setSelectedItem((current) => current?.id === updated.id ? updated : current)
      queryClient.invalidateQueries({ queryKey: ['actions'] })
    },
    onError: (error) => setMutationError(getErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteActionItem,
    onSuccess: () => {
      setSelectedItem(null)
      setMutationError(null)
      queryClient.invalidateQueries({ queryKey: ['actions'] })
    },
    onError: (error) => setMutationError(getErrorMessage(error)),
  })

  const grouped = statusColumns.reduce<Record<ActionStatus, ActionItem[]>>(
    (acc, col) => {
      acc[col.id] = items.filter((item) => item.status === col.id)
      return acc
    },
    { pending: [], in_progress: [], review: [], done: [] },
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#fafaf8]">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b border-black/10 bg-white px-5 py-2">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0f0f0f] text-white">
            <CheckSquare size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#0f0f0f]">Actions</h2>
            <p className="text-[10px] text-[#8c8c86]">Task and progress tracking</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            className="h-8 max-w-56 rounded-lg border border-black/10 bg-[#f4f3ef] px-2.5 text-xs text-[#5a5a56] outline-none focus:border-black/25"
            onChange={(e) => setSelectedMatterId(e.target.value || null)}
            value={selectedMatterId ?? ''}
          >
            <option value="">All matters</option>
            {matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.caseNumber} · {m.title}
              </option>
            ))}
          </select>
          {isCreator && (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-3 text-xs font-medium text-white transition-colors hover:bg-[#333]"
              onClick={() => setIsCreating(true)}
              type="button"
            >
              <Plus size={13} />
              New action
            </button>
          )}
        </div>
      </header>

      {mutationError && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
          {mutationError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden">
        {actionsQuery.isLoading ? (
          <div className="text-sm text-[#8c8c86]">Loading actions...</div>
        ) : actionsQuery.isError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {getErrorMessage(actionsQuery.error)}
          </div>
        ) : (
          statusColumns.map((col) => (
            <div key={col.id} className="flex w-full shrink-0 flex-col sm:w-64">
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
                    No {col.label.toLowerCase()} actions
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
          selectedMatterId={selectedMatterId}
          onClose={() => setIsCreating(false)}
          onCreated={() => {
            setIsCreating(false)
            queryClient.invalidateQueries({ queryKey: ['actions'] })
          }}
        />
      )}

      {selectedItem && (
        <ActionDetailDialog
          item={selectedItem}
          currentUser={currentUser}
          onClose={() => setSelectedItem(null)}
          onStatusChange={(status) => {
            updateMutation.mutate({ id: selectedItem.id, status })
          }}
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
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium capitalize ${priorityColors[item.priority]}`}>
          {item.priority}
        </span>
        {item.assignee && (
          <span className="rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[9.5px] font-medium text-[#1a4a8a]">
            {item.assignee.fullName ?? item.assignee.email}
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
  onClose,
  onStatusChange,
  onDelete,
  isDeleting,
  isUpdating,
}: {
  item: ActionItem
  currentUser: CurrentUser | null
  onClose: () => void
  onStatusChange: (status: ActionStatus) => void
  onDelete: () => void
  isDeleting: boolean
  isUpdating: boolean
}) {
  const canDelete =
    currentUser?.isAdmin ||
    item.assignerId === currentUser?.id
  const canUpdate =
    currentUser?.isAdmin ||
    item.assignerId === currentUser?.id ||
    item.assigneeId === currentUser?.id

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] border border-black/10 bg-[#fafaf8] shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-[#0f0f0f]">{item.title}</h3>
          <button
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#8c8c86] hover:bg-[#eeecea]"
            onClick={onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          {item.description && (
            <p className="text-sm leading-6 text-[#5a5a56]">{item.description}</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Assigned to</div>
              <div className="mt-1 text-[#0f0f0f]">
                {item.assignee ? (item.assignee.fullName ?? item.assignee.email) : 'Unassigned'}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Priority</div>
              <div className="mt-1">
                <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium capitalize ${priorityColors[item.priority]}`}>
                  {item.priority}
                </span>
              </div>
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
                  disabled={!canUpdate || isUpdating}
                  onClick={() => onStatusChange(col.id)}
                  type="button"
                >
                  {col.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {canDelete && (
          <footer className="border-t border-black/10 px-5 py-3">
            <button
              className="text-xs text-red-700 hover:underline disabled:opacity-50"
              disabled={isDeleting}
              onClick={onDelete}
              type="button"
            >
              {isDeleting ? 'Deleting...' : 'Delete action'}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function CreateActionDialog({
  matters,
  selectedMatterId,
  onClose,
  onCreated,
}: {
  matters: Matter[]
  selectedMatterId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [matterId, setMatterId] = useState(selectedMatterId ?? '')
  const [priority, setPriority] = useState<ActionPriority>('medium')
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      createActionItem({
        title,
        description: description || null,
        matterId: matterId || null,
        priority,
      }),
    onSuccess: onCreated,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create'),
  })

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[14px] border border-black/10 bg-[#fafaf8] shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-[#0f0f0f]">New action</h3>
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
            placeholder="Action title"
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
            <select
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
              onChange={(e) => setPriority(e.target.value as ActionPriority)}
              value={priority}
            >
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <select
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
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
          </div>
          {error && (
            <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-xs text-[#8a1f1f]">{error}</div>
          )}
          <button
            className="w-full rounded-lg bg-[#0f0f0f] px-3 py-2.5 text-xs font-medium text-white disabled:bg-[#aaa9a3]"
            disabled={!title.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            {createMutation.isPending ? 'Creating...' : 'Create action'}
          </button>
        </div>
      </div>
    </div>
  )
}
