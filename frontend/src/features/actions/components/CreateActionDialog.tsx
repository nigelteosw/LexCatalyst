import { useState } from 'react'
import { Tag, Users } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { createActionItem } from '../../../shared/api/api'
import type { ActionItem, ActionPriority, FirmUser, Matter } from '../../../shared/types/workspace'
import { userLabel } from '../config'
import { Button } from '../../../shared/ui/Button'
import { Dialog } from '../../../shared/ui/Dialog'

type CreateActionDialogProps = {
  matters: Matter[]
  users: FirmUser[]
  selectedMatterId: string | null
  onClose: () => void
  onCreated: (item: ActionItem) => void
}

export function CreateActionDialog({
  matters,
  users,
  selectedMatterId,
  onClose,
  onCreated,
}: CreateActionDialogProps) {
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
    <Dialog className="max-w-lg" onClose={onClose} title="New ticket">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim() && !createMutation.isPending) createMutation.mutate()
        }}
      >
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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
            <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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
          <Button
            className="w-full"
            disabled={!title.trim() || createMutation.isPending}
            type="submit"
            variant="primary"
          >
            {createMutation.isPending ? 'Creating...' : 'Create ticket'}
          </Button>
      </form>
    </Dialog>
  )
}
