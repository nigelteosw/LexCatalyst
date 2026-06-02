import React, { useEffect, useMemo, useState } from 'react'
import { FileText, GitBranch, RefreshCcw, Save, Trash2, UploadCloud } from 'lucide-react'
import { Button } from './Button'
import { WikiGraphCanvas } from './WikiGraphCanvas'
import {
  deleteWikiPage,
  getWikiGraph,
  getWikiPage,
  listWikiPageSources,
  listWikiPages,
  publishWikiPage,
  updateWikiPage,
} from '../lib/api'
import type { WikiGraph, WikiPage, WikiPageSource } from '../types/workspace'

type WikiPanelProps = {
  selectedPageId: string | null
  onSelectPage: (pageId: string | null) => void
  onBackToDocuments: () => void
}

export function WikiPanel({
  selectedPageId,
  onSelectPage,
  onBackToDocuments,
}: WikiPanelProps) {
  const [pages, setPages] = useState<WikiPage[]>([])
  const [activePage, setActivePage] = useState<WikiPage | null>(null)
  const [sources, setSources] = useState<WikiPageSource[]>([])
  const [graph, setGraph] = useState<WikiGraph>({ nodes: [], edges: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function loadWiki(nextPageId = selectedPageId) {
    setIsLoading(true)
    setError(null)
    try {
      const [nextPages, nextGraph] = await Promise.all([listWikiPages(), getWikiGraph()])
      setPages(nextPages)
      setGraph(nextGraph)
      const pageId = nextPageId ?? nextPages[0]?.id ?? null
      if (pageId) {
        const [page, nextSources] = await Promise.all([
          getWikiPage(pageId),
          listWikiPageSources(pageId),
        ])
        setActivePage(page)
        setSources(nextSources)
        setDraftTitle(page.title)
        setDraftBody(page.bodyMarkdown)
        // Skip syncing back to parent when auto-selecting (nextPageId was null) to
        // prevent a second useEffect trigger and duplicate API round-trip on mount.
        if (nextPageId !== null) {
          onSelectPage(page.id)
        }
      } else {
        setActivePage(null)
        setSources([])
        if (nextPageId !== null) {
          onSelectPage(null)
        }
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadWiki(selectedPageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPageId])

  async function handleSelectPage(pageId: string) {
    setIsEditing(false)
    onSelectPage(pageId)
  }

  async function handleSave() {
    if (!activePage || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await updateWikiPage(activePage.id, {
        title: draftTitle,
        bodyMarkdown: draftBody,
        changeSummary: 'Updated from Lex-Wiki',
      })
      setActivePage(updated)
      setIsEditing(false)
      await loadWiki(updated.id)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!activePage || isDeleting) return
    const confirmed = window.confirm(`Delete "${activePage.title}"? This cannot be undone.`)
    if (!confirmed) return
    setIsDeleting(true)
    setError(null)
    try {
      await deleteWikiPage(activePage.id)
      setActivePage(null)
      setSources([])
      onSelectPage(null)
      await loadWiki(null)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsDeleting(false)
    }
  }

  async function handlePublish() {
    if (!activePage || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await publishWikiPage(activePage.id)
      setActivePage(updated)
      await loadWiki(updated.id)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsSaving(false)
    }
  }

  const filteredPages = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return pages
    return pages.filter((page) =>
      `${page.title} ${page.pageType} ${page.status}`.toLowerCase().includes(query),
    )
  }, [filter, pages])

  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex h-14 items-center justify-between border-b border-neutral-100 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-neutral-900">Lex-Wiki</h2>
            <p className="text-xs text-neutral-500">Draft, publish, and browse generated matter knowledge.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onBackToDocuments} size="sm" variant="secondary">
            Documents
          </Button>
          <Button onClick={() => void loadWiki(selectedPageId)} disabled={isLoading} size="sm" variant="secondary">
            <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 border-b border-neutral-100 lg:border-b-0 lg:border-r">
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
                    onClick={() => void handleSelectPage(page.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50 ${
                      activePage?.id === page.id ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="shrink-0 text-neutral-500" />
                      <span className="truncate font-medium">{page.title}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
                      <StatusBadge status={page.status} />
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

        <main className="min-h-0 overflow-y-auto px-4 py-4 lg:px-6">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {activePage ? (
            <article className="mx-auto max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  {isEditing ? (
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xl font-semibold outline-none focus:border-neutral-400"
                    />
                  ) : (
                    <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">{activePage.title}</h1>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <StatusBadge status={activePage.status} />
                    <span>{labelPageType(activePage.pageType)}</span>
                    <span>Author: {activePage.author?.fullName || activePage.author?.email || 'Unknown'}</span>
                    <span>Added {formatDateTime(activePage.createdAt)}</span>
                    <span>Latest edit {formatDateTime(activePage.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <Button onClick={() => setIsEditing(false)} disabled={isSaving} size="sm" variant="secondary">
                        Cancel
                      </Button>
                      <Button onClick={() => void handleSave()} disabled={isSaving} size="sm" variant="primary">
                        <Save size={14} />
                        Save
                      </Button>
                    </>
                  ) : (
                    <>
                      {activePage.status === 'draft' && (
                        <Button onClick={() => void handlePublish()} disabled={isSaving} size="sm" variant="primary">
                          <UploadCloud size={14} />
                          Publish
                        </Button>
                      )}
                      <Button onClick={() => setIsEditing(true)} size="sm" variant="secondary">
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
                  )}
                </div>
              </div>

              {isEditing ? (
                <textarea
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  className="min-h-[520px] w-full rounded-lg border border-neutral-200 px-3 py-3 font-mono text-sm leading-6 outline-none focus:border-neutral-400"
                />
              ) : (
                <MarkdownPreview markdown={activePage.bodyMarkdown} />
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

        <aside className="min-h-0 border-t border-neutral-100 bg-neutral-50/70 lg:border-l lg:border-t-0">
          <div className="space-y-4 p-4">
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <GitBranch size={13} />
                Graph
              </div>
              <WikiGraphCanvas
                  graph={graph}
                  activePageId={activePage?.id ?? null}
                  onSelectPage={(id) => void handleSelectPage(id)}
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
                      <div className="text-xs font-semibold text-neutral-800">{source.citationLabel}</div>
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

function StatusBadge({ status }: { status: WikiPage['status'] }) {
  const className =
    status === 'published'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
      : status === 'archived'
        ? 'border-neutral-200 bg-neutral-100 text-neutral-500'
        : 'border-amber-100 bg-amber-50 text-amber-700'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>{status}</span>
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="rounded bg-neutral-100 px-1 font-mono text-[0.875em]">{part.slice(1, -1)}</code>
    }
    return part
  })
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = markdown.split(/\n{2,}/)
  return (
    <div className="space-y-4 text-sm leading-7 text-neutral-800">
      {blocks.map((block, index) => {
        const trimmed = block.trim()
        if (!trimmed) return null
        if (trimmed === '---') {
          return <hr key={index} className="border-neutral-200" />
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={index} className="pt-1 text-base font-semibold text-neutral-950">{renderInline(trimmed.slice(4))}</h3>
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={index} className="pt-2 text-lg font-semibold text-neutral-950">{renderInline(trimmed.slice(3))}</h2>
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={index} className="text-xl font-semibold text-neutral-950">{renderInline(trimmed.slice(2))}</h1>
        }
        if (trimmed.split('\n').every((line) => line.trim().startsWith('- '))) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {trimmed.split('\n').map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.trim().replace(/^- /, ''))}</li>
              ))}
            </ul>
          )
        }
        return <p key={index} className="whitespace-pre-wrap">{renderInline(trimmed)}</p>
      })}
    </div>
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
