import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  FileText,
  Pencil,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/ui/Button'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { formatDateTime } from '../../shared/lib/dates'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { getErrorMessage } from '../../shared/lib/errors'
import {
  deleteDocument,
  getKnowledgeBankEntryStatuses,
  ingestDocumentToKnowledgeBank,
  listDocuments,
  listKnowledgeBankEntries,
  renameDocument,
  searchDocumentMetadata,
  uploadDocument,
} from '../../shared/api/api'
import type { WorkspaceDocument } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'

const MAX_ROW_TAGS = 3

/** Up to three tag chips for a document row, with the rest summarised as +N. */
function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, MAX_ROW_TAGS)
  const extra = tags.length - shown.length
  return (
    <ul aria-label="Tags" className="mt-2 flex flex-wrap items-center gap-1.5">
      {shown.map((tag) => (
        <li className="rounded-md bg-neutral-100 px-2 py-0.5 text-meta text-ink-secondary" key={tag}>
          {tag}
        </li>
      ))}
      {extra > 0 && <li className="text-meta text-ink-tertiary">+{extra}</li>}
    </ul>
  )
}

const ACCEPTED = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/** Returns an error message, or null when the file can be uploaded. */
export function validateDocumentFile(file: File): string | null {
  const extension = file.name.toLowerCase().split('.').pop()
  if (!ACCEPTED.includes(file.type) && extension !== 'pdf' && extension !== 'docx') {
    return 'Only PDF and DOCX files are supported.'
  }
  if (file.size > 25 * 1024 * 1024) return 'Files must be 25 MB or smaller.'
  return null
}

/** Upload into a matter (null = General). */
export function useDocumentUpload(matterId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadDocument(file, { matterId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    },
  })
}

/**
 * Source documents for one matter (or General): a flat list with upload, rename, delete,
 * and Knowledge Bank summaries.
 */
export function MatterDocuments({
  matterId,
  uploadError,
  onUploadError,
  search,
}: {
  matterId: string | null
  uploadError: string | null
  onUploadError: (message: string | null) => void
  /** Filters documents by filename or tag. */
  search: string
}) {
  const { selectDocuments, selectKnowledgeBank } = useWorkspaceNavigation()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [isDragOver, setIsDragOver] = useState(false)
  const [ingestingDocumentId, setIngestingDocumentId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const documentsQuery = useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments,
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      return docs.some((d) => d.status === 'uploaded' || d.status === 'processing') ? 8000 : false
    },
  })
  const knowledgeEntriesQuery = useQuery({
    queryKey: ['kbEntries'],
    queryFn: () => listKnowledgeBankEntries(),
  })

  // Tags for the rows and the search box. Capped at 50 documents by the endpoint; rows beyond
  // that simply show no chips. Read by document id, so other matters' rows are never displayed.
  const metadataQuery = useQuery({
    queryKey: ['documentMetadataList', matterId ?? 'general'],
    queryFn: () => searchDocumentMetadata({ matterId, limit: 50 }),
    staleTime: 30_000,
  })
  const tagsByDocument = useMemo(
    () => new Map((metadataQuery.data ?? []).map((m) => [m.documentId, m.tags] as const)),
    [metadataQuery.data],
  )

  const knowledgeEntries = useMemo(
    () => knowledgeEntriesQuery.data ?? [],
    [knowledgeEntriesQuery.data],
  )
  const matterDocuments = useMemo(
    () => (documentsQuery.data ?? []).filter((d) => (d.matterId ?? null) === matterId),
    [documentsQuery.data, matterId],
  )
  const needle = search.trim().toLowerCase()
  const visibleDocuments = matterDocuments.filter(
    (d) =>
      !needle ||
      d.filename.toLowerCase().includes(needle) ||
      (tagsByDocument.get(d.id) ?? []).some((tag) => tag.includes(needle)),
  )

  const processingEntryIds = useMemo(
    () =>
      knowledgeEntries
        .filter((entry) => entry.status === 'processing')
        .map((entry) => entry.id)
        .sort(),
    [knowledgeEntries],
  )
  const statusQuery = useQuery({
    queryKey: ['kbEntryStatuses', processingEntryIds],
    queryFn: () => getKnowledgeBankEntryStatuses(processingEntryIds),
    enabled: processingEntryIds.length > 0,
    refetchInterval: 3000,
  })
  useEffect(() => {
    if ((statusQuery.data ?? []).some((entry) => entry.status !== 'processing')) {
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    }
  }, [queryClient, statusQuery.data])

  const upload = useDocumentUpload(matterId)
  const error = mutationError ?? uploadError ?? documentsQuery.error?.message ?? null

  function refreshDocuments() {
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
  }

  function pickFile(file: File) {
    const problem = validateDocumentFile(file)
    onUploadError(problem)
    if (!problem) upload.mutate(file, { onError: (err) => onUploadError(getErrorMessage(err)) })
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      setMutationError(null)
      refreshDocuments()
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })
  const renameMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) => renameDocument(id, filename),
    onSuccess: () => {
      setRenamingDocumentId(null)
      setMutationError(null)
      refreshDocuments()
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })
  async function handleAddToKnowledgeBank(document: WorkspaceDocument) {
    if (document.status !== 'ready' || ingestingDocumentId) return
    setIngestingDocumentId(document.id)
    setMutationError(null)
    try {
      // The API enqueues a durable processing row for the dedicated KB worker.
      await ingestDocumentToKnowledgeBank(document.id)
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    } catch (err) {
      setMutationError(getErrorMessage(err))
    } finally {
      setIngestingDocumentId(null)
    }
  }

  function handleDeleteDocument(document: WorkspaceDocument) {
    if (deleteMutation.isPending) return
    if (!window.confirm(`Delete ${document.filename}? This removes the file and its search index. LexChat will no longer cite it.`)) return
    deleteMutation.mutate(document.id)
  }

  const inlineInputClass =
    'h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-500'
  const rowClass =
    'grid grid-cols-[44px_minmax(0,1fr)] items-start gap-x-4 gap-y-3 px-1 py-5 transition-colors hover:bg-black/[0.025] md:grid-cols-[44px_minmax(0,1fr)_auto]'
  const tile = 'grid h-11 w-11 place-items-center rounded-lg bg-blue-50 text-[#1e3a8a]'

  return (
    <div className="mt-6">
      {error && <ErrorBanner className="mb-4" message={error} onDismiss={() => { setMutationError(null); onUploadError(null) }} />}

      {/* Drop zone */}
      <label
        className={`mb-2 flex cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-4 text-center transition-colors ${
          isDragOver ? 'border-[#1e3a8a] bg-blue-50/60' : 'border-neutral-300 bg-white hover:border-neutral-400 hover:bg-neutral-50'
        }`}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) pickFile(file)
        }}
      >
        <UploadCloud size={18} className={isDragOver ? 'text-[#1e3a8a]' : 'text-neutral-400'} />
        <span className="text-sm text-neutral-500">
          {upload.isPending
            ? 'Uploading…'
            : isDragOver
              ? 'Drop to upload'
              : 'Add source document: drop a PDF or DOCX, or click to browse'}
        </span>
        <input
          ref={inputRef}
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          disabled={upload.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) pickFile(f)
            e.target.value = ''
          }}
          type="file"
        />
      </label>

      {visibleDocuments.length > 0 && (
        <section className="mt-9">
          <h2 className="flex items-center gap-2.5 border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900">
            <FileText size={18} className="text-neutral-600" />
            Documents
            <span className="font-sans text-sm text-neutral-400">{visibleDocuments.length}</span>
          </h2>
          <div className="divide-y divide-neutral-200/70">
            {visibleDocuments.map((document) => {
              const knowledgeEntry = knowledgeEntries.find((entry) => entry.sourceDocumentId === document.id)
              const isGenerating = ingestingDocumentId === document.id
              const isDeleting = deleteMutation.isPending && deleteMutation.variables === document.id
              return (
                <article key={document.id} className={rowClass}>
                  <span className={tile}>
                    <FileText size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {renamingDocumentId === document.id ? (
                        <form
                          className="flex min-w-0 flex-1 items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            const filename = renameValue.trim()
                            if (filename && !renameMutation.isPending) renameMutation.mutate({ id: document.id, filename })
                          }}
                        >
                          <input
                            aria-label="Filename"
                            autoFocus
                            className={inlineInputClass}
                            maxLength={255}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Escape' && setRenamingDocumentId(null)}
                            value={renameValue}
                          />
                          <Button aria-label="Save filename" disabled={!renameValue.trim() || renameMutation.isPending} size="icon" type="submit" variant="ghost">
                            <Check size={16} />
                          </Button>
                          <Button aria-label="Cancel rename" onClick={() => setRenamingDocumentId(null)} size="icon" variant="ghost">
                            <X size={16} />
                          </Button>
                        </form>
                      ) : (
                        <button className="min-w-0 text-left" onClick={() => selectDocuments(document.id)} type="button">
                          <h3 className="truncate text-base font-medium leading-snug text-neutral-900 hover:underline">
                            {document.filename}
                          </h3>
                        </button>
                      )}
                      <StatusBadge
                        tone={document.status === 'ready' ? 'success' : document.status === 'failed' ? 'danger' : 'warning'}
                      >
                        {document.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">
                      {document.contentType.includes('pdf') ? 'PDF' : 'DOCX'} · Uploaded {formatDateTime(document.createdAt)}
                    </p>
                    <TagChips tags={tagsByDocument.get(document.id) ?? []} />
                    {knowledgeEntry && (
                      <p className="mt-1 text-sm text-neutral-500">
                        Knowledge Bank: {knowledgeEntry.title} ({knowledgeEntry.scope.replace('_', ' ')})
                        {knowledgeEntry.status === 'processing' && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                            Summarising…
                          </span>
                        )}
                        {knowledgeEntry.status === 'failed' && (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            Failed — retry
                          </span>
                        )}
                      </p>
                    )}
                    {document.errorMessage && <p className="mt-1 text-sm text-red-700">{document.errorMessage}</p>}
                    {knowledgeEntry?.errorMessage && (
                      <p className="mt-1 text-sm text-red-700">Summary error: {knowledgeEntry.errorMessage}</p>
                    )}
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-1 md:col-span-1 md:justify-end">
                    {knowledgeEntry?.status === 'ready' ? (
                      <Button onClick={() => selectKnowledgeBank(knowledgeEntry.id)} size="sm" variant="ghost">
                        <BookOpen size={14} />
                        Open entry
                      </Button>
                    ) : knowledgeEntry?.status === 'processing' ? (
                      <Button disabled size="sm" title="Summary is being generated" variant="ghost">
                        <BookOpen size={14} />
                        Summarising…
                      </Button>
                    ) : document.canManage ? (
                      <Button
                        disabled={document.status !== 'ready' || !!ingestingDocumentId}
                        onClick={() => void handleAddToKnowledgeBank(document)}
                        size="sm"
                        title={
                          document.status === 'ready'
                            ? knowledgeEntry?.status === 'failed'
                              ? 'Retry summary generation'
                              : 'Generate a private Knowledge Bank summary'
                            : 'Document must be ready first'
                        }
                        variant="ghost"
                      >
                        <BookOpen size={14} />
                        {isGenerating ? 'Queuing…' : knowledgeEntry?.status === 'failed' ? 'Retry summary' : 'Add to Knowledge Bank'}
                      </Button>
                    ) : null}
                    {document.canManage && renamingDocumentId !== document.id && (
                      <Button
                        aria-label={`Rename ${document.filename}`}
                        onClick={() => {
                          setRenamingDocumentId(document.id)
                          setRenameValue(document.filename)
                          setMutationError(null)
                        }}
                        size="icon"
                        title="Rename"
                        variant="ghost"
                      >
                        <Pencil size={15} />
                      </Button>
                    )}
                    {document.canManage && (
                      <Button
                        aria-label={`Delete ${document.filename}`}
                        disabled={isDeleting || isGenerating}
                        onClick={() => handleDeleteDocument(document)}
                        size="icon"
                        title="Delete"
                        variant="danger"
                      >
                        <Trash2 size={15} />
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {visibleDocuments.length === 0 && (
        <div className="mt-6 grid min-h-40 place-items-center rounded-[14px] border border-dashed border-black/15 bg-white/50 p-6 text-center">
          <p className="text-sm text-neutral-500">
            {needle ? 'No documents match your search.' : 'No documents yet. Add a source document above.'}
          </p>
        </div>
      )}
    </div>
  )
}

