import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createMatter } from '../../../shared/api/api'
import type { Matter } from '../../../shared/types/workspace'
import { Dialog } from '../../../shared/ui/Dialog'

type MatterFormDialogProps = {
  onClose: () => void
  onCreated: (matter: Matter) => void
}

export function MatterFormDialog({ onClose, onCreated }: MatterFormDialogProps) {
  const [title, setTitle] = useState('')
  const [caseNumber, setCaseNumber] = useState('')
  const [clientName, setClientName] = useState('')
  const mutation = useMutation({
    mutationFn: () => createMatter({ title, caseNumber, clientName }),
    onSuccess: onCreated,
  })

  return (
    <Dialog title="Create matter" onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Matter title"
          value={title}
        />
        <input
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
          onChange={(event) => setCaseNumber(event.target.value)}
          placeholder="Case or matter number"
          value={caseNumber}
        />
        <input
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
          onChange={(event) => setClientName(event.target.value)}
          placeholder="Client name"
          value={clientName}
        />
        <button
          className="w-full rounded-lg bg-[#0f0f0f] px-3 py-2.5 text-xs font-medium text-white disabled:bg-[#aaa9a3]"
          disabled={!title.trim() || !caseNumber.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          {mutation.isPending ? 'Creating...' : 'Create matter'}
        </button>
      </div>
    </Dialog>
  )
}
