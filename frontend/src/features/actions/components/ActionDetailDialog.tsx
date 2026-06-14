import { useState } from 'react'
import { Check, ClipboardList, Pencil, Tag, Trash2, X } from 'lucide-react'
import type {
  ActionItem,
  ActionPriority,
  ActionStatus,
  CurrentUser,
  FirmUser,
  Matter,
} from '../../../shared/types/workspace'
import { isManager, priorityColors, statusColumns, userLabel } from '../config'
import { ReviewHandoffPane } from './ReviewHandoffPane'

type ActionPatch = {
  title?: string
  description?: string | null
  assigneeId?: string | null
  matterId?: string | null
  status?: ActionStatus
  priority?: ActionPriority
  dueDate?: string | null
  tags?: string[]
}

type ActionDetailDialogProps = {
  item: ActionItem
  currentUser: CurrentUser | null
  matters: Matter[]
  users: FirmUser[]
  onClose: () => void
  onUpdate: (patch: ActionPatch) => void
  onDelete: () => void
  onActionStateChange: (patch: Partial<ActionItem>) => void
  isDeleting: boolean
  isUpdating: boolean
}

export function ActionDetailDialog({
  item,
  currentUser,
  matters,
  users,
  onClose,
  onUpdate,
  onDelete,
  onActionStateChange,
  isDeleting,
  isUpdating,
}: ActionDetailDialogProps) {
  const manager = isManager(currentUser)
  const isAssignee = item.assigneeId === currentUser?.id
  const canMove = manager || isAssignee
  const [tagDraft, setTagDraft] = useState('')
  const [tab, setTab] = useState<'details' | 'handoff'>(
    item.activeHandoffId ? 'handoff' : 'details',
  )

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(item.description ?? '')

  const [prevItem, setPrevItem] = useState(item)
  if (item.id !== prevItem.id || item.title !== prevItem.title || item.description !== prevItem.description) {
    setPrevItem(item)
    setTitleDraft(item.title)
    setEditingTitle(false)
    setDescriptionDraft(item.description ?? '')
    setEditingDescription(false)
  }

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
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[14px] border border-black/10 bg-[#fafaf8] shadow-2xl">
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
          <div className="flex items-center gap-1">
            <button
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={isDeleting}
              onClick={onDelete}
              title="Delete ticket"
              type="button"
            >
              <Trash2 size={15} />
            </button>
            <button
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#8c8c86] hover:bg-[#eeecea]"
              onClick={onClose}
              type="button"
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="flex items-center gap-1 border-b border-black/10 bg-white px-3 py-1.5">
          <TabButton active={tab === 'details'} onClick={() => setTab('details')}>
            Details
          </TabButton>
          <TabButton active={tab === 'handoff'} onClick={() => setTab('handoff')}>
            <ClipboardList size={11} />
            Review handoff
            {item.activeHandoffId && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#f0a000]" />
            )}
          </TabButton>
        </div>
        {tab === 'handoff' && (
          <div className="p-5">
            <ReviewHandoffPane
              action={item}
              currentUser={currentUser}
              onActionStateChange={onActionStateChange}
            />
          </div>
        )}
        {tab === 'details' && (
        <div className="space-y-4 p-5">
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

          <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
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
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-[#0f0f0f] text-white'
          : 'text-[#5a5a56] hover:bg-[#f4f3ef]'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}
