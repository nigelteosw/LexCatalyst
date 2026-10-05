import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { createMatter, deleteMatter, listMatters, updateMatter } from '../../shared/api/api'
import type { CurrentUser, Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { GENERAL_MATTER_ID } from './MatterPage'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { getErrorMessage } from '../../shared/lib/errors'

type Draft = {
  id?: string
  title: string
  caseNumber: string
  clientName: string
  status: Matter['status']
}

const emptyDraft: Draft = { title: '', caseNumber: '', clientName: '', status: 'active' }

const inputClass = 'mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm'

export function MattersPanel({
  currentUser,
  onMatterChange,
}: {
  currentUser: CurrentUser | null
  onMatterChange: (matterId: string | null) => void
}) {
  const canManage = currentUser?.isAdmin === true || currentUser?.firmRole === 'partner'
  const canCreate = canManage || currentUser?.firmRole === 'senior_associate'
  const queryClient = useQueryClient()
  const { startNewChat, selectMatter } = useWorkspaceNavigation()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Matter | null>(null)

  const mattersQuery = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters() })
  const matters = mattersQuery.data ?? []

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['matters'] })
    queryClient.invalidateQueries({ queryKey: ['threads'] })
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
  }

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? updateMatter(d.id, {
            title: d.title,
            caseNumber: d.caseNumber,
            clientName: d.clientName || null,
            status: d.status,
          })
        : createMatter({
            title: d.title,
            caseNumber: d.caseNumber,
            clientName: d.clientName || undefined,
          }),
    onSuccess: () => {
      refresh()
      setDraft(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (m: Matter) => deleteMatter(m.id),
    onSuccess: () => {
      // Its chats now live under General, so never leave the deleted matter selected.
      onMatterChange(null)
      refresh()
      setPendingDelete(null)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (draft) saveMutation.mutate(draft)
  }

  return (
    <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Matters</h1>
        {canCreate && (
          <Button
            variant="primary"
            onClick={() => {
              saveMutation.reset()
              setDraft(emptyDraft)
            }}
          >
            <Plus size={14} /> New matter
          </Button>
        )}
      </div>

      {mattersQuery.error && <ErrorBanner message={getErrorMessage(mattersQuery.error)} />}

      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-2 pr-3">Title</th>
            <th className="py-2 pr-3">Case no.</th>
            <th className="py-2 pr-3">Client</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-100 bg-neutral-50/60">
            <td className="py-2 pr-3 font-medium text-neutral-900">
              <button type="button" className="text-left hover:underline" onClick={() => selectMatter(GENERAL_MATTER_ID)}>
                General
              </button>
            </td>
            <td className="py-2 pr-3 text-neutral-400">—</td>
            <td className="py-2 pr-3 text-neutral-500" colSpan={2}>
              Documents and LexChats not filed under a matter
            </td>
            <td className="py-2 text-right">
              <Button
                aria-label="New LexChat in General"
                title="New LexChat"
                size="icon"
                variant="ghost"
                onClick={() => {
                  onMatterChange(null)
                  startNewChat()
                }}
              >
                <MessageSquare size={14} />
              </Button>
            </td>
          </tr>
          {matters.map((m) => (
            <tr key={m.id} className="border-b border-neutral-100">
              <td className="py-2 pr-3 font-medium text-neutral-900">
                <button type="button" className="text-left hover:underline" onClick={() => selectMatter(m.id)}>
                  {m.title}
                </button>
              </td>
              <td className="py-2 pr-3 text-neutral-600">{m.caseNumber}</td>
              <td className="py-2 pr-3 text-neutral-600">{m.clientName ?? '—'}</td>
              <td className="py-2 pr-3 capitalize text-neutral-600">{m.status}</td>
              <td className="py-2 text-right">
                <div className="inline-flex gap-1">
                  <Button
                    aria-label={`New LexChat in ${m.title}`}
                    title="New LexChat in matter"
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      onMatterChange(m.id)
                      startNewChat()
                    }}
                  >
                    <MessageSquare size={14} />
                  </Button>
                  {canManage && (
                    <>
                      <Button
                        aria-label={`Edit ${m.title}`}
                        title="Edit"
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          saveMutation.reset()
                          setDraft({
                            id: m.id,
                            title: m.title,
                            caseNumber: m.caseNumber,
                            clientName: m.clientName ?? '',
                            status: m.status,
                          })
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        aria-label={`Delete ${m.title}`}
                        title="Delete"
                        size="icon"
                        variant="danger"
                        onClick={() => {
                          deleteMutation.reset()
                          setPendingDelete(m)
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {draft && (
        <Dialog title={draft.id ? 'Edit matter' : 'New matter'} onClose={() => setDraft(null)}>
          <form onSubmit={submit} className="space-y-3">
            {saveMutation.error && <ErrorBanner message={getErrorMessage(saveMutation.error)} />}
            <label className="block text-sm">
              Title
              <input
                required
                maxLength={200}
                className={inputClass}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Case number
              <input
                required
                maxLength={120}
                className={inputClass}
                value={draft.caseNumber}
                onChange={(e) => setDraft({ ...draft, caseNumber: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Client name
              <input
                maxLength={255}
                className={inputClass}
                value={draft.clientName}
                onChange={(e) => setDraft({ ...draft, clientName: e.target.value })}
              />
            </label>
            {draft.id && (
              <label className="block text-sm">
                Status
                <select
                  className={inputClass}
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as Matter['status'] })}
                >
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
                Save
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {pendingDelete && (
        <Dialog title="Delete matter permanently?" onClose={() => setPendingDelete(null)}>
          <div className="space-y-3 text-sm">
            {deleteMutation.error && <ErrorBanner message={getErrorMessage(deleteMutation.error)} />}
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              <strong>{pendingDelete.title}</strong> ({pendingDelete.caseNumber}) will be deleted. This cannot
              be undone. Its LexChats, documents and wiki pages move to General. Matter-only Knowledge Bank
              entries become private to their authors. Matter members lose access.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-red-700 hover:bg-red-800"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(pendingDelete)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete matter'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
