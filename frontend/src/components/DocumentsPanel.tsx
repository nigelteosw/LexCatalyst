import { useRef, useState } from 'react'
import { BookOpen, FileText, RefreshCcw, Trash2, UploadCloud } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from './Button'
import {
  deleteDocument,
  ingestDocumentToKnowledgeBank,
  listDocuments,
  listKnowledgeBankEntries,
  uploadDocument,
} from '../lib/api'
import type { ChatModel, WorkspaceDocument } from '../types/workspace'
import { useViewStore } from '../store/viewStore'

type DocumentsPanelProps = {
  selectedModel: ChatModel
  selectedMatterId: string | null
}

export function DocumentsPanel({ selectedModel, selectedMatterId }: DocumentsPanelProps) {
  const { selectKnowledgeBank } = useViewStore()
  const queryClient = useQueryClient()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [ingestingDocumentId, setIngestingDocumentId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const documentsQuery = useQuery({ queryKey: ['documents'], queryFn: listDocuments })
  const knowledgeEntriesQuery = useQuery({
    queryKey: ['kbEntries'],
    queryFn: () => listKnowledgeBankEntries(),
  })

  const documents = documentsQuery.data ?? []
  const knowledgeEntries = knowledgeEntriesQuery.data ?? []
  const isLoading = documentsQuery.isFetching || knowledgeEntriesQuery.isFetching
  const error =
    mutationError ??
    documentsQuery.error?.message ??
    knowledgeEntriesQuery.error?.message ??
    null

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file, selectedMatterId),
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
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })

  async function handleAddToKnowledgeBank(document: WorkspaceDocument) {
    if (document.status !== 'ready' || ingestingDocumentId) return
    setIngestingDocumentId(document.id)
    setMutationError(null)
    try {
      const entry = await ingestDocumentToKnowledgeBank(document.id, selectedModel)
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
      selectKnowledgeBank(entry.id)
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

  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex h-14 items-center justify-between border-b border-neutral-100 px-4 lg:px-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">Documents</h2>
          <p className="text-xs text-neutral-500">Upload PDF or DOCX files for semantic chat search.</p>
        </div>
        <Button onClick={handleRefresh} disabled={isLoading} size="sm" variant="secondary">
          <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mb-5 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex min-h-20 flex-1 cursor-pointer items-center gap-3 rounded-md border border-dashed border-neutral-300 bg-white px-3 py-3 hover:border-neutral-400">
              <UploadCloud size={20} className="text-neutral-500" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-neutral-800">
                  {selectedFile ? selectedFile.name : 'Choose a PDF or DOCX'}
                </div>
                <div className="text-xs text-neutral-500">
                  Files are stored in R2, extracted, chunked, and embedded
                  {selectedMatterId ? ' in the active matter.' : '.'}
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <Button
              onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
              disabled={!selectedFile || uploadMutation.isPending}
              size="md"
              variant="primary"
            >
              {uploadMutation.isPending ? 'Processing...' : 'Upload'}
            </Button>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
                  className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 sm:flex-row sm:items-start"
                >
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-600">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-medium text-neutral-900">
                        {document.filename}
                      </h3>
                      <StatusBadge status={document.status} />
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {document.chunkCount} chunks · Uploaded {formatDate(document.createdAt)}
                    </div>
                    {knowledgeEntry && (
                      <div className="mt-1 text-xs text-neutral-500">
                        Knowledge Bank: {knowledgeEntry.title} ({knowledgeEntry.scope.replace('_', ' ')})
                      </div>
                    )}
                    {document.errorMessage && (
                      <div className="mt-2 text-xs text-red-600">{document.errorMessage}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2 sm:justify-end">
                    {knowledgeEntry ? (
                      <Button
                        onClick={() => selectKnowledgeBank(knowledgeEntry.id)}
                        size="sm"
                        variant="secondary"
                      >
                        <BookOpen size={14} />
                        Open Knowledge Bank
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void handleAddToKnowledgeBank(document)}
                        disabled={document.status !== 'ready' || !!ingestingDocumentId}
                        size="sm"
                        variant="secondary"
                        title={
                          document.status === 'ready'
                            ? 'Generate a private Knowledge Bank summary'
                            : 'Document must be ready first'
                        }
                      >
                        <BookOpen size={14} />
                        {isGenerating ? 'Adding...' : 'Add to Knowledge Bank'}
                      </Button>
                    )}
                    <Button
                      onClick={() => void handleDeleteDocument(document)}
                      disabled={isDeleting || isGenerating}
                      size="sm"
                      variant="danger"
                    >
                      <Trash2 size={14} />
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </Button>
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

function StatusBadge({ status }: { status: WorkspaceDocument['status'] }) {
  const className =
    status === 'ready'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : status === 'failed'
        ? 'bg-red-50 text-red-700 border-red-100'
        : 'bg-amber-50 text-amber-700 border-amber-100'

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {status}
    </span>
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
