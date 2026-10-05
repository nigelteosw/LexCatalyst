import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/ui/Button'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { getErrorMessage } from '../../shared/lib/errors'
import {
  createDocumentFolder,
  deleteDocument,
  deleteDocumentFolder,
  getKnowledgeBankEntryStatuses,
  ingestDocumentToKnowledgeBank,
  listDocumentFolders,
  listDocuments,
  listKnowledgeBankEntries,
  moveDocumentToFolder,
  renameDocument,
  renameDocumentFolder,
  uploadDocument,
} from '../../shared/api/api'
import type { DocumentFolder, WorkspaceDocument } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'

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

/** Upload into a matter (null = General), optionally straight into a folder. */
export function useDocumentUpload(matterId: string | null, folderId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadDocument(file, { matterId, folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
    },
  })
}

/**
 * Documents for one matter (or General): folders, upload, review, rename, delete,
 * and Knowledge Bank summaries. Replaces the old standalone Documents panel.
 */
export function MatterDocuments({
  matterId,
  folderId,
  onFolderChange,
  uploadError,
  onUploadError,
}: {
  matterId: string | null
  folderId: string | null
  onFolderChange: (folderId: string | null) => void
  uploadError: string | null
  onUploadError: (message: string | null) => void
}) {
  const { selectDocuments, selectKnowledgeBank } = useWorkspaceNavigation()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const [isDragOver, setIsDragOver] = useState(false)
  const [ingestingDocumentId, setIngestingDocumentId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolderName, setNewFolderName] = useState<string | null>(null)

  const documentsQuery = useQuery({
    queryKey: ['documents'],
    queryFn: listDocuments,
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      return docs.some((d) => d.status === 'uploaded' || d.status === 'processing') ? 8000 : false
    },
  })
  const foldersQuery = useQuery({
    queryKey: ['documentFolders', matterId ?? 'general'],
    queryFn: () => listDocumentFolders(matterId),
  })
  const knowledgeEntriesQuery = useQuery({
    queryKey: ['kbEntries'],
    queryFn: () => listKnowledgeBankEntries(),
  })

  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const knowledgeEntries = useMemo(
    () => knowledgeEntriesQuery.data ?? [],
    [knowledgeEntriesQuery.data],
  )
  const matterDocuments = useMemo(
    () => (documentsQuery.data ?? []).filter((d) => (d.matterId ?? null) === matterId),
    [documentsQuery.data, matterId],
  )
  const activeFolder = folders.find((f) => f.id === folderId) ?? null
  // If the open folder was deleted elsewhere, fall back to the root.
  useEffect(() => {
    if (folderId && foldersQuery.isSuccess && !activeFolder) onFolderChange(null)
  }, [folderId, foldersQuery.isSuccess, activeFolder, onFolderChange])

  const visibleDocuments = matterDocuments.filter((d) => (d.folderId ?? null) === (activeFolder?.id ?? null))
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of matterDocuments) {
      if (d.folderId) counts.set(d.folderId, (counts.get(d.folderId) ?? 0) + 1)
    }
    return counts
  }, [matterDocuments])

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

  const upload = useDocumentUpload(matterId, activeFolder?.id ?? null)
  const error =
    mutationError ??
    uploadError ??
    documentsQuery.error?.message ??
    foldersQuery.error?.message ??
    null

  function refreshDocuments() {
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['kbEntries'] })
  }
  function refreshFolders() {
    queryClient.invalidateQueries({ queryKey: ['documentFolders'] })
    queryClient.invalidateQueries({ queryKey: ['documents'] })
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
  const moveMutation = useMutation({
    mutationFn: ({ id, folderId: target }: { id: string; folderId: string | null }) =>
      moveDocumentToFolder(id, target),
    onSuccess: refreshDocuments,
    onError: (err) => setMutationError(getErrorMessage(err)),
  })
  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createDocumentFolder(name, matterId),
    onSuccess: () => {
      setNewFolderName(null)
      setMutationError(null)
      refreshFolders()
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })
  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameDocumentFolder(id, name),
    onSuccess: () => {
      setRenamingFolderId(null)
      setMutationError(null)
      refreshFolders()
    },
    onError: (err) => setMutationError(getErrorMessage(err)),
  })
  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteDocumentFolder(id),
    onSuccess: (_, id) => {
      if (folderId === id) onFolderChange(null)
      setMutationError(null)
      refreshFolders()
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
    if (!window.confirm(`Delete ${document.filename}? This removes the uploaded document and its searchable chunks.`)) return
    deleteMutation.mutate(document.id)
  }

  function handleDeleteFolder(folder: DocumentFolder) {
    if (deleteFolderMutation.isPending) return
    const count = folderCounts.get(folder.id) ?? 0
    const detail = count > 0 ? ` Its ${count} ${count === 1 ? 'document moves' : 'documents move'} back to the matter's main list.` : ''
    if (!window.confirm(`Delete folder "${folder.name}"?${detail}`)) return
    deleteFolderMutation.mutate(folder.id)
  }

  const inlineInputClass =
    'h-8 min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-neutral-500'

  return (
    <div className="pt-4">
      {error && <ErrorBanner className="mb-3" message={error} onDismiss={() => { setMutationError(null); onUploadError(null) }} />}

      {/* Folder bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Folder" className="flex min-w-0 items-center gap-1 text-sm text-neutral-600">
          <button
            className={activeFolder ? 'underline-offset-2 hover:underline' : 'font-medium text-neutral-900'}
            onClick={() => onFolderChange(null)}
            type="button"
          >
            All documents
          </button>
          {activeFolder && (
            <>
              <ChevronRight size={14} className="shrink-0 text-neutral-400" />
              <span className="truncate font-medium text-neutral-900">{activeFolder.name}</span>
            </>
          )}
        </nav>
        {!activeFolder && (
          <Button size="sm" variant="secondary" className="border border-neutral-200" onClick={() => setNewFolderName('')}>
            <FolderPlus size={14} />
            New folder
          </Button>
        )}
      </div>

      {newFolderName !== null && (
        <form
          className="mb-3 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newFolderName.trim()
            if (name) createFolderMutation.mutate(name)
          }}
        >
          <Folder size={16} className="mx-2 shrink-0 text-neutral-500" />
          <input
            aria-label="New folder name"
            autoFocus
            className={inlineInputClass}
            maxLength={120}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNewFolderName(null)}
            placeholder="Folder name"
            value={newFolderName}
          />
          <Button aria-label="Create folder" disabled={!newFolderName.trim() || createFolderMutation.isPending} size="icon" type="submit" variant="ghost">
            <Check size={14} />
          </Button>
          <Button aria-label="Cancel" onClick={() => setNewFolderName(null)} size="icon" variant="ghost">
            <X size={14} />
          </Button>
        </form>
      )}

      {/* Drop zone */}
      <label
        className={`mb-4 flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-colors ${
          isDragOver ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
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
        <UploadCloud size={20} className={isDragOver ? 'text-neutral-900' : 'text-neutral-400'} />
        <span className="text-sm text-neutral-600">
          {upload.isPending
            ? 'Uploading…'
            : isDragOver
              ? 'Drop to upload'
              : `Drop a PDF or DOCX${activeFolder ? ` into “${activeFolder.name}”` : ''}, or click to browse`}
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

      <div className="space-y-2">
        {/* Folders (root view only; folders are one level deep) */}
        {!activeFolder &&
          folders.map((folder) => (
            <article
              key={folder.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 hover:border-neutral-300 hover:bg-neutral-50/50"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
                <Folder size={16} />
              </div>
              {renamingFolderId === folder.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const name = renameValue.trim()
                    if (name) renameFolderMutation.mutate({ id: folder.id, name })
                  }}
                >
                  <input
                    aria-label="Folder name"
                    autoFocus
                    className={inlineInputClass}
                    maxLength={120}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setRenamingFolderId(null)}
                    value={renameValue}
                  />
                  <Button aria-label="Save folder name" disabled={!renameValue.trim() || renameFolderMutation.isPending} size="icon" type="submit" variant="ghost">
                    <Check size={14} />
                  </Button>
                  <Button aria-label="Cancel rename" onClick={() => setRenamingFolderId(null)} size="icon" variant="ghost">
                    <X size={14} />
                  </Button>
                </form>
              ) : (
                <button className="min-w-0 flex-1 text-left" onClick={() => onFolderChange(folder.id)} type="button">
                  <span className="block truncate text-sm font-medium text-neutral-900">{folder.name}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    {folderCounts.get(folder.id) ?? 0} {(folderCounts.get(folder.id) ?? 0) === 1 ? 'document' : 'documents'}
                  </span>
                </button>
              )}
              {folder.canManage && renamingFolderId !== folder.id && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    aria-label={`Rename folder ${folder.name}`}
                    onClick={() => {
                      setRenamingFolderId(folder.id)
                      setRenameValue(folder.name)
                    }}
                    size="icon"
                    title="Rename folder"
                    variant="ghost"
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    aria-label={`Delete folder ${folder.name}`}
                    disabled={deleteFolderMutation.isPending}
                    onClick={() => handleDeleteFolder(folder)}
                    size="icon"
                    title="Delete folder"
                    variant="danger"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </article>
          ))}

        {visibleDocuments.map((document) => {
          const knowledgeEntry = knowledgeEntries.find((entry) => entry.sourceDocumentId === document.id)
          const isGenerating = ingestingDocumentId === document.id
          const isDeleting = deleteMutation.isPending && deleteMutation.variables === document.id
          return (
            <article
              key={document.id}
              className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-3 transition-colors hover:border-neutral-300 hover:bg-neutral-50/50 sm:flex-row sm:items-start"
            >
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
                <FileText size={16} />
              </div>
              <div className="min-w-0 flex-1">
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
                        <Check size={14} />
                      </Button>
                      <Button aria-label="Cancel rename" onClick={() => setRenamingDocumentId(null)} size="icon" variant="ghost">
                        <X size={14} />
                      </Button>
                    </form>
                  ) : (
                    <h3 className="truncate text-sm font-medium text-neutral-900">{document.filename}</h3>
                  )}
                  <StatusBadge
                    tone={document.status === 'ready' ? 'success' : document.status === 'failed' ? 'danger' : 'warning'}
                  >
                    {document.status}
                  </StatusBadge>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {document.chunkCount} {document.chunkCount === 1 ? 'chunk' : 'chunks'} · Uploaded {formatDate(document.createdAt)}
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
                {document.errorMessage && <div className="mt-2 text-xs text-red-600">{document.errorMessage}</div>}
                {knowledgeEntry?.errorMessage && (
                  <div className="mt-2 text-xs text-red-600">Summary error: {knowledgeEntry.errorMessage}</div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Button onClick={() => selectDocuments(document.id)} size="sm" variant="secondary">
                  <Eye size={14} />
                  Review
                </Button>
                {knowledgeEntry?.status === 'ready' ? (
                  <Button onClick={() => selectKnowledgeBank(knowledgeEntry.id)} size="sm" variant="secondary">
                    <BookOpen size={14} />
                    Open Knowledge Bank
                  </Button>
                ) : knowledgeEntry?.status === 'processing' ? (
                  <Button disabled size="sm" title="Summary is being generated" variant="secondary">
                    <BookOpen size={14} />
                    Summarising...
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
                    variant="secondary"
                  >
                    <BookOpen size={14} />
                    {isGenerating ? 'Queuing...' : knowledgeEntry?.status === 'failed' ? 'Retry summary' : 'Add to Knowledge Bank'}
                  </Button>
                ) : null}
                {document.canManage && folders.length > 0 && (
                  <select
                    aria-label={`Folder for ${document.filename}`}
                    className="h-8 max-w-40 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-700"
                    onChange={(e) => moveMutation.mutate({ id: document.id, folderId: e.target.value || null })}
                    value={document.folderId ?? ''}
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
                {document.canManage && renamingDocumentId !== document.id && (
                  <Button
                    onClick={() => {
                      setRenamingDocumentId(document.id)
                      setRenameValue(document.filename)
                      setMutationError(null)
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    <Pencil size={14} />
                    Rename
                  </Button>
                )}
                {document.canManage && (
                  <Button disabled={isDeleting || isGenerating} onClick={() => handleDeleteDocument(document)} size="sm" variant="danger">
                    <Trash2 size={14} />
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </Button>
                )}
              </div>
            </article>
          )
        })}

        {visibleDocuments.length === 0 && (activeFolder || folders.length === 0) && (
          <div className="rounded-lg border border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500">
            {activeFolder ? 'This folder is empty.' : 'No documents yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}
