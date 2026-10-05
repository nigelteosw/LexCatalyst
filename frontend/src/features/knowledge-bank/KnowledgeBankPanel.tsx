import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  FileText,
  ListChecks,
  Upload,
  Check,
  ExternalLink,
  FileCheck2,
  History,
  LoaderCircle,
  MoreHorizontal,
  Plus,

  ShieldCheck,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  approveKnowledgeBankRedaction,
  backfillKnowledgeBankEmbeddings,
  deleteKnowledgeBankEntry,
  fetchDocumentFile,
  getKnowledgeBankEntry,
  getKnowledgeBankEntryStatuses,
  getRedactionProposal,
  listKnowledgeBankAuditLog,
  listKnowledgeBankEntryPage,
  promoteKnowledgeBankEntry,
  updateKnowledgeBankEntry,
} from '../../shared/api/api'
import { FeatureHelp } from '../../shared/ui/FeatureHelp'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const KB_HELP: HelpContent = {
  intro: 'A searchable library of reusable legal knowledge. The AI draws on it automatically every time you chat.',
  steps: [
    {
      emoji: '📄',
      title: 'Add from a document',
      body: 'Go to Documents, upload a PDF or DOCX, and click "Add to KB". The AI reads the full text and formats it into a clean, structured entry.',
    },
    {
      emoji: '✏️',
      title: 'Create an entry manually',
      body: 'Click "+ New entry" to write your own playbook, precedent note, or style guide from scratch.',
    },
    {
      emoji: '🔒',
      title: 'Choose who can see it',
      body: 'Private — only you. Matter — everyone on that matter. Team — your practice group. Firm-wide — the whole firm (partners only).',
    },
    {
      emoji: '🤖',
      title: 'The AI uses it automatically',
      body: 'Every chat message triggers a semantic search over your accessible KB entries. Relevant content is added to the AI\'s context before it answers.',
    },
    {
      emoji: '📤',
      title: 'Promote matter knowledge firm-wide',
      body: 'Open an entry and click "Promote". The AI proposes redactions to remove client-identifying information before a lawyer approves the clean version.',
    },
  ],
  roles: [
    {
      label: 'Partner',
      tier: 'top',
      abilities: [
        'Create and edit firm-wide entries',
        'Approve promoted entries from matters',
        'View all entries across all scopes',
      ],
    },
    {
      label: 'Senior Associate',
      tier: 'mid',
      abilities: [
        'Create team and matter-scoped entries',
        'Promote matter entries to firm-wide (partner approves)',
        'Edit entries in their team and matters',
      ],
    },
    {
      label: 'Associate',
      tier: 'base',
      abilities: [
        'Create private and matter-scoped entries',
        'Read firm-wide, team, and matter entries they have access to',
        'Edit their own entries',
      ],
    },
  ],
  tips: [
    'The KB search uses semantic similarity — you don\'t need to use exact words. Ask naturally and the AI finds the relevant knowledge.',
    'Audit log (partners only) records every edit, promotion, and redaction approval with a timestamp and author.',
  ],
}
import type {
  CurrentUser,
  KnowledgeBankEntry,
  KnowledgeBankEntryType,
  KnowledgeBankScope,
  Matter,
  RedactionProposal,
} from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { EntryFormDialog } from './components/EntryFormDialog'
import { MatterFormDialog } from './components/MatterFormDialog'
import { entryTypes, scopeDescriptions, scopeLabels } from './config'
import { getErrorMessage } from '../../shared/lib/errors'

type KnowledgeBankPanelProps = {
  matters: Matter[]
  selectedMatterId: string | null
  onMatterChange: (matterId: string | null) => void
  currentUser: CurrentUser | null
}

type ListTab = 'all' | KnowledgeBankEntryType | 'upload'

const listTabs: Array<{ id: ListTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'knowledge_bank', label: 'Knowledge' },
  { id: 'style_guide', label: 'Style guides' },
  { id: 'action', label: 'Actions' },
  { id: 'upload', label: 'Uploads' },
]

function canWrite(user: CurrentUser | null) {
  return user?.isAdmin || user?.firmRole === 'partner' || user?.firmRole === 'senior_associate'
}

/** One-line plain-text preview of markdown (headings, emphasis, list markers removed). */
function markdownPreview(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function KnowledgeBankPanel({
  matters,
  selectedMatterId,
  onMatterChange,
  currentUser,
}: KnowledgeBankPanelProps) {
  const isWriter = canWrite(currentUser)
  const canCreateFirmWide =
    currentUser?.isAdmin === true || currentUser?.firmRole === 'partner'
  const canViewAudit = canCreateFirmWide
  const queryClient = useQueryClient()
  const { current, selectKnowledgeBank } = useWorkspaceNavigation()
  const selectedEntryId = current.view === 'knowledge_bank' ? current.entryId : null
  const [activeTab, setActiveTab] = useState<'library' | 'audit'>('library')
  const [search, setSearch] = useState('')
  const [listTab, setListTab] = useState<ListTab>('all')
  const [isCreatingEntry, setIsCreatingEntry] = useState(false)
  const [isCreatingMatter, setIsCreatingMatter] = useState(false)

  const [isContextOpen, setIsContextOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search.trim())

  const entriesQuery = useInfiniteQuery({
    queryKey: [
      'kbEntries',
      {
        query: deferredSearch,
        matterId: selectedMatterId,
      },
    ],
    queryFn: ({ pageParam }) =>
      listKnowledgeBankEntryPage({
        query: deferredSearch || undefined,
        contextMatterId: selectedMatterId ?? undefined,
        limit: 30,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  })
  const auditQuery = useQuery({
    queryKey: ['kbAudit'],
    queryFn: listKnowledgeBankAuditLog,
    enabled: canViewAudit && activeTab === 'audit',
  })
  const selectedEntryQuery = useQuery({
    queryKey: ['kbEntry', selectedEntryId],
    queryFn: () => getKnowledgeBankEntry(selectedEntryId!),
    enabled: !!selectedEntryId,
  })

  const entries = useMemo(
    () => entriesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [entriesQuery.data],
  )
  const processingEntryIds = useMemo(() => {
    const ids = new Set(
      entries
        .filter((entry) => entry.status === 'processing')
        .map((entry) => entry.id),
    )
    if (selectedEntryQuery.data?.status === 'processing') {
      ids.add(selectedEntryQuery.data.id)
    }
    return [...ids].sort()
  }, [entries, selectedEntryQuery.data])
  const statusQuery = useQuery({
    queryKey: ['kbEntryStatuses', processingEntryIds],
    queryFn: () => getKnowledgeBankEntryStatuses(processingEntryIds),
    enabled: processingEntryIds.length > 0,
    refetchInterval: 3000,
  })

  useEffect(() => {
    const completed = (statusQuery.data ?? []).filter(
      (entry) => entry.status !== 'processing',
    )
    if (completed.length === 0) return
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    completed.forEach((entry) => {
      queryClient.invalidateQueries({ queryKey: ['kbEntry', entry.id] })
    })
  }, [queryClient, statusQuery.data])

  const matterEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          !(selectedMatterId && entry.scope === 'matter' && entry.matterId !== selectedMatterId),
      ),
    [entries, selectedMatterId],
  )
  const tabCounts = useMemo(() => {
    const counts: Record<ListTab, number> = {
      all: matterEntries.length,
      knowledge_bank: 0,
      style_guide: 0,
      action: 0,
      upload: 0,
    }
    for (const entry of matterEntries) {
      if (entry.entryType in counts) counts[entry.entryType] += 1
      if (entry.sourceDocumentId) counts.upload += 1
    }
    return counts
  }, [matterEntries])
  const filteredEntries = useMemo(
    () =>
      matterEntries.filter((entry) => {
        if (listTab === 'all') return true
        if (listTab === 'upload') return !!entry.sourceDocumentId
        return entry.entryType === listTab
      }),
    [matterEntries, listTab],
  )

  const entryGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; icon: LucideIcon; entries: KnowledgeBankEntry[] }> = []
    let rest = filteredEntries
    if (listTab === 'all') {
      const pending = filteredEntries.filter((e) => e.sourceDocumentId && e.status !== 'ready')
      if (pending.length > 0) {
        groups.push({ key: 'recent', label: 'Recent uploads', icon: Upload, entries: pending })
        rest = filteredEntries.filter((e) => !pending.includes(e))
      }
    }
    if (listTab === 'upload') {
      return rest.length > 0 ? [{ key: 'upload', label: 'Uploads', icon: Upload, entries: rest }] : []
    }
    for (const type of listTabs.slice(1, 4)) {
      const entries = rest.filter((e) => e.entryType === type.id)
      if (entries.length > 0) groups.push({ key: type.id, label: type.label, icon: typeIcon[type.id as KnowledgeBankEntryType], entries })
    }
    const known = new Set(listTabs.map((t) => t.id))
    const other = rest.filter((e) => !known.has(e.entryType))
    if (other.length > 0) groups.push({ key: 'other', label: 'Other', icon: FileText, entries: other })
    return groups
  }, [filteredEntries, listTab])

  const selectedEntry =
    selectedEntryQuery.data ??
    entries.find((entry) => entry.id === selectedEntryId) ??
    filteredEntries[0] ??
    null

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeBankEntry,
    onSuccess: () => {
      selectKnowledgeBank(null)
      setMutationError(null)
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
      queryClient.invalidateQueries({ queryKey: ['kbAudit'] })
    },
    onError: (error) => setMutationError(getErrorMessage(error)),
  })

  const backfillMutation = useMutation({
    mutationFn: backfillKnowledgeBankEmbeddings,
    onSuccess: ({ embeddedCount, normalizedScopeCount, remainingCount }) => {
      const normalizedMessage =
        normalizedScopeCount > 0 ? ` Normalized ${normalizedScopeCount} legacy scopes.` : ''
      setBackfillMessage(
        remainingCount > 0
          ? `Indexed ${embeddedCount} entries.${normalizedMessage} ${remainingCount} remain; run repair again.`
          : embeddedCount > 0
            ? `Indexed ${embeddedCount} Knowledge Bank entries.${normalizedMessage}`
            : normalizedScopeCount > 0
              ? `The search index was complete.${normalizedMessage}`
              : 'The Knowledge Bank search index is already complete.',
      )
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    },
    onError: (error) => setBackfillMessage(getErrorMessage(error)),
  })

  const isListView = activeTab === 'library'

  function refreshKnowledgeBank() {
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    queryClient.invalidateQueries({ queryKey: ['kbAudit'] })
  }

  return (
    <section className="flex h-full min-h-0 overflow-hidden bg-[#fafaf8]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!isListView && (
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-950 text-white">
              <BookMarked size={16} />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-neutral-900">Knowledge Bank</h2>
              <FeatureHelp title="Knowledge Bank" content={KB_HELP} />
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="Active matter"
              className="h-9 max-w-56 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs text-neutral-700 outline-none focus:border-neutral-400"
              onChange={(event) => onMatterChange(event.target.value || null)}
              value={selectedMatterId ?? ''}
            >
              <option value="">No matter selected</option>
              {matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.caseNumber} · {matter.title}
                </option>
              ))}
            </select>
            {isWriter && (
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-neutral-950 px-3.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800"
                onClick={() => setIsCreatingEntry(true)}
                type="button"
              >
                <Plus size={14} />
                New entry
              </button>
            )}
            <OverflowMenu
              items={[
                ...(isWriter
                  ? [
                      {
                        label: backfillMutation.isPending ? 'Repairing search index…' : 'Repair search index',
                        disabled: backfillMutation.isPending,
                        onSelect: () => {
                          setBackfillMessage(null)
                          backfillMutation.mutate()
                        },
                      },
                      { label: 'New matter', onSelect: () => setIsCreatingMatter(true) },
                    ]
                  : []),
                ...(!selectedEntryId
                  ? [
                      {
                        label: isContextOpen ? 'Hide details panel' : 'Show details panel',
                        onSelect: () => setIsContextOpen((isOpen) => !isOpen),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </header>
        )}
        {backfillMessage && (
          <div className="border-b border-black/10 bg-[#f4f3ef] px-4 py-2 text-xs text-[#5a5a56] lg:px-5">
            {backfillMessage}
          </div>
        )}
        {(mutationError ||
          entriesQuery.isError ||
          selectedEntryQuery.isError ||
          auditQuery.isError) && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700 lg:px-5">
            {mutationError ??
              getErrorMessage(
                entriesQuery.error ?? selectedEntryQuery.error ?? auditQuery.error,
              )}
          </div>
        )}

        {!isListView && (
        <div className="flex border-b border-black/10 bg-white px-4 lg:px-5">
          <button
            className="border-b-2 border-transparent px-3 py-2.5 text-xs text-[#76766f]"
            onClick={() => setActiveTab('library')}
            type="button"
          >
            Knowledge Bank
          </button>
          <button
            className="border-b-2 border-[#0f0f0f] px-3 py-2.5 text-xs font-medium text-[#0f0f0f]"
            type="button"
          >
            Audit log
          </button>
        </div>
        )}

        {activeTab === 'library' && selectedEntryId && selectedEntry ? (
          <KnowledgeBankReader
            key={selectedEntry.id}
            entry={selectedEntry}
            canEdit={isWriter || selectedEntry.createdBy === currentUser?.id}
            canChangeScope={selectedEntry.createdBy === currentUser?.id}
            isDeleting={deleteMutation.isPending}
            matters={matters}
            onBack={() => selectKnowledgeBank(null)}
            onDelete={(entry) => {
              if (window.confirm(`Delete "${entry.title}" from the Knowledge Bank?`)) {
                deleteMutation.mutate(entry.id)
              }
            }}
            onUpdated={refreshKnowledgeBank}
          />
        ) : activeTab === 'library' ? (
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1 overflow-y-auto px-5 pb-10 pt-14 lg:px-12 lg:pt-20">
              <div className="mx-auto max-w-5xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="font-serif text-4xl tracking-tight text-neutral-950">Knowledge Bank</h1>
                    <FeatureHelp title="Knowledge Bank" content={KB_HELP} />
                  </div>
                  <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-neutral-500">
                    Precedents, authorities and internal guidance available to LexChat when drafting and reviewing.
                  </p>
                </div>
                <OverflowMenu
                  items={[
                    ...(isWriter
                      ? [
                          {
                            label: backfillMutation.isPending ? 'Repairing search index…' : 'Repair search index',
                            disabled: backfillMutation.isPending,
                            onSelect: () => {
                              setBackfillMessage(null)
                              backfillMutation.mutate()
                            },
                          },
                          { label: 'New matter', onSelect: () => setIsCreatingMatter(true) },
                        ]
                      : []),
                    {
                      label: isContextOpen ? 'Hide details panel' : 'Show details panel',
                      onSelect: () => setIsContextOpen((isOpen) => !isOpen),
                    },
                  ]}
                />
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {canViewAudit && (
                  <button
                    className="h-10 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
                    onClick={() => setActiveTab('audit')}
                    type="button"
                  >
                    Audit log
                  </button>
                )}
                {isWriter && (
                  <button
                    className="h-10 rounded-lg bg-[#1e3a8a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#172e6e]"
                    onClick={() => setIsCreatingEntry(true)}
                    type="button"
                  >
                    Add to Knowledge Bank
                  </button>
                )}
                <select
                  aria-label="Active matter"
                  className="h-10 max-w-56 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-neutral-400"
                  onChange={(event) => onMatterChange(event.target.value || null)}
                  value={selectedMatterId ?? ''}
                >
                  <option value="">All matters</option>
                  {matters.map((matter) => (
                    <option key={matter.id} value={matter.id}>
                      {matter.caseNumber} · {matter.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {listTabs.map((tab) => (
                    <button
                      className={`text-[15px] transition-colors ${
                        listTab === tab.id
                          ? 'text-[#1e3a8a]'
                          : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                      key={tab.id}
                      onClick={() => setListTab(tab.id)}
                      type="button"
                    >
                      {tab.label} <span className="text-neutral-400">{tabCounts[tab.id]}</span>
                    </button>
                  ))}
                </div>
                <input
                  aria-label="Search Knowledge Bank"
                  className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-400 sm:w-64"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                  value={search}
                />
              </div>

              {entriesQuery.isLoading ? (
                <EmptyState title="Loading Knowledge Bank..." />
              ) : filteredEntries.length > 0 ? (
                <div>
                  {entryGroups.map((group) => (
                    <section className="mt-9 first:mt-6" key={group.key}>
                      <h2 className="flex items-center gap-2.5 border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900">
                        <group.icon size={18} className="text-neutral-600" />
                        {group.label}
                        <span className="font-sans text-sm text-neutral-400">{group.entries.length}</span>
                      </h2>
                      <div className="divide-y divide-neutral-200/70">
                        {group.entries.map((entry) => (
                          <EntryCard
                            key={entry.id}
                            entry={entry}
                            isSelected={selectedEntry?.id === entry.id}
                            onClick={() => selectKnowledgeBank(entry.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                  {entriesQuery.hasNextPage && (
                    <button
                      className="mt-4 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-xs font-medium text-[#5a5a56] hover:border-black/20 disabled:opacity-50"
                      disabled={entriesQuery.isFetchingNextPage}
                      onClick={() => entriesQuery.fetchNextPage()}
                      type="button"
                    >
                      {entriesQuery.isFetchingNextPage ? 'Loading...' : 'Load more'}
                    </button>
                  )}
                </div>
              ) : (
                <EmptyState
                  action={isWriter ? 'Create first entry' : undefined}
                  onAction={isWriter ? () => setIsCreatingEntry(true) : undefined}
                  title="No knowledge matches this view"
                />
              )}
              </div>
            </main>
          </div>
        ) : (
          <AuditLogView rows={auditQuery.data ?? []} isLoading={auditQuery.isLoading} />
        )}
      </div>

      {isContextOpen && !selectedEntryId && (
        <aside className="hidden w-[295px] shrink-0 border-l border-black/10 bg-white xl:flex xl:flex-col">
          <EntryContextPanel
            entry={selectedEntry}
            canEdit={isWriter || selectedEntry?.createdBy === currentUser?.id}
            canChangeScope={selectedEntry?.createdBy === currentUser?.id}
            isDeleting={deleteMutation.isPending}
            matters={matters}
            onDelete={(entry) => {
              if (window.confirm(`Delete "${entry.title}" from the Knowledge Bank?`)) {
                deleteMutation.mutate(entry.id)
              }
            }}
            onUpdated={refreshKnowledgeBank}
          />
        </aside>
      )}

      {isCreatingEntry && (
        <EntryFormDialog
          matters={matters}
          selectedMatterId={selectedMatterId}
          onClose={() => {
            setIsCreatingEntry(false)
            setFormError(null)
          }}
          onCreated={(entry) => {
            setIsCreatingEntry(false)
            selectKnowledgeBank(entry.id)
            refreshKnowledgeBank()
          }}
          onError={setFormError}
          error={formError}
        />
      )}

      {isCreatingMatter && (
        <MatterFormDialog
          onClose={() => setIsCreatingMatter(false)}
          onCreated={(matter) => {
            setIsCreatingMatter(false)
            onMatterChange(matter.id)
            queryClient.invalidateQueries({ queryKey: ['matters'] })
          }}
        />
      )}


    </section>
  )
}

function KnowledgeBankReader({
  entry,
  canEdit,
  canChangeScope,
  isDeleting,
  matters,
  onBack,
  onDelete,
  onUpdated,
}: {
  entry: KnowledgeBankEntry
  canEdit: boolean
  canChangeScope: boolean
  isDeleting: boolean
  matters: Matter[]
  onBack: () => void
  onDelete: (entry: KnowledgeBankEntry) => void
  onUpdated: () => void
}) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(entry.title)
  const [draftBody, setDraftBody] = useState(entry.bodyMarkdown)
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null)
  const [docPreviewOpen, setDocPreviewOpen] = useState(false)
  const [docPreviewLoading, setDocPreviewLoading] = useState(false)
  const [docPreviewError, setDocPreviewError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl)
    }
  }, [docPreviewUrl])

  async function openSourceDocument() {
    if (!entry.sourceDocumentId) return
    setDocPreviewError(null)
    if (docPreviewUrl) {
      setDocPreviewOpen(true)
      return
    }
    setDocPreviewLoading(true)
    try {
      const blob = await fetchDocumentFile(entry.sourceDocumentId)
      const url = URL.createObjectURL(blob)
      setDocPreviewUrl(url)
      setDocPreviewOpen(true)
    } catch {
      setDocPreviewError('Could not load source document.')
    } finally {
      setDocPreviewLoading(false)
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateKnowledgeBankEntry(entry.id, {
        title: draftTitle,
        bodyMarkdown: draftBody,
      }),
    onSuccess: () => {
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: ['kbEntry', entry.id] })
      onUpdated()
    },
  })

  const typeMutation = useMutation({
    mutationFn: (entryType: KnowledgeBankEntryType) =>
      updateKnowledgeBankEntry(entry.id, { entryType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kbEntry', entry.id] })
      onUpdated()
    },
  })

  function startEditing() {
    setDraftTitle(entry.title)
    setDraftBody(entry.bodyMarkdown)
    setIsEditing(true)
  }

  return (
    <div className="app-scroll-region flex min-h-0 flex-1 flex-col overflow-y-auto">
      <main className="px-5 pb-12 pt-14 lg:px-12 lg:pt-20">
        <article className="mx-auto max-w-5xl">
          <button
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={14} />
            Back to Knowledge Bank
          </button>

          {canEdit && isEditing ? (
            <input
              className="w-full rounded-lg border border-black/15 px-3 py-2 text-2xl font-semibold outline-none focus:border-black/35"
              onChange={(event) => setDraftTitle(event.target.value)}
              value={draftTitle}
            />
          ) : (
            <h1 className="font-serif text-4xl leading-tight tracking-tight text-neutral-950">{entry.title}</h1>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-500">
            <Pill label={scopeLabels[entry.scope]} tone={scopeTone(entry.scope)} />
            {canEdit ? (
              <select
                aria-label="Entry type"
                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-700 outline-none focus:border-neutral-400 disabled:opacity-50"
                disabled={typeMutation.isPending || entry.status === 'processing'}
                onChange={(event) => typeMutation.mutate(event.target.value as KnowledgeBankEntryType)}
                value={entry.entryType}
              >
                {entryTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            ) : (
              <span>{entry.entryType.replaceAll('_', ' ')}</span>
            )}
            <span>Author role: {entry.createdByRole.replaceAll('_', ' ')}</span>
            <span>Added {formatDateTime(entry.createdAt)}</span>
            <span>Latest edit {formatDateTime(entry.updatedAt)}</span>
          </div>
          {canChangeScope && (
            <div className="mt-4">
              <ScopeAccessEditor
                key={entry.id}
                entry={entry}
                matters={matters}
                onUpdated={onUpdated}
              />
            </div>
          )}

          <div className="mt-6 flex items-center gap-2">
            {canEdit && isEditing ? (
              <>
                <button
                  className="rounded-lg px-3 py-2 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
                  onClick={() => setIsEditing(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-[#0f0f0f] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                  type="button"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : canEdit ? (
              <>
                <button
                  className="rounded-lg px-3 py-2 text-xs text-[#0f0f0f] hover:bg-[#f4f3ef] disabled:opacity-40"
                  disabled={entry.status === 'processing'}
                  onClick={startEditing}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  disabled={isDeleting}
                  onClick={() => onDelete(entry)}
                  type="button"
                >
                  <Trash2 size={14} />
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </>
            ) : (
              <span className="text-xs text-[#8c8c86]">Read-only access</span>
            )}
            {entry.sourceDocumentId && (
              <button
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-medium text-[#5a5a56] hover:border-black/20 hover:bg-[#f7f6f3] disabled:opacity-50"
                disabled={docPreviewLoading}
                onClick={() => void openSourceDocument()}
                type="button"
              >
                {docPreviewLoading ? <LoaderCircle size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                {docPreviewLoading ? 'Loading...' : 'View source PDF'}
              </button>
            )}
          </div>
          {docPreviewError && (
            <p className="mt-2 text-xs text-red-600">{docPreviewError}</p>
          )}
          {typeMutation.isError && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {getErrorMessage(typeMutation.error)}
            </div>
          )}
          {saveMutation.isError && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {getErrorMessage(saveMutation.error)}
            </div>
          )}

          <div className="mt-8 rounded-xl border border-neutral-200 bg-white px-6 py-7 sm:px-8 sm:py-9 lg:px-10">
            {entry.status === 'processing' ? (
              <div className="flex items-center gap-3 text-sm text-[#666660]">
                <span className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="inline-block h-2 w-2 animate-bounce rounded-full bg-[#9a9a94]"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </span>
                Formatting and indexing this document. This usually takes 30–60 seconds.
              </div>
            ) : entry.status === 'failed' ? (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">Document processing failed.</p>
                {entry.errorMessage && (
                  <p className="mt-1 text-xs leading-5 text-red-600">{entry.errorMessage}</p>
                )}
                <p className="mt-2 text-xs">
                  Reopen the document in the Documents tab and click "Retry".
                </p>
              </div>
            ) : isEditing ? (
              <textarea
                className="min-h-[560px] w-full resize-y rounded-lg border border-black/15 bg-[#fcfcfa] px-4 py-3 font-mono text-sm leading-6 outline-none focus:border-black/35"
                onChange={(event) => setDraftBody(event.target.value)}
                value={draftBody}
              />
            ) : (
              <MarkdownContent markdown={entry.bodyMarkdown} className="text-base leading-8 text-[#292925]" />
            )}
          </div>
        </article>
      </main>

      {docPreviewOpen && docPreviewUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60">
          <div className="flex shrink-0 items-center justify-between bg-white px-4 py-3 shadow">
            <span className="text-sm font-medium text-[#0f0f0f]">Source document</span>
            <button
              className="rounded-lg p-1.5 text-[#5a5a56] hover:bg-[#f4f3ef]"
              onClick={() => setDocPreviewOpen(false)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <iframe
            className="min-h-0 flex-1 border-0"
            src={docPreviewUrl}
            title="Source document preview"
          />
        </div>
      )}

    </div>
  )
}

function ScopeAccessEditor({
  entry,
  matters,
  onUpdated,
  compact = false,
}: {
  entry: KnowledgeBankEntry
  matters: Matter[]
  onUpdated: () => void
  compact?: boolean
}) {
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [scope, setScope] = useState<KnowledgeBankScope>(entry.scope)
  const [matterId, setMatterId] = useState(entry.matterId ?? '')

  const mutation = useMutation({
    mutationFn: () =>
      updateKnowledgeBankEntry(entry.id, {
        scope,
        matterId: scope === 'matter' ? matterId : null,
        teamId: null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['kbEntry', entry.id], updated)
      setIsOpen(false)
      onUpdated()
    },
  })

  function openEditor() {
    setScope(entry.scope)
    setMatterId(entry.matterId ?? '')
    setIsOpen(true)
  }

  if (!isOpen) {
    return (
      <button
        className={`inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white text-xs font-medium text-[#5a5a56] hover:border-black/20 hover:bg-[#f7f6f3] ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
        }`}
        onClick={openEditor}
        type="button"
      >
        <ShieldCheck size={13} />
        Change access
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-black/10 bg-[#f8f8f6] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8c8c86]">
        Agent access
      </div>
      <select
        aria-label="Knowledge Bank access scope"
        className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs outline-none focus:border-black/30"
        onChange={(event) => setScope(event.target.value as KnowledgeBankScope)}
        value={scope}
      >
        {(Object.keys(scopeLabels) as KnowledgeBankScope[]).map((item) => (
          <option key={item} value={item}>
            {scopeLabels[item]}
          </option>
        ))}
      </select>
      {scope === 'matter' && (
        <select
          aria-label="Matter for Knowledge Bank access"
          className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs outline-none focus:border-black/30"
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
      <p className="mt-2 text-[11px] leading-5 text-[#777770]">
        {scopeDescriptions[scope]} The agent applies this classification to every search.
      </p>
      {mutation.isError && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {getErrorMessage(mutation.error)}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          className="rounded-lg px-3 py-1.5 text-xs text-[#6f6f69] hover:bg-white"
          onClick={() => setIsOpen(false)}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-lg bg-[#0f0f0f] px-3 py-1.5 text-xs font-medium text-white disabled:bg-[#aaa9a3]"
          disabled={mutation.isPending || (scope === 'matter' && !matterId)}
          onClick={() => mutation.mutate()}
          type="button"
        >
          {mutation.isPending ? 'Saving...' : 'Save access'}
        </button>
      </div>
    </div>
  )
}

const typeIcon: Record<KnowledgeBankEntryType, LucideIcon> = {
  knowledge_bank: BookMarked,
  style_guide: FileText,
  action: ListChecks,
}

function listDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Today'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(date)
}

function EntryCard({
  entry,
  isSelected,
  onClick,
}: {
  entry: KnowledgeBankEntry
  isSelected: boolean
  onClick: () => void
}) {
  const failed = entry.status === 'failed'
  const pendingUpload = !!entry.sourceDocumentId && entry.status !== 'ready'
  const Icon = pendingUpload ? Upload : (typeIcon[entry.entryType] ?? FileText)
  const preview =
    entry.status === 'processing'
      ? 'Processing document…'
      : failed
        ? null
        : markdownPreview(entry.bodyMarkdown)

  return (
    <button
      className={`grid w-full grid-cols-[44px_minmax(0,1fr)] items-start gap-x-4 px-1 py-5 text-left transition-colors hover:bg-black/[0.025] sm:grid-cols-[44px_minmax(0,1fr)_110px_70px] ${
        isSelected ? 'bg-black/[0.025]' : ''
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`grid h-11 w-11 place-items-center rounded-lg ${
          failed ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-[#1e3a8a]'
        }`}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-medium leading-snug text-neutral-900">{entry.title}</h3>
        {preview && <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{preview}</p>}
        {failed && (
          <p className="mt-1 text-sm text-red-700">
            {entry.errorMessage ?? "Couldn't process this file."}
          </p>
        )}
      </div>
      <span className="hidden text-sm text-neutral-500 sm:block">{scopeLabels[entry.scope]}</span>
      <span className="hidden text-right text-sm text-neutral-500 sm:block">{listDate(entry.createdAt)}</span>
    </button>
  )
}

/** Small "more actions" menu so secondary actions don't crowd the header. */
function OverflowMenu({
  items,
}: {
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean }>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    <div ref={ref} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1.5 w-52 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.label}
              className="block w-full px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function EntryContextPanel({
  entry,
  canEdit,
  canChangeScope,
  isDeleting,
  matters,
  onDelete,
  onUpdated,
}: {
  entry: KnowledgeBankEntry | null
  canEdit: boolean
  canChangeScope: boolean
  isDeleting: boolean
  matters: Matter[]
  onDelete: (entry: KnowledgeBankEntry) => void
  onUpdated: () => void
}) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [redactionDraft, setRedactionDraft] = useState('')
  const [promotion, setPromotion] = useState<RedactionProposal | null>(null)

  const redactionQuery = useQuery({
    queryKey: ['kbRedaction', entry?.id],
    queryFn: () => getRedactionProposal(entry!.id),
    enabled: entry?.piiStatus === 'pending_review',
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateKnowledgeBankEntry(entry!.id, {
        title: draftTitle,
        bodyMarkdown: draftBody,
      }),
    onSuccess: () => {
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: ['kbEntry', entry?.id] })
      onUpdated()
    },
  })
  const promoteMutation = useMutation({
    mutationFn: (targetScope: 'team' | 'firm_wide') =>
      promoteKnowledgeBankEntry(entry!.id, targetScope),
    onSuccess: (proposal) => {
      setPromotion(proposal)
      setRedactionDraft(proposal.redactedContent)
      onUpdated()
    },
  })
  const approveMutation = useMutation({
    mutationFn: (proposal: RedactionProposal) =>
      approveKnowledgeBankRedaction(proposal.entry.id, {
        redactedContent: redactionDraft || proposal.redactedContent,
        redactedFields: proposal.redactedFields,
      }),
    onSuccess: () => {
      setPromotion(null)
      onUpdated()
    },
  })

  if (!entry) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <BookMarked size={24} className="mx-auto text-[#8a8a84]" />
          <p className="mt-3 text-xs leading-5 text-[#8c8c86]">
            Select an entry to review its content, provenance, and sharing status.
          </p>
        </div>
      </div>
    )
  }

  const redaction = promotion ?? redactionQuery.data ?? null

  return (
    <>
      <header className="border-b border-black/10 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold leading-6 text-neutral-900">{entry.title}</h3>
          </div>
          {canEdit && (
            <button
              aria-label="Delete entry"
              className="grid h-8 w-8 place-items-center rounded-lg text-[#76766f] hover:bg-[#fdeeed] hover:text-[#8a1f1f]"
              disabled={isDeleting}
              onClick={() => onDelete(entry)}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs capitalize text-neutral-500">
          {[
            scopeLabels[entry.scope],
            entry.entryType.replaceAll('_', ' '),
            entry.version > 1 ? `v${entry.version}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {entry.piiStatus !== 'clean' && (
          <div className="mt-2">
            <Pill label={entry.piiStatus.replaceAll('_', ' ')} tone={piiTone(entry.piiStatus)} />
          </div>
        )}
        {canChangeScope && (
          <div className="mt-3">
            <ScopeAccessEditor
              key={entry.id}
              entry={entry}
              matters={matters}
              onUpdated={onUpdated}
              compact
            />
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {canEdit && isEditing ? (
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
              onChange={(event) => setDraftTitle(event.target.value)}
              value={draftTitle}
            />
            <textarea
              className="min-h-64 w-full resize-y rounded-lg border border-black/10 px-3 py-2 text-xs leading-5 outline-none focus:border-black/30"
              onChange={(event) => setDraftBody(event.target.value)}
              value={draftBody}
            />
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-2 text-xs text-[#6f6f69] hover:bg-[#f4f3ef]"
                onClick={() => setIsEditing(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-[#0f0f0f] px-3 py-2 text-xs text-white"
                onClick={() => updateMutation.mutate()}
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        ) : redaction && canEdit ? (
          <RedactionReview
            proposal={redaction}
            redactionDraft={redactionDraft || redaction.redactedContent}
            isApproving={approveMutation.isPending}
            onChange={setRedactionDraft}
            onApprove={() => approveMutation.mutate(redaction)}
          />
        ) : (
          <>
            <MarkdownContent markdown={entry.bodyMarkdown} className="text-[13px] leading-6 text-[#4f4f49]" />
            {entry.tags.length > 0 && (
              <div className="mt-5 border-t border-black/10 pt-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
                  <Tags size={12} />
                  Tags
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <Pill key={tag} label={tag} tone="neutral" />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {canEdit && (
      <footer className="border-t border-black/10 p-3">
        {(updateMutation.isError || promoteMutation.isError || approveMutation.isError) && (
          <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {getErrorMessage(
              updateMutation.error ?? promoteMutation.error ?? approveMutation.error,
            )}
          </div>
        )}
        {!redaction && (
          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded-lg border border-black/10 px-3 py-2 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
              onClick={() => {
                setDraftTitle(entry.title)
                setDraftBody(entry.bodyMarkdown)
                setIsEditing(true)
              }}
              type="button"
            >
              Edit
            </button>
            {canChangeScope && (entry.scope === 'matter' || entry.scope === 'team') ? (
              <button
                className="rounded-lg bg-[#0f0f0f] px-3 py-2 text-xs text-white hover:bg-[#333]"
                disabled={promoteMutation.isPending}
                onClick={() =>
                  promoteMutation.mutate(entry.scope === 'matter' ? 'team' : 'firm_wide')
                }
                type="button"
              >
                {promoteMutation.isPending
                  ? 'Scanning...'
                  : entry.scope === 'matter'
                    ? 'Promote to team'
                    : 'Promote firm-wide'}
              </button>
            ) : (
              <div />
            )}
          </div>
        )}
      </footer>
      )}
    </>
  )
}

function RedactionReview({
  proposal,
  redactionDraft,
  isApproving,
  onChange,
  onApprove,
}: {
  proposal: RedactionProposal
  redactionDraft: string
  isApproving: boolean
  onChange: (value: string) => void
  onApprove: () => void
}) {
  return (
    <div>
      <div className="flex items-start gap-2 rounded-[10px] border border-[#8a5a00]/20 bg-[#fef3dc] p-3 text-xs leading-5 text-[#805400]">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Lawyer review is required before this copy can cross its current boundary.
      </div>
      <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
        Proposed substitutions
      </div>
      <div className="mt-2 space-y-2">
        {Object.entries(proposal.redactedFields).length > 0 ? (
          Object.entries(proposal.redactedFields).map(([key, value]) => (
            <div key={key} className="rounded-lg bg-[#f4f3ef] px-3 py-2 text-[11px] text-[#5a5a56]">
              {value}
            </div>
          ))
        ) : (
          <div className="rounded-lg bg-[#e8f5ee] px-3 py-2 text-[11px] text-[#1a6b4a]">
            No structured identifiers were detected. Review the content manually before approval.
          </div>
        )}
      </div>
      <label className="mt-4 block">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
          Redacted content
        </span>
        <textarea
          className="mt-2 min-h-72 w-full resize-y rounded-lg border border-black/10 p-3 text-xs leading-5 outline-none focus:border-black/30"
          onChange={(event) => onChange(event.target.value)}
          value={redactionDraft}
        />
      </label>
      <button
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#1a6b4a] px-3 py-2.5 text-xs font-medium text-white hover:bg-[#14583d]"
        disabled={isApproving}
        onClick={onApprove}
        type="button"
      >
        <Check size={13} />
        {isApproving ? 'Approving...' : 'Approve redacted copy'}
      </button>
    </div>
  )
}

function AuditLogView({
  rows,
  isLoading,
}: {
  rows: Awaited<ReturnType<typeof listKnowledgeBankAuditLog>>
  isLoading: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-[#0f0f0f]">Knowledge edit log</h3>
        <p className="mt-1 text-xs text-[#8c8c86]">
          Knowledge Bank edits by firm users.
        </p>
      </div>
      {isLoading ? (
        <EmptyState title="Loading audit events..." />
      ) : rows.length > 0 ? (
        <div className="overflow-hidden rounded-[14px] border border-black/10 bg-white">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[32px_1fr_auto] items-center gap-3 border-b border-black/10 px-4 py-3 last:border-b-0"
            >
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#f4f3ef] text-[#5a5a56]">
                <History size={14} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-[#0f0f0f]">Edit</div>
                <div className="mt-0.5 truncate text-[10px] text-[#76766f]">
                  Entry {row.entryId ?? 'deleted'} · User {row.userId}
                </div>
              </div>
              <div className="text-[10px] text-[#76766f]">{formatDate(row.timestamp)}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No Knowledge Bank activity yet" />
      )}
    </div>
  )
}

function Pill({
  label,
  tone,
}: {
  label: string
  tone: 'neutral' | 'green' | 'amber' | 'red' | 'purple' | 'blue'
}) {
  const tones = {
    neutral: 'bg-[#f4f3ef] text-[#6f6f69]',
    green: 'bg-[#e8f5ee] text-[#1a6b4a]',
    amber: 'bg-[#fef3dc] text-[#8a5a00]',
    red: 'bg-[#fdeeed] text-[#8a1f1f]',
    purple: 'bg-[#eeecff] text-[#4a3db0]',
    blue: 'bg-[#e8f0fe] text-[#1a4a8a]',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium capitalize ${tones[tone]}`}>
      {label}
    </span>
  )
}

function EmptyState({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="grid min-h-56 place-items-center rounded-[14px] border border-dashed border-black/15 bg-white/50 p-6 text-center">
      <div>
        <FileCheck2 size={24} className="mx-auto text-[#8a8a84]" />
        <p className="mt-3 text-sm text-[#6f6f69]">{title}</p>
        {action && onAction && (
          <button
            className="mt-3 rounded-lg bg-[#0f0f0f] px-3 py-2 text-xs text-white"
            onClick={onAction}
            type="button"
          >
            {action}
          </button>
        )}
      </div>
    </div>
  )
}

function scopeTone(scope: KnowledgeBankScope): 'green' | 'blue' | 'purple' | 'neutral' {
  if (scope === 'firm_wide') return 'green'
  if (scope === 'team') return 'blue'
  if (scope === 'matter') return 'purple'
  return 'neutral'
}

function piiTone(status: KnowledgeBankEntry['piiStatus']): 'green' | 'amber' | 'red' | 'neutral' {
  if (status === 'redacted') return 'green'
  if (status === 'pending_review') return 'amber'
  if (status === 'flagged') return 'red'
  return 'neutral'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
