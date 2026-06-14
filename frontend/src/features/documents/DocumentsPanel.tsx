import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  Eye,
  FileText,
  Pencil,
  RefreshCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/ui/Button'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { getErrorMessage } from '../../shared/lib/errors'
import {
  deleteDocument,
  ingestDocumentToKnowledgeBank,
  getKnowledgeBankEntryStatuses,
  listDocuments,
  listKnowledgeBankEntries,
  renameDocument,
  uploadDocument,
} from '../../shared/api/api'
import type { WorkspaceDocument } from '../../shared/types/workspace'
import { useViewStore } from '../../app/viewStore'
import { DocumentDrawer } from './DocumentDrawer'

export function DocumentsPanel() {
  const { selectKnowledgeBank } = useViewStore()
  const queryClient = useQueryClient()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [ingestingDocumentId, setIngestingDocumentId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const ACCEPTED = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]

  function pickFile(file: File) {
    const extension = file.name.toLowerCase().split('.').pop()
    const hasSupportedExtension = extension === 'pdf' || extension === 'docx'
    if (!ACCEPTED.includes(file.type) && !hasSupportedExtension) {
      setMutationError('Only PDF and DOCX files are supported.')
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setMutationError('Files must be 25 MB or smaller.')
      return
    }
    setMutationError(null)
    setSelectedFile(file)
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) pickFile(file)
  }

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

  const documents = documentsQuery.data ?? []
  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? null
  const knowledgeEntries = useMemo(
    () => knowledgeEntriesQuery.data ?? [],
    [knowledgeEntriesQuery.data],
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

  const isLoading = documentsQuery.isFetching || knowledgeEntriesQuery.isFetching
  const error =
    mutationError ??
    documentsQuery.error?.message ??
    knowledgeEntriesQuery.error?.message ??
    null

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file),
    onSuccess: () => {
      setSelectedFile(null)
      setMutationError(null)
      if (inputRef.current) inputRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      setMutationError(null)
      setSelectedDocumentId(null)
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      renameDocument(id, filename),
    onSuccess: () => {
      setRenamingDocumentId(null)
      setRenameValue('')
      setMutationError(null)
      queryClient.invalidateQueries({ queryKey: ['documents'] })
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

  async function handleDeleteDocument(document: WorkspaceDocument) {
    if (deleteMutation.isPending) return
    const confirmed = window.confirm(
      `Delete ${document.filename}? This removes the uploaded document and its searchable chunks.`,
    )
    if (!confirmed) return
    deleteMutation.mutate(document.id)
  }

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
  }

  function startRename(document: WorkspaceDocument) {
    setRenamingDocumentId(document.id)
    setRenameValue(document.filename)
    setMutationError(null)
  }

  function submitRename(document: WorkspaceDocument) {
    const filename = renameValue.trim()
    if (!filename || renameMutation.isPending) return
    renameMutation.mutate({ id: document.id, filename })
  }

  if (selectedDocument) {
    return (
      <DocumentDrawer
        document={selectedDocument}
        onClose={() => setSelectedDocumentId(null)}
      />
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-100 px-4 lg:px-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">Documents</h2>
          <p className="text-xs text-neutral-500">Upload PDF or DOCX files for semantic chat search.</p>
        </div>
        <Button onClick={handleRefresh} disabled={isLoading} size="sm" variant="secondary">
          <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </header>

      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mb-5">
          {/* Drop zone */}
          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              isDragOver
                ? 'border-neutral-900 bg-neutral-50'
                : selectedFile
                  ? 'border-neutral-300 bg-neutral-50'
                  : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
            }`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <UploadCloud
              size={24}
              className={isDragOver ? 'text-neutral-900' : 'text-neutral-400'}
            />
            {selectedFile ? (
              <div>
                <div className="text-sm font-medium text-neutral-900">{selectedFile.name}</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · ready to upload
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-medium text-neutral-700">
                  {isDragOver ? 'Drop to upload' : 'Drop a file here, or click to browse'}
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  PDF or DOCX · max 25 MB
                </div>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f) }}
            />
          </label>

          {/* Upload action row */}
          {selectedFile && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <button
                className="text-xs text-neutral-400 hover:text-neutral-600"
                onClick={() => { setSelectedFile(null); if (inputRef.current) inputRef.current.value = '' }}
                type="button"
              >
                Clear
              </button>
              <Button
                onClick={() => uploadMutation.mutate(selectedFile)}
                disabled={uploadMutation.isPending}
                size="sm"
                variant="primary"
              >
                {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {documents.length > 0 ? (
            documents.map((document) => {
              const knowledgeEntry = knowledgeEntries.find(
                (entry) => entry.sourceDocumentId === document.id,
              )
              const isGenerating = ingestingDocumentId === document.id
              const isDeleting = deleteMutation.isPending && deleteMutation.variables === document.id
              return (
                <article
                  key={document.id}
                  className="flex cursor-pointer flex-col gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 transition-colors hover:border-neutral-300 hover:bg-neutral-50/50 sm:flex-row sm:items-start"
                  onClick={() => setSelectedDocumentId(document.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedDocumentId(document.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-600">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {renamingDocumentId === document.id ? (
                        <div
                          className="flex min-w-0 flex-1 items-center gap-1"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            autoFocus
                            className="h-8 min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-neutral-500"
                            maxLength={255}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === 'Enter') submitRename(document)
                              if (event.key === 'Escape') setRenamingDocumentId(null)
                            }}
                            value={renameValue}
                          />
                          <Button
                            aria-label="Save filename"
                            disabled={!renameValue.trim() || renameMutation.isPending}
                            onClick={() => submitRename(document)}
                            size="icon"
                            variant="ghost"
                          >
                            <Check size={14} />
                          </Button>
                          <Button
                            aria-label="Cancel rename"
                            onClick={() => setRenamingDocumentId(null)}
                            size="icon"
                            variant="ghost"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <h3 className="truncate text-sm font-medium text-neutral-900">
                          {document.filename}
                        </h3>
                      )}
                      <StatusBadge
                        tone={
                          document.status === 'ready'
                            ? 'success'
                            : document.status === 'failed'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {document.status}
                      </StatusBadge>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {document.chunkCount} chunks · Uploaded {formatDate(document.createdAt)}
                    </div>
                    {knowledgeEntry && (
                      <div className="mt-1 text-xs text-neutral-500">
                        Knowledge Bank: {knowledgeEntry.title} ({knowledgeEntry.scope.replace('_', ' ')})
                        {knowledgeEntry.status === 'processing' && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                            Summarising...
                          </span>
                        )}
                        {knowledgeEntry.status === 'failed' && (
                          <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
                            Failed — retry below
                          </span>
                        )}
                      </div>
                    )}
                    {document.errorMessage && (
                      <div className="mt-2 text-xs text-red-600">{document.errorMessage}</div>
                    )}
                    {knowledgeEntry?.errorMessage && (
                      <div className="mt-2 text-xs text-red-600">
                        Summary error: {knowledgeEntry.errorMessage}
                      </div>
                    )}
                  </div>
                  <div
                    className="flex shrink-0 flex-wrap gap-2 sm:justify-end"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      onClick={() => setSelectedDocumentId(document.id)}
                      size="sm"
                      variant="secondary"
                    >
                      <Eye size={14} />
                      Review
                    </Button>
                    {knowledgeEntry?.status === 'ready' ? (
                      <Button
                        onClick={() => selectKnowledgeBank(knowledgeEntry.id)}
                        size="sm"
                        variant="secondary"
                      >
                        <BookOpen size={14} />
                        Open Knowledge Bank
                      </Button>
                    ) : knowledgeEntry?.status === 'processing' ? (
                      <Button
                        disabled
                        size="sm"
                        variant="secondary"
                        title="Summary is being generated"
                      >
                        <BookOpen size={14} />
                        Summarising...
                      </Button>
                    ) : document.canManage ? (
                      <Button
                        onClick={() => void handleAddToKnowledgeBank(document)}
                        disabled={document.status !== 'ready' || !!ingestingDocumentId}
                        size="sm"
                        variant="secondary"
                        title={
                          document.status === 'ready'
                            ? knowledgeEntry?.status === 'failed'
                              ? 'Retry summary generation'
                              : 'Generate a private Knowledge Bank summary'
                            : 'Document must be ready first'
                        }
                      >
                        <BookOpen size={14} />
                        {isGenerating
                          ? 'Queuing...'
                          : knowledgeEntry?.status === 'failed'
                            ? 'Retry summary'
                            : 'Add to Knowledge Bank'}
                      </Button>
                    ) : null}
                    {document.canManage && renamingDocumentId !== document.id && (
                      <Button
                        onClick={() => startRename(document)}
                        size="sm"
                        variant="secondary"
                      >
                        <Pencil size={14} />
                        Rename
                      </Button>
                    )}
                    {document.canManage && (
                      <Button
                        onClick={() => void handleDeleteDocument(document)}
                        disabled={isDeleting || isGenerating}
                        size="sm"
                        variant="danger"
                      >
                        <Trash2 size={14} />
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                    )}
                  </div>
                </article>
              )
            })
          ) : (
            <div className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
              No documents uploaded yet.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
