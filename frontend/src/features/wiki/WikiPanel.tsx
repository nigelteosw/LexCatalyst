import { useEffect, useMemo, useState } from 'react'
import { FileText, GitBranch, RefreshCcw, Save, Trash2, UploadCloud } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/ui/Button'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const WIKI_HELP: HelpContent = {
  intro: 'An AI-generated knowledge graph that maps the key issues, entities, and arguments in your documents into linked wiki pages.',
  steps: [
    {
      emoji: '📄',
      title: 'Ingest a document',
      body: 'Open a document and click "Generate wiki". The AI reads the full text and creates structured pages for each major topic — parties, issues, clauses, authorities, and timelines.',
    },
    {
      emoji: '🕸️',
      title: 'Explore the graph',
      body: 'The graph view shows how pages link to each other. Click any node to jump to that page. Zoom and drag to navigate large matter maps.',
    },
    {
      emoji: '✏️',
      title: 'Edit and publish',
      body: 'Pages start as drafts. Open one, refine the AI\'s output, then change status to "Published" to make it the authoritative version for your matter.',
    },
    {
      emoji: '🔗',
      title: 'Source citations',
      body: 'Each page tracks which document chunks, KB entries, and chat messages it was built from. Click "Sources" on a page to see exactly where each fact came from.',
    },
  ],
  tips: [
    'Wiki pages are not automatically shared — they are private to you by default. Publishing makes them visible to your matter team.',
    'The graph is especially useful for complex multi-party matters: each counterparty, key issue, and deadline gets its own linked node.',
    'You can ingest the same document into multiple page types — try Source Summary for a quick overview and then Issue pages for the legal arguments.',
  ],
}
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { getErrorMessage } from '../../shared/lib/errors'
import { WikiGraphCanvas } from './WikiGraphCanvas'
import {
  deleteWikiPage,
  getWikiGraph,
  getWikiPage,
  listWikiPageSources,
  listWikiPages,
  publishWikiPage,
  updateWikiPage,
} from '../../shared/api/api'
import type { CurrentUser } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'

export function WikiPanel({ currentUser }: { currentUser: CurrentUser | null }) {
  const { current, selectWiki, selectDocuments } = useWorkspaceNavigation()
  const pageId = current.view === 'wiki' ? current.pageId : null

  const queryClient = useQueryClient()

  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [filter, setFilter] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)

  // Queries
  const pagesQuery = useQuery({ queryKey: ['wikiPages'], queryFn: () => listWikiPages() })
  const graphQuery = useQuery({ queryKey: ['wikiGraph'], queryFn: getWikiGraph })
  const pageQuery = useQuery({
    queryKey: ['wikiPage', pageId],
    queryFn: () => getWikiPage(pageId!),
    enabled: !!pageId,
  })
  const sourcesQuery = useQuery({
    queryKey: ['wikiPageSources', pageId],
    queryFn: () => listWikiPageSources(pageId!),
    enabled: !!pageId,
  })

  const pages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data])
  const graph = graphQuery.data ?? { nodes: [], edges: [] }
  const activePage = pageQuery.data ?? null
  const sources = sourcesQuery.data ?? []
  const isLoading = pagesQuery.isFetching || graphQuery.isFetching

  // Auto-select first page when none is selected
  useEffect(() => {
    if (!pageId && pages.length > 0) {
      selectWiki(pages[0].id, { replace: true })
    }
  }, [pageId, pages, selectWiki])

  // Initialise drafts when opening editor
  function handleStartEdit() {
    if (!activePage) return
    setDraftTitle(activePage.title)
    setDraftBody(activePage.bodyMarkdown)
    setIsEditing(true)
  }

  function invalidateWiki(id?: string) {
    queryClient.invalidateQueries({ queryKey: ['wikiPages'] })
    queryClient.invalidateQueries({ queryKey: ['wikiGraph'] })
    if (id) {
      queryClient.invalidateQueries({ queryKey: ['wikiPage', id] })
      queryClient.invalidateQueries({ queryKey: ['wikiPageSources', id] })
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateWikiPage(pageId!, {
        title: draftTitle,
        bodyMarkdown: draftBody,
        changeSummary: 'Updated from Lex-Wiki',
      }),
    onSuccess: (updated) => {
      setIsEditing(false)
      setMutationError(null)
      invalidateWiki(updated.id)
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteWikiPage(pageId!),
    onSuccess: () => {
      setMutationError(null)
      selectWiki(null, { replace: true })
      invalidateWiki()
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })

  const publishMutation = useMutation({
    mutationFn: () => publishWikiPage(pageId!),
    onSuccess: (updated) => {
      setMutationError(null)
      invalidateWiki(updated.id)
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })

  const isSaving = saveMutation.isPending || publishMutation.isPending
  const isDeleting = deleteMutation.isPending

  const error =
    mutationError ??
    pagesQuery.error?.message ??
    pageQuery.error?.message ??
    graphQuery.error?.message ??
    sourcesQuery.error?.message ??
    null
  const canEdit =
    !!activePage &&
    (currentUser?.isAdmin === true || activePage.ownerUserId === currentUser?.id)

  const filteredPages = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return pages
    return pages.filter((page) =>
      `${page.title} ${page.pageType} ${page.status}`.toLowerCase().includes(query),
    )
  }, [filter, pages])

  function handleSelectPage(id: string) {
    setIsEditing(false)
    selectWiki(id)
  }

  async function handleDelete() {
    if (!activePage || isDeleting) return
    if (!window.confirm(`Remove "${activePage.title}" from Lex-Wiki?`)) return
    deleteMutation.mutate()
  }

  function handleRefresh() {
    invalidateWiki(pageId ?? undefined)
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <PanelHeader
        actions={
          <>
            <Button onClick={() => selectDocuments()} size="sm" variant="secondary">
              Documents
            </Button>
            <Button onClick={handleRefresh} disabled={isLoading} size="sm" variant="secondary">
              <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </>
        }
        description="Draft, publish, and browse generated matter knowledge."
        helpContent={WIKI_HELP}
        icon={GitBranch}
        title="Lex-Wiki"
      />

      <div className="app-scroll-region flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[280px_minmax(0,1fr)_320px] lg:overflow-hidden">
        <aside className="border-b border-neutral-100 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="border-b border-neutral-100 p-3">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search pages"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-2 lg:max-h-none lg:h-[calc(100vh-8.5rem)]">
            {filteredPages.length > 0 ? (
              <div className="space-y-1">
                {filteredPages.map((page) => (
                  <button
                    key={page.id}
                    onClick={() => handleSelectPage(page.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                      activePage?.id === page.id
                        ? 'bg-neutral-100 text-neutral-950'
                        : 'text-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="shrink-0 text-neutral-500" />
                      <span className="truncate font-medium">{page.title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                      <StatusBadge
                        tone={
                          page.status === 'published'
                            ? 'success'
                            : page.status === 'archived'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {page.status}
                      </StatusBadge>
                      <span>{labelPageType(page.pageType)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center text-sm text-neutral-500">
                No wiki pages yet. Generate one from a ready document.
              </div>
            )}
          </div>
        </aside>

        <main className="px-4 py-4 lg:min-h-0 lg:overflow-y-auto lg:px-6">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {activePage ? (
            <article className="mx-auto max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  {canEdit && isEditing ? (
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xl font-semibold outline-none focus:border-neutral-400"
                    />
                  ) : (
                    <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">
                      {activePage.title}
                    </h1>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <StatusBadge
                      tone={
                        activePage.status === 'published'
                          ? 'success'
                          : activePage.status === 'archived'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {activePage.status}
                    </StatusBadge>
                    <span>{labelPageType(activePage.pageType)}</span>
                    <span>
                      Author:{' '}
                      {activePage.author?.fullName || activePage.author?.email || 'Unknown'}
                    </span>
                    <span>Added {formatDateTime(activePage.createdAt)}</span>
                    <span>Latest edit {formatDateTime(activePage.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canEdit && isEditing ? (
                    <>
                      <Button
                        onClick={() => setIsEditing(false)}
                        disabled={isSaving}
                        size="sm"
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={isSaving || !draftTitle.trim() || !draftBody.trim()}
                        size="sm"
                        variant="primary"
                      >
                        <Save size={14} />
                        Save
                      </Button>
                    </>
                  ) : canEdit ? (
                    <>
                      {activePage.status === 'draft' && (
                        <Button
                          onClick={() => publishMutation.mutate()}
                          disabled={isSaving}
                          size="sm"
                          variant="primary"
                        >
                          <UploadCloud size={14} />
                          Publish
                        </Button>
                      )}
                      <Button onClick={handleStartEdit} size="sm" variant="secondary">
                        Edit
                      </Button>
                      <Button
                        onClick={() => void handleDelete()}
                        disabled={isDeleting}
                        size="sm"
                        variant="danger"
                      >
                        <Trash2 size={14} />
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-neutral-500">Read-only page</span>
                  )}
                </div>
              </div>

              {canEdit && isEditing ? (
                <textarea
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  className="min-h-[520px] w-full rounded-lg border border-neutral-200 px-3 py-3 font-mono text-sm leading-6 outline-none focus:border-neutral-400"
                />
              ) : (
                <MarkdownContent markdown={activePage.bodyMarkdown} />
              )}
            </article>
          ) : (
            <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed border-neutral-200 px-5 py-10 text-center">
              <FileText className="mx-auto mb-3 text-neutral-400" size={28} />
              <h3 className="text-sm font-semibold text-neutral-900">No Lex-Wiki page selected</h3>
              <p className="mt-1 text-sm text-neutral-500">
                Generate a wiki page from a ready document, then edit and publish it to the team.
              </p>
            </div>
          )}
        </main>

        <aside className="border-t border-neutral-100 bg-neutral-50/70 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="space-y-4 p-4">
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <GitBranch size={13} />
                Graph
              </div>
              <WikiGraphCanvas
                graph={graph}
                activePageId={activePage?.id ?? null}
                onSelectPage={handleSelectPage}
              />
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Source Citations
              </div>
              {sources.length > 0 ? (
                <div className="space-y-2">
                  {sources.map((source) => (
                    <div key={source.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                      <div className="text-xs font-semibold text-neutral-800">
                        {source.citationLabel}
                      </div>
                      {source.relevanceNote && (
                        <div className="mt-1 text-xs text-neutral-500">{source.relevanceNote}</div>
                      )}
                      {source.snippet && (
                        <div className="mt-2 max-h-28 overflow-y-auto rounded-md bg-neutral-50 p-2 text-xs leading-5 text-neutral-600">
                          {source.snippet}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-neutral-200 bg-white px-3 py-5 text-center text-sm text-neutral-500">
                  No citations for this page yet.
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </section>
  )
}

function labelPageType(value: string) {
  return value.replace(/_/g, ' ')
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
