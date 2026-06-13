import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createKnowledgeBankEntry } from '../../../shared/api/api'
import type {
  KnowledgeBankEntry,
  KnowledgeBankEntryType,
  KnowledgeBankScope,
  Matter,
} from '../../../shared/types/workspace'
import { Dialog } from '../../../shared/ui/Dialog'
import { entryTypes, scopeDescriptions, scopeLabels } from '../config'

type EntryFormDialogProps = {
  matters: Matter[]
  selectedMatterId: string | null
  error: string | null
  onClose: () => void
  onCreated: (entry: KnowledgeBankEntry) => void
  onError: (message: string | null) => void
}

export function EntryFormDialog({
  matters,
  selectedMatterId,
  error,
  onClose,
  onCreated,
  onError,
}: EntryFormDialogProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [entryType, setEntryType] = useState<KnowledgeBankEntryType>('knowledge_bank')
  const [scope, setScope] = useState<KnowledgeBankScope>(
    selectedMatterId ? 'matter' : 'private',
  )
  const [matterId, setMatterId] = useState(selectedMatterId ?? '')
  const [tags, setTags] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      createKnowledgeBankEntry({
        title,
        bodyMarkdown: body,
        entryType,
        scope,
        matterId: scope === 'matter' ? matterId : null,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    onSuccess: onCreated,
    onError: (caughtError) =>
      onError(caughtError instanceof Error ? caughtError.message : 'Could not create entry'),
  })

  return (
    <Dialog title="New Knowledge Bank entry" onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Entry title"
          value={title}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
            onChange={(event) => setEntryType(event.target.value as KnowledgeBankEntryType)}
            value={entryType}
          >
            {entryTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
            onChange={(event) => setScope(event.target.value as KnowledgeBankScope)}
            value={scope}
          >
            {(Object.keys(scopeLabels) as KnowledgeBankScope[]).map((item) => (
              <option key={item} value={item}>
                {scopeLabels[item]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] leading-5 text-[#777770]">{scopeDescriptions[scope]}</p>
        {scope === 'matter' && (
          <select
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
            onChange={(event) => setMatterId(event.target.value)}
            value={matterId}
          >
            <option value="">Select matter</option>
            {matters.map((matter) => (
              <option key={matter.id} value={matter.id}>
                {matter.caseNumber} · {matter.title}
              </option>
            ))}
          </select>
        )}
        <textarea
          className="min-h-56 w-full resize-y rounded-lg border border-black/10 px-3 py-2 text-xs leading-5 outline-none focus:border-black/30"
          onChange={(event) => setBody(event.target.value)}
          placeholder="Knowledge content in Markdown"
          value={body}
        />
        <input
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-xs outline-none focus:border-black/30"
          onChange={(event) => setTags(event.target.value)}
          placeholder="Tags, comma separated"
          value={tags}
        />
        {error && <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-xs text-[#8a1f1f]">{error}</div>}
        <button
          className="w-full rounded-lg bg-[#0f0f0f] px-3 py-2.5 text-xs font-medium text-white disabled:bg-[#aaa9a3]"
          disabled={!title.trim() || !body.trim() || (scope === 'matter' && !matterId)}
          onClick={() => createMutation.mutate()}
          type="button"
        >
          {createMutation.isPending ? 'Creating...' : 'Create entry'}
        </button>
      </div>
    </Dialog>
  )
}
