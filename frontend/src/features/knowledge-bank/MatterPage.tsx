import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, FileText, MessageSquare, Scale } from 'lucide-react'
import {
  listActionItems,
  listChatThreads,
  listDocuments,
  listKnowledgeBankEntryPage,
  listMatters,
  moveDocument,
  uploadDocument,
} from '../../shared/api/api'
import { useWorkspaceNavigation } from '../../app/routes'
import { Button } from '../../shared/ui/Button'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { getErrorMessage } from '../../shared/lib/errors'

type Tab = 'documents' | 'cases' | 'chats' | 'pending'

function shortDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (date.toDateString() === new Date().toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function Row({
  icon,
  title,
  meta,
  date,
  onClick,
}: {
  icon: ReactNode
  title: string
  meta?: string
  date: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-4 border-b border-neutral-100 px-1 py-4 text-left transition-colors hover:bg-neutral-50"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-neutral-900">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-sm text-neutral-500">{meta}</span>}
      </span>
      <span className="shrink-0 text-sm text-neutral-500">{shortDate(date)}</span>
    </button>
  )
}

export function MatterPage({
  matterId,
  onMatterChange,
}: {
  matterId: string
  onMatterChange: (matterId: string | null) => void
}) {
  const [tab, setTab] = useState<Tab>('documents')
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { selectKnowledgeBank, selectMatters, selectDocuments, selectThread, selectActions, startNewChat } =
    useWorkspaceNavigation()

  const mattersQuery = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters() })
  const matter = mattersQuery.data?.find((m) => m.id === matterId)

  const docs = useQuery({ queryKey: ['documents'], queryFn: listDocuments })
  const cases = useQuery({
    queryKey: ['kbEntries', 'matter', matterId],
    queryFn: () => listKnowledgeBankEntryPage({ matterId, limit: 100, offset: 0 }),
  })
  const chats = useQuery({ queryKey: ['threads', matterId], queryFn: () => listChatThreads(matterId) })
  const actions = useQuery({ queryKey: ['actions'], queryFn: listActionItems })

  const matterDocs = (docs.data ?? []).filter((d) => d.matterId === matterId)
  const matterCases = cases.data?.items ?? []
  const matterChats = chats.data ?? []
  const pending = (actions.data ?? []).filter((a) => a.matterId === matterId && a.status !== 'done')

  const upload = useMutation({
    // Upload takes no matter field; file it into this matter right after.
    mutationFn: async (file: File) => moveDocument((await uploadDocument(file)).id, matterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  })

  if (!matter) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {mattersQuery.isLoading ? 'Loading…' : "Matter not found, or you don't have access."}
      </div>
    )
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'documents', label: 'Documents', count: matterDocs.length },
    { id: 'cases', label: 'Cases', count: matterCases.length },
    { id: 'chats', label: 'LexChats', count: matterChats.length },
    { id: 'pending', label: 'Pending', count: pending.length },
  ]
  const activeCount = tabs.find((t) => t.id === tab)?.count ?? 0

  return (
    <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
        <button type="button" className="underline" onClick={() => selectKnowledgeBank()}>
          Knowledge Bank
        </button>
        {' / '}
        <button type="button" className="hover:underline" onClick={() => selectMatters()}>
          Matters
        </button>
        {' / '}
        <span>{matter.caseNumber}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-neutral-900 lg:text-4xl">{matter.title}</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {[matter.caseNumber, matter.clientName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload.mutate(file)
              e.target.value = ''
            }}
          />
          <Button variant="secondary" className="border border-neutral-200" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onMatterChange(matterId)
              startNewChat()
            }}
          >
            New LexChat in matter
          </Button>
        </div>
      </div>
      {upload.error && <ErrorBanner className="mt-4" message={getErrorMessage(upload.error)} />}

      <div role="tablist" className="mt-8 flex gap-6 border-b border-neutral-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-3 text-sm ${
              tab === t.id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {t.label} <span className="text-neutral-400">{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'documents' &&
          matterDocs.map((d) => (
            <Row
              key={d.id}
              icon={<FileText size={18} />}
              title={d.filename}
              meta={`${d.contentType.includes('pdf') ? 'PDF' : 'DOCX'} · ${d.status}`}
              date={d.updatedAt}
              onClick={() => selectDocuments(d.id)}
            />
          ))}
        {tab === 'cases' &&
          matterCases.map((e) => (
            <Row
              key={e.id}
              icon={<Scale size={18} />}
              title={e.title}
              meta={e.entryType.replace('_', ' ')}
              date={e.updatedAt}
              onClick={() => selectKnowledgeBank(e.id)}
            />
          ))}
        {tab === 'chats' &&
          matterChats.map((c) => (
            <Row
              key={c.id}
              icon={<MessageSquare size={18} />}
              title={c.title}
              date={c.updatedAt}
              onClick={() => selectThread(c.id)}
            />
          ))}
        {tab === 'pending' &&
          pending.map((a) => (
            <Row
              key={a.id}
              icon={<CheckSquare size={18} />}
              title={a.title}
              meta={a.status.replace('_', ' ')}
              date={a.updatedAt}
              onClick={() => selectActions(a.id)}
            />
          ))}
        {activeCount === 0 && (
          <p className="py-8 text-center text-sm text-neutral-500">Nothing here yet.</p>
        )}
      </div>
    </div>
  )
}
