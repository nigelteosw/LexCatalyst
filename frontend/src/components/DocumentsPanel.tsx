import { useEffect, useRef, useState } from 'react'
import { FileText, RefreshCcw, UploadCloud } from 'lucide-react'
import { listDocuments, uploadDocument } from '../lib/api'
import type { WorkspaceDocument } from '../types/workspace'

export function DocumentsPanel() {
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function loadDocuments() {
    setIsLoading(true)
    setError(null)
    try {
      setDocuments(await listDocuments())
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadDocuments()
  }, [])

  async function handleUpload() {
    if (!selectedFile || isUploading) return

    setIsUploading(true)
    setError(null)
    try {
      const uploaded = await uploadDocument(selectedFile)
      setDocuments((current) => [uploaded, ...current.filter((doc) => doc.id !== uploaded.id)])
      setSelectedFile(null)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex h-14 items-center justify-between border-b border-neutral-100 px-4 lg:px-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">Documents</h2>
          <p className="text-xs text-neutral-500">Upload PDF or DOCX files for semantic chat search.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadDocuments()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
          disabled={isLoading}
        >
          <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
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
                  Files are stored in R2, extracted, chunked, and embedded.
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
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!selectedFile || isUploading}
              className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              {isUploading ? 'Processing...' : 'Upload'}
            </button>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {documents.length > 0 ? (
            documents.map((document) => (
              <article
                key={document.id}
                className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3"
              >
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-600">
                  <FileText size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-medium text-neutral-900">{document.filename}</h3>
                    <StatusBadge status={document.status} />
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {document.chunkCount} chunks · Uploaded {formatDate(document.createdAt)}
                  </div>
                  {document.errorMessage && (
                    <div className="mt-2 text-xs text-red-600">{document.errorMessage}</div>
                  )}
                </div>
              </article>
            ))
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
  if (Number.isNaN(date.getTime())) {
    return 'recently'
  }
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
