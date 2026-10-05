import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createMatter,
  deleteMatter,
  listActionItems,
  listChatThreads,
  listDocuments,
  listMatters,
  updateMatter,
} from '../../shared/api/api'
import type { CurrentUser, Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { GENERAL_MATTER_ID } from '../knowledge-bank/MatterPage'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { getErrorMessage } from '../../shared/lib/errors'
import { formatRelative } from './format'

type Draft = {
  id?: string
  title: string
  caseNumber: string
  clientName: string
  status: Matter['status']
}

const emptyDraft: Draft = { title: '', caseNumber: '', clientName: '', status: 'active' }
const inputClass = 'mt-1 w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-sm'

type Row = {
  key: string
  matter: Matter | null
  documents: number
  openTasks: number
  chats: number
  lastActivity: string | null
}

/** The matter list a lawyer works from: every matter with what is in it and when it last moved. */
export function MattersSection({
  currentUser,
  onMatterChange,
}: {
  currentUser: CurrentUser | null
  onMatterChange: (matterId: string | null) => void
}) {
  const canManage = currentUser?.isAdmin === true || currentUser?.firmRole === 'partner'
  const canCreate = canManage || currentUser?.firmRole === 'senior_associate'
  const queryClient = useQueryClient()
  const { selectMatter, startNewChat } = useWorkspaceNavigation()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Matter | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const mattersQuery = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters() })
  const documents = useQuery({ queryKey: ['documents'], queryFn: listDocuments, staleTime: 30_000 })
  const threads = useQuery({ queryKey: ['threads', 'all'], queryFn: () => listChatThreads(), staleTime: 30_000 })
  const actions = useQuery({ queryKey: ['actions'], queryFn: listActionItems, staleTime: 30_000 })

  const { rows, closedCount } = useMemo(() => {
    const matters = mattersQuery.data ?? []
    const build = (matter: Matter | null): Row => {
      const id = matter?.id ?? null
      const docs = (documents.data ?? []).filter((d) => (d.matterId ?? null) === id)
      const chats = (threads.data ?? []).filter((t) => (t.matterId ?? null) === id)
      const tasks = (actions.data ?? []).filter((a) => (a.matterId ?? null) === id)
      const stamps = [
        ...docs.map((d) => d.updatedAt),
        ...chats.map((c) => c.updatedAt),
        ...tasks.map((a) => a.updatedAt),
        ...(matter ? [matter.updatedAt] : []),
      ].sort()
      return {
        key: id ?? GENERAL_MATTER_ID,
        matter,
        documents: docs.length,
        openTasks: tasks.filter((a) => a.status !== 'done').length,
        chats: chats.length,
        lastActivity: stamps.length ? stamps[stamps.length - 1] : null,
      }
    }
    const open = matters.filter((m) => m.status === 'active')
    const visible = showClosed ? matters : open
    const sorted = visible
      .map(build)
      .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))
    return { rows: [...sorted, build(null)], closedCount: matters.length - open.length }
  }, [mattersQuery.data, documents.data, threads.data, actions.data, showClosed])

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
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <h2 className="flex items-baseline gap-2.5 font-serif text-xl text-neutral-900">
          Matters
          <span className="font-sans text-sm text-neutral-400">{rows.length - 1}</span>
        </h2>
        <div className="flex items-center gap-3">
          {closedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-500">
              <input
                checked={showClosed}
                className="accent-[#1e3a8a]"
                onChange={(e) => setShowClosed(e.target.checked)}
                type="checkbox"
              />
              Show closed ({closedCount})
            </label>
          )}
          {canCreate && (
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              onClick={() => {
                saveMutation.reset()
                setDraft(emptyDraft)
              }}
              type="button"
            >
              <Plus size={14} /> New matter
            </button>
          )}
        </div>
      </div>

      {mattersQuery.error && <ErrorBanner className="mt-3" message={getErrorMessage(mattersQuery.error)} />}

      <div className="divide-y divide-neutral-200/70">
        {rows.map((row) => {
          const { matter } = row
          const stats = [
            `${row.documents} ${row.documents === 1 ? 'document' : 'documents'}`,
            `${row.openTasks} open ${row.openTasks === 1 ? 'task' : 'tasks'}`,
            `${row.chats} ${row.chats === 1 ? 'chat' : 'chats'}`,
          ]
          return (
            <div
              key={row.key}
              className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-1 py-4 transition-colors hover:bg-black/[0.025]"
            >
              <button
                className="min-w-0 text-left"
                onClick={() => selectMatter(row.key)}
                type="button"
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-medium text-neutral-900 group-hover:text-[#1e3a8a]">
                    {matter ? matter.title : 'General'}
                  </span>
                  {matter && matter.status !== 'active' && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs capitalize text-neutral-600">
                      {matter.status}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-sm text-neutral-500">
                  {matter
                    ? [matter.caseNumber, matter.clientName].filter(Boolean).join(' · ')
                    : 'Not filed under a matter'}
                </span>
                <span className="mt-1 block text-xs text-neutral-400">
                  {stats.join(' · ')}
                  {row.lastActivity && ` · Active ${formatRelative(row.lastActivity)}`}
                </span>
              </button>
              <div className="flex items-center gap-1">
                <Button
                  aria-label={`New LexChat in ${matter ? matter.title : 'General'}`}
                  onClick={() => {
                    onMatterChange(matter?.id ?? null)
                    startNewChat()
                  }}
                  size="icon"
                  title="New LexChat"
                  variant="ghost"
                >
                  <MessageSquare size={15} />
                </Button>
                {matter && canManage && (
                  <>
                    <Button
                      aria-label={`Edit ${matter.title}`}
                      onClick={() => {
                        saveMutation.reset()
                        setDraft({
                          id: matter.id,
                          title: matter.title,
                          caseNumber: matter.caseNumber,
                          clientName: matter.clientName ?? '',
                          status: matter.status,
                        })
                      }}
                      size="icon"
                      title="Edit"
                      variant="ghost"
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      aria-label={`Delete ${matter.title}`}
                      onClick={() => {
                        deleteMutation.reset()
                        setPendingDelete(matter)
                      }}
                      size="icon"
                      title="Delete"
                      variant="danger"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

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
    </section>
  )
}
