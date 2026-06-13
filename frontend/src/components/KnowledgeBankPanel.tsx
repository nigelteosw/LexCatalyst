import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  Check,
  ChevronRight,
  FileCheck2,
  FileText,
  GitBranch,
  History,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  CircleHelp,
  RefreshCcw,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  approveKnowledgeBankRedaction,
  backfillKnowledgeBankEmbeddings,
  createKnowledgeBankEntry,
  createMatter,
  deleteKnowledgeBankEntry,
  getKnowledgeBankEntry,
  getKnowledgeBankEntryStatuses,
  getKbGraph,
  getRedactionProposal,
  listKnowledgeBankAuditLog,
  listKnowledgeBankEntryPage,
  listKnowledgeBankEntrySources,
  promoteKnowledgeBankEntry,
  updateKnowledgeBankEntry,
} from '../lib/api'
import type {
  CurrentUser,
  KnowledgeBankEntry,
  KnowledgeBankEntryType,
  KnowledgeBankScope,
  Matter,
  RedactionProposal,
} from '../types/workspace'
import { useViewStore } from '../store/viewStore'
import { WikiGraphCanvas } from './WikiGraphCanvas'
import { MarkdownContent } from './MarkdownContent'

type KnowledgeBankPanelProps = {
  matters: Matter[]
  selectedMatterId: string | null
  onMatterChange: (matterId: string | null) => void
  currentUser: CurrentUser | null
}

const entryTypes: Array<{ id: KnowledgeBankEntryType; label: string; description: string }> = [
  { id: 'knowledge_bank', label: 'Knowledge Bank', description: 'Playbooks, precedents, templates, and formats' },
  { id: 'style_guide', label: 'Style Guide', description: 'Writing standards, partner preferences, and formatting rules' },
  { id: 'action', label: 'Action', description: 'Soft-skill guides, wellness resources, and advice content' },
]

const scopeLabels: Record<KnowledgeBankScope, string> = {
  firm_wide: 'Firm-wide',
  team: 'Team',
  matter: 'Matter',
  private: 'Private',
}

const scopeDescriptions: Record<KnowledgeBankScope, string> = {
  firm_wide: 'Visible to everyone in the firm.',
  team: 'Visible to everyone in the selected team.',
  matter: 'Visible only to people with access to the selected matter.',
  private: 'Visible only to you.',
}

function canWrite(user: CurrentUser | null) {
  return user?.isAdmin || user?.firmRole === 'partner' || user?.firmRole === 'senior_associate'
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
  const { current, selectKnowledgeBank } = useViewStore()
  const selectedEntryId = current.view === 'knowledge_bank' ? current.entryId : null
  const [activeTab, setActiveTab] = useState<'library' | 'audit'>('library')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<KnowledgeBankEntryType | 'all'>('all')
  const [scopeFilter, setScopeFilter] = useState<KnowledgeBankScope | 'all'>('all')
  const [isCreatingEntry, setIsCreatingEntry] = useState(false)
  const [isCreatingMatter, setIsCreatingMatter] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isContextOpen, setIsContextOpen] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search.trim())

  const entriesQuery = useInfiniteQuery({
    queryKey: [
      'kbEntries',
      {
        query: deferredSearch,
        scope: scopeFilter,
        type: typeFilter,
        matterId: selectedMatterId,
      },
    ],
    queryFn: ({ pageParam }) =>
      listKnowledgeBankEntryPage({
        query: deferredSearch || undefined,
        scope: scopeFilter === 'all' ? undefined : scopeFilter,
        entryType: typeFilter === 'all' ? undefined : typeFilter,
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

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (typeFilter !== 'all' && entry.entryType !== typeFilter) return false
      if (scopeFilter !== 'all' && entry.scope !== scopeFilter) return false
      if (selectedMatterId && entry.scope === 'matter' && entry.matterId !== selectedMatterId) {
        return false
      }
      return true
    })
  }, [entries, selectedMatterId, scopeFilter, typeFilter])

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

  function refreshKnowledgeBank() {
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    queryClient.invalidateQueries({ queryKey: ['kbAudit'] })
  }

  return (
    <section className="flex h-full min-h-0 overflow-hidden bg-[#fafaf8]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-black/10 bg-white px-4 py-2 lg:px-5">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0f0f0f] text-white">
              <BookMarked size={16} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-[#0f0f0f]">Knowledge Bank</h2>
                <button
                  aria-label="How to use the Knowledge Bank"
                  className="grid h-5 w-5 place-items-center rounded-full text-[#aaa9a3] transition-colors hover:bg-[#f1f0ed] hover:text-[#666660]"
                  onClick={() => setIsHelpOpen(true)}
                  title="How to use the Knowledge Bank"
                  type="button"
                >
                  <CircleHelp size={13} strokeWidth={1.8} />
                </button>
              </div>
              <p className="text-[10px] text-[#8c8c86]">Controlled legal knowledge and precedents</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isWriter && (
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#5a5a56] transition-colors hover:bg-[#f4f3ef] disabled:cursor-not-allowed disabled:text-[#aaa9a3]"
                disabled={backfillMutation.isPending}
                onClick={() => {
                  setBackfillMessage(null)
                  backfillMutation.mutate()
                }}
                title="Re-embed entries with missing or stale search vectors"
                type="button"
              >
                <RefreshCcw
                  size={13}
                  className={backfillMutation.isPending ? 'animate-spin' : ''}
                />
                {backfillMutation.isPending ? 'Repairing...' : 'Repair search index'}
              </button>
            )}
            <select
              aria-label="Active matter"
              className="h-8 max-w-56 rounded-lg border border-black/10 bg-[#f4f3ef] px-2.5 text-xs text-[#5a5a56] outline-none focus:border-black/25"
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
                className="h-8 rounded-lg px-2.5 text-xs text-[#5a5a56] transition-colors hover:bg-[#f4f3ef]"
                onClick={() => setIsCreatingMatter(true)}
                type="button"
              >
                New matter
              </button>
            )}
            {!selectedEntryId && (
              <button
                aria-label={isContextOpen ? 'Hide context panel' : 'Show context panel'}
                className="hidden h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[#5a5a56] transition-colors hover:bg-[#f4f3ef] xl:inline-flex"
                onClick={() => setIsContextOpen((isOpen) => !isOpen)}
                type="button"
              >
                {isContextOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                Context
              </button>
            )}
            {isWriter && (
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-3 text-xs font-medium text-white transition-colors hover:bg-[#333]"
                onClick={() => setIsCreatingEntry(true)}
                type="button"
              >
                <Plus size={13} />
                New entry
              </button>
            )}
          </div>
        </header>
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

        <div className="flex border-b border-black/10 bg-white px-4 lg:px-5">
          <button
            className={`border-b-2 px-3 py-2.5 text-xs ${
              activeTab === 'library'
                ? 'border-[#0f0f0f] font-medium text-[#0f0f0f]'
                : 'border-transparent text-[#9a9a94]'
            }`}
            onClick={() => setActiveTab('library')}
            type="button"
          >
            Library
          </button>
          {canViewAudit && (
            <button
              className={`border-b-2 px-3 py-2.5 text-xs ${
                activeTab === 'audit'
                  ? 'border-[#0f0f0f] font-medium text-[#0f0f0f]'
                  : 'border-transparent text-[#9a9a94]'
              }`}
              onClick={() => setActiveTab('audit')}
              type="button"
            >
              Audit log
            </button>
          )}
          {currentUser && (
            <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[#9a9a94]">
              <ShieldCheck size={12} />
              {currentUser.isAdmin ? 'Admin' : currentUser.firmRole.replace('_', ' ')}
            </div>
          )}
        </div>

        {activeTab === 'library' && selectedEntryId && selectedEntry ? (
          <KnowledgeBankReader
            entries={entries}
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
            onSelectEntry={selectKnowledgeBank}
            onUpdated={refreshKnowledgeBank}
          />
        ) : activeTab === 'library' ? (
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-48 shrink-0 overflow-y-auto border-r border-black/10 bg-[#f4f3ef] p-3 md:block">
              <FilterButton
                active={typeFilter === 'all'}
                label="All knowledge"
                onClick={() => setTypeFilter('all')}
              />
              <div className="mb-1 mt-4 px-2 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#9a9a94]">
                Entry type
              </div>
              {entryTypes.map((type) => (
                <FilterButton
                  key={type.id}
                  active={typeFilter === type.id}
                  count={entries.filter((entry) => entry.entryType === type.id).length}
                  label={type.label}
                  onClick={() => setTypeFilter(type.id)}
                />
              ))}
              <div className="mb-1 mt-4 px-2 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#9a9a94]">
                Scope
              </div>
              {(Object.keys(scopeLabels) as KnowledgeBankScope[]).map((scope) => (
                <FilterButton
                  key={scope}
                  active={scopeFilter === scope}
                  count={entries.filter((entry) => entry.scope === scope).length}
                  label={scopeLabels[scope]}
                  onClick={() => setScopeFilter(scope)}
                />
              ))}
            </aside>

            <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-5">
              <div className="relative mb-4">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a94]"
                />
                <input
                  className="h-9 w-full rounded-[10px] border border-black/10 bg-white pl-9 pr-3 text-xs outline-none placeholder:text-[#aaa9a3] focus:border-black/25"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search knowledge bank, style guides, and actions"
                  value={search}
                />
              </div>

              {entriesQuery.isLoading ? (
                <EmptyState title="Loading Knowledge Bank..." />
              ) : filteredEntries.length > 0 ? (
                <div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {filteredEntries.map((entry) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        isSelected={selectedEntry?.id === entry.id}
                        onClick={() => selectKnowledgeBank(entry.id)}
                      />
                    ))}
                  </div>
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

      {isHelpOpen && (
        <Dialog title="How to use the Knowledge Bank" onClose={() => setIsHelpOpen(false)}>
          <div className="space-y-4 text-sm leading-6 text-[#5f5f59]">
            <p>
              The Knowledge Bank holds reusable legal knowledge. Your uploaded files remain private
              in Documents until you choose to add them here.
            </p>
            <HelpStep
              number="1"
              title="Add knowledge"
              body="Use Add to Knowledge Bank from Documents to generate a cited summary, or create an entry manually."
            />
            <HelpStep
              number="2"
              title="Choose the right scope"
              body="Keep an entry private, attach it to a matter, share it with a team, or publish approved knowledge firm-wide."
            />
            <HelpStep
              number="3"
              title="Review the entry"
              body="Open a card to read the full content, check source citations, edit the summary, and confirm its context."
            />
            <HelpStep
              number="4"
              title="Share carefully"
              body="Matter knowledge is checked for confidential details before promotion. A lawyer must review proposed redactions."
            />
          </div>
        </Dialog>
      )}
    </section>
  )
}

function HelpStep({
  number,
  title,
  body,
}: {
  number: string
  title: string
  body: string
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-black/8 bg-white p-3.5">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#ecebe7] text-[11px] font-semibold text-[#666660]">
        {number}
      </div>
      <div>
        <div className="text-xs font-semibold text-[#20201d]">{title}</div>
        <p className="mt-0.5 text-xs leading-5 text-[#777770]">{body}</p>
      </div>
    </div>
  )
}

function KnowledgeBankReader({
  entries,
  entry,
  canEdit,
  canChangeScope,
  isDeleting,
  matters,
  onBack,
  onDelete,
  onSelectEntry,
  onUpdated,
}: {
  entries: KnowledgeBankEntry[]
  entry: KnowledgeBankEntry
  canEdit: boolean
  canChangeScope: boolean
  isDeleting: boolean
  matters: Matter[]
  onBack: () => void
  onDelete: (entry: KnowledgeBankEntry) => void
  onSelectEntry: (entryId: string) => void
  onUpdated: () => void
}) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(entry.title)
  const [draftBody, setDraftBody] = useState(entry.bodyMarkdown)

  const sourcesQuery = useQuery({
    queryKey: ['kbEntrySources', entry.id],
    queryFn: () => listKnowledgeBankEntrySources(entry.id),
  })
  const graphQuery = useQuery({
    queryKey: ['kbGraph'],
    queryFn: getKbGraph,
  })
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

  function startEditing() {
    setDraftTitle(entry.title)
    setDraftBody(entry.bodyMarkdown)
    setIsEditing(true)
  }

  const knowledgeEntryIds = new Set(entries.map((item) => item.id))

  return (
    <div className="app-scroll-region flex min-h-0 flex-1 flex-col overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden">
      <main className="bg-white px-4 py-5 sm:px-5 lg:px-8 lg:py-7 xl:min-h-0 xl:overflow-y-auto">
        <article className="mx-auto max-w-4xl">
          <button
            className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-[#777770] hover:text-[#0f0f0f]"
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
            <h1 className="text-3xl font-semibold tracking-tight text-[#0f0f0f]">{entry.title}</h1>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#777770]">
            <Pill label={scopeLabels[entry.scope]} tone={scopeTone(entry.scope)} />
            <span>{entry.entryType.replaceAll('_', ' ')}</span>
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
          </div>
          {saveMutation.isError && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {getErrorMessage(saveMutation.error)}
            </div>
          )}

          <div className="mt-10 rounded-md border border-black/10 bg-white px-6 py-7 shadow-[0_2px_12px_rgba(0,0,0,0.045)] sm:px-8 sm:py-9 lg:px-10">
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
                Summarising this document with DeepSeek Pro. This usually takes 30–60 seconds.
              </div>
            ) : entry.status === 'failed' ? (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">Summary generation failed.</p>
                {entry.errorMessage && (
                  <p className="mt-1 text-xs leading-5 text-red-600">{entry.errorMessage}</p>
                )}
                <p className="mt-2 text-xs">
                  Reopen the document in the Documents tab and click "Retry summary".
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

      <aside className="border-t border-black/10 bg-[#f8f8f6] xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0">
        <div className="space-y-6 p-4">
          <section>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#777770]">
              <GitBranch size={13} />
              Graph
            </div>
            <WikiGraphCanvas
              activePageId={entry.id}
              graph={graphQuery.data ?? { nodes: [], edges: [] }}
              onSelectPage={(id) => {
                if (knowledgeEntryIds.has(id)) onSelectEntry(id)
              }}
            />
          </section>

          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#777770]">
              Source citations
            </div>
            {(sourcesQuery.data ?? []).length > 0 ? (
              <div className="space-y-2">
                {(sourcesQuery.data ?? []).map((source) => (
                  <div key={source.id} className="rounded-xl border border-black/10 bg-white p-3">
                    <div className="text-xs font-semibold text-[#222]">{source.citationLabel}</div>
                    {source.relevanceNote && (
                      <div className="mt-1 text-xs leading-5 text-[#777770]">
                        {source.relevanceNote}
                      </div>
                    )}
                    {source.snippet && (
                      <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-[#f5f5f2] p-2.5 text-xs leading-5 text-[#666660]">
                        {source.snippet}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-black/10 bg-white px-3 py-5 text-center text-xs text-[#888881]">
                No source citations for this entry.
              </div>
            )}
          </section>
        </div>
      </aside>
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

function EntryCard({
  entry,
  isSelected,
  onClick,
}: {
  entry: KnowledgeBankEntry
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`rounded-[14px] border p-4 text-left transition-all ${
        isSelected
          ? 'border-black/25 bg-white shadow-sm'
          : 'border-black/10 bg-white hover:border-black/20 hover:shadow-sm'
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] ${typeTone(entry.entryType)}`}>
          <FileText size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-semibold text-[#0f0f0f]">{entry.title}</h3>
            <ChevronRight size={14} className="mt-0.5 shrink-0 text-[#aaa9a3]" />
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#777770]">
            {entry.status === 'processing'
              ? 'Summarising document with DeepSeek Pro...'
              : entry.status === 'failed'
                ? entry.errorMessage ?? 'Summary generation failed.'
                : entry.bodyMarkdown}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Pill label={entry.entryType.replaceAll('_', ' ')} tone="neutral" />
            <Pill label={scopeLabels[entry.scope]} tone={scopeTone(entry.scope)} />
            {entry.status === 'processing' && <Pill label="processing" tone="amber" />}
            {entry.status === 'failed' && <Pill label="failed" tone="red" />}
            {entry.piiStatus !== 'clean' && (
              <Pill label={entry.piiStatus.replaceAll('_', ' ')} tone={piiTone(entry.piiStatus)} />
            )}
          </div>
        </div>
      </div>
    </button>
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
          <BookMarked size={24} className="mx-auto text-[#aaa9a3]" />
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
            <Pill label={entry.entryType.replaceAll('_', ' ')} tone="neutral" />
            <h3 className="mt-2 text-sm font-semibold leading-5 text-[#0f0f0f]">{entry.title}</h3>
          </div>
          {canEdit && (
            <button
              aria-label="Delete entry"
              className="grid h-8 w-8 place-items-center rounded-lg text-[#9a9a94] hover:bg-[#fdeeed] hover:text-[#8a1f1f]"
              disabled={isDeleting}
              onClick={() => onDelete(entry)}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill label={scopeLabels[entry.scope]} tone={scopeTone(entry.scope)} />
          <Pill label={entry.piiStatus.replaceAll('_', ' ')} tone={piiTone(entry.piiStatus)} />
          <Pill label={`v${entry.version}`} tone="neutral" />
        </div>
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
            <div className="whitespace-pre-wrap text-xs leading-6 text-[#4f4f49]">
              {entry.bodyMarkdown}
            </div>
            {entry.tags.length > 0 && (
              <div className="mt-5 border-t border-black/10 pt-4">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
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
      <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
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
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
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

function EntryFormDialog({
  matters,
  selectedMatterId,
  error,
  onClose,
  onCreated,
  onError,
}: {
  matters: Matter[]
  selectedMatterId: string | null
  error: string | null
  onClose: () => void
  onCreated: (entry: KnowledgeBankEntry) => void
  onError: (message: string | null) => void
}) {
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
        <div className="grid grid-cols-2 gap-3">
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

function MatterFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (matter: Matter) => void
}) {
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

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[14px] border border-black/10 bg-[#fafaf8] shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-[#0f0f0f]">{title}</h3>
          <button
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#8c8c86] hover:bg-[#eeecea]"
            onClick={onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
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
                <div className="mt-0.5 truncate text-[10px] text-[#9a9a94]">
                  Entry {row.entryId ?? 'deleted'} · User {row.userId}
                </div>
              </div>
              <div className="text-[10px] text-[#9a9a94]">{formatDate(row.timestamp)}</div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No Knowledge Bank activity yet" />
      )}
    </div>
  )
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count?: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
        active ? 'bg-white font-medium text-[#0f0f0f]' : 'text-[#6f6f69] hover:bg-white/60'
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[10px] text-[#aaa9a3]">{count}</span>}
    </button>
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
        <FileCheck2 size={24} className="mx-auto text-[#aaa9a3]" />
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

function typeTone(type: KnowledgeBankEntryType) {
  if (type === 'knowledge_bank') return 'bg-[#e8f0fe] text-[#1a4a8a]'
  if (type === 'style_guide') return 'bg-[#eeecff] text-[#4a3db0]'
  if (type === 'action') return 'bg-[#e8f5ee] text-[#1a6b4a]'
  return 'bg-[#f4f3ef] text-[#5a5a56]'
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
