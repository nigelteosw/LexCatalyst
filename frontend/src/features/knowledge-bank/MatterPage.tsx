import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, FileText, MessageSquare, Scale } from 'lucide-react'
import {
  listActionItems,
  listChatThreads,
  listDocuments,
  listKnowledgeBankEntryPage,
  listMatters,
} from '../../shared/api/api'
import { useWorkspaceNavigation } from '../../app/routes'
import { getErrorMessage } from '../../shared/lib/errors'
import {
  MatterDocuments,
  useDocumentUpload,
  validateDocumentFile,
} from '../documents/MatterDocuments'
import { formatShortDate } from '../../shared/lib/dates'
import { StatusBadge } from '../../shared/ui/StatusBadge'

type Tab = 'documents' | 'cases' | 'chats' | 'pending'

function shortDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (date.toDateString() === new Date().toDateString()) return 'Today'
  return formatShortDate(date)
}

/** Same row as a Knowledge Bank entry: tile, title and detail, then a type column and a date. */
function ItemRow({
  icon,
  title,
  detail,
  kind,
  date,
  onClick,
}: {
  icon: ReactNode
  title: string
  detail?: string
  kind?: string
  date: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-1 items-start gap-x-4 px-1 py-4 text-left transition-colors hover:bg-black/[0.025] sm:grid-cols-[44px_minmax(0,1fr)_110px_70px] sm:py-5"
    >
      <span className="hidden h-11 w-11 place-items-center rounded-lg bg-blue-50 text-[#1e3a8a] sm:grid">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-base font-medium leading-snug text-neutral-900">{title}</h3>
        {detail && <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{detail}</p>}
      </div>
      <span className="hidden text-sm capitalize text-neutral-500 sm:block">{kind}</span>
      <span className="hidden text-right text-sm text-neutral-500 sm:block">{shortDate(date)}</span>
    </button>
  )
}

function Section({
  icon,
  label,
  count,
  children,
}: {
  icon: ReactNode
  label: string
  count: number
  children: ReactNode
}) {
  return (
    <section className="mt-6">
      <h2 className="sr-only">
        {icon}
        {label}
        <span className="font-sans text-sm text-neutral-400">{count}</span>
      </h2>
      <div className="divide-y divide-neutral-200/70">{children}</div>
    </section>
  )
}

/** Route id for the pseudo-matter that holds everything without a matter. */
export const GENERAL_MATTER_ID = 'general'

export function MatterPage({
  matterId,
  onMatterChange,
}: {
  matterId: string
  onMatterChange: (matterId: string | null) => void
}) {
  const isGeneral = matterId === GENERAL_MATTER_ID
  // null = General; this is the value documents, threads and actions carry.
  const matterKey = isGeneral ? null : matterId
  const [tab, setTab] = useState<Tab>('documents')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { selectHome, selectKnowledgeBank, selectThread, selectActions, startNewChat } =
    useWorkspaceNavigation()

  const mattersQuery = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters() })
  const matter = isGeneral ? null : (mattersQuery.data?.find((m) => m.id === matterId) ?? null)

  const docs = useQuery({ queryKey: ['documents'], queryFn: listDocuments })
  const cases = useQuery({
    queryKey: ['kbEntries', 'matter', matterId],
    queryFn: () => listKnowledgeBankEntryPage({ matterId, limit: 100, offset: 0 }),
    enabled: !isGeneral,
  })
  const chats = useQuery({
    queryKey: ['threads', matterId],
    queryFn: () => listChatThreads(matterId),
  })
  const actions = useQuery({ queryKey: ['actions'], queryFn: listActionItems })

  const matterDocs = (docs.data ?? []).filter((d) => (d.matterId ?? null) === matterKey)
  const matterCases = useMemo(() => cases.data?.items ?? [], [cases.data])
  const matterChats = useMemo(() => chats.data ?? [], [chats.data])
  const pending = (actions.data ?? []).filter(
    (a) => (a.matterId ?? null) === matterKey && a.status !== 'done',
  )

  const upload = useDocumentUpload(matterKey, folderId)

  if (!isGeneral && !matter) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {mattersQuery.isLoading ? 'Loading…' : "Matter not found, or you don't have access."}
      </div>
    )
  }

  const title = matter ? matter.title : 'General'
  const caseLabel = matter ? matter.caseNumber : 'General'
  const subtitle = matter
    ? [matter.caseNumber, matter.clientName].filter(Boolean).join(' · ')
    : 'Documents and LexChats that are not filed under a matter.'

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'documents', label: 'Documents', count: matterDocs.length },
    ...(isGeneral ? [] : [{ id: 'cases' as const, label: 'Cases', count: matterCases.length }]),
    { id: 'chats', label: 'LexChats', count: matterChats.length },
    { id: 'pending', label: 'Pending', count: pending.length },
  ]

  const needle = search.trim().toLowerCase()
  const matches = (value: string) => !needle || value.toLowerCase().includes(needle)
  const shownCases = matterCases.filter((e) => matches(e.title))
  const shownChats = matterChats.filter((c) => matches(c.title))
  const shownPending = pending.filter((a) => matches(a.title))
  const listEmpty =
    (tab === 'cases' && shownCases.length === 0) ||
    (tab === 'chats' && shownChats.length === 0) ||
    (tab === 'pending' && shownPending.length === 0)

  const outlineButton =
    'h-10 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-60'

  return (
    <div className="flex min-h-0 flex-1 bg-surface">
      <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-20 pt-6 sm:px-6 sm:pb-10 sm:pt-8 lg:px-12 lg:pt-10">
        <div className="mx-auto max-w-5xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-neutral-500">
            <button type="button" className="hover:text-neutral-800" onClick={() => selectHome()}>
              Home
            </button>
            {' / '}
            <span className="text-neutral-700">{caseLabel}</span>
          </nav>

          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight text-neutral-950">{title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {matter && (
              <StatusBadge tone={matter.status === 'active' ? 'success' : 'neutral'}>{matter.status}</StatusBadge>
            )}
            <p className="max-w-xl text-body leading-relaxed text-ink-secondary">{subtitle}</p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const problem = validateDocumentFile(file)
                setUploadError(problem)
                if (problem) return
                setTab('documents')
                upload.mutate(file, { onError: (err) => setUploadError(getErrorMessage(err)) })
              }}
            />
            <button
              className={outlineButton}
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <button
              className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              onClick={() => {
                onMatterChange(matterKey)
                startNewChat()
              }}
              type="button"
            >
              {isGeneral ? 'New LexChat' : 'New LexChat in matter'}
            </button>
          </div>

          <div
            role="tablist"
            className="mt-10 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3"
          >
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`text-body transition-colors ${
                    tab === t.id ? 'text-[#1e3a8a]' : 'text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {t.label} <span className="text-neutral-400">{t.count}</span>
                </button>
              ))}
            </div>
            <input
              aria-label={`Search ${title}`}
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 sm:w-64"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              value={search}
            />
          </div>

          <div role="tabpanel">
            {tab === 'documents' && (
              <MatterDocuments
                folderId={folderId}
                matterId={matterKey}
                onFolderChange={setFolderId}
                onUploadError={setUploadError}
                search={search}
                uploadError={uploadError}
              />
            )}
            {tab === 'cases' && shownCases.length > 0 && (
              <Section icon={<Scale size={18} className="text-neutral-600" />} label="Cases" count={shownCases.length}>
                {shownCases.map((e) => (
                  <ItemRow
                    key={e.id}
                    icon={<Scale size={18} />}
                    title={e.title}
                    detail={e.bodyMarkdown?.replace(/[#*_`>\-]/g, '').trim().slice(0, 160)}
                    kind={e.entryType.replace('_', ' ')}
                    date={e.updatedAt}
                    onClick={() => selectKnowledgeBank(e.id)}
                  />
                ))}
              </Section>
            )}
            {tab === 'chats' && shownChats.length > 0 && (
              <Section icon={<MessageSquare size={18} className="text-neutral-600" />} label="LexChats" count={shownChats.length}>
                {shownChats.map((c) => (
                  <ItemRow
                    key={c.id}
                    icon={<MessageSquare size={18} />}
                    title={c.title}
                    kind="LexChat"
                    date={c.updatedAt}
                    onClick={() => selectThread(c.id)}
                  />
                ))}
              </Section>
            )}
            {tab === 'pending' && shownPending.length > 0 && (
              <Section icon={<CheckSquare size={18} className="text-neutral-600" />} label="Pending" count={shownPending.length}>
                {shownPending.map((a) => (
                  <ItemRow
                    key={a.id}
                    icon={<CheckSquare size={18} />}
                    title={a.title}
                    detail={a.description ?? undefined}
                    kind={a.status.replace('_', ' ')}
                    date={a.updatedAt}
                    onClick={() => selectActions(a.id)}
                  />
                ))}
              </Section>
            )}
            {tab !== 'documents' && listEmpty && (
              <div className="mt-6 grid min-h-40 place-items-center rounded-[14px] border border-dashed border-black/15 bg-white/50 p-6 text-center">
                <div>
                  <FileText size={24} className="mx-auto text-[#8a8a84]" />
                  <p className="mt-3 text-sm text-[#6f6f69]">
                    {needle ? 'Nothing matches your search.' : 'Nothing here yet.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
