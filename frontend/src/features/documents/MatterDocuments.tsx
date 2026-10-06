import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronRight,
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
import { formatDateTime } from '../../shared/lib/dates'
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
  search,
}: {
  matterId: string | null
  folderId: string | null
  onFolderChange: (folderId: string | null) => void
  uploadError: string | null
  onUploadError: (message: string | null) => void
  /** Filters folders and documents by name. */
  search: string
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

  const needle = search.trim().toLowerCase()
  const visibleDocuments = matterDocuments.filter(
    (d) =>
      (d.folderId ?? null) === (activeFolder?.id ?? null) &&
      (!needle || d.filename.toLowerCase().includes(needle)),
  )
  const visibleFolders = folders.filter((f) => !needle || f.name.toLowerCase().includes(needle))
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
    if (!window.confirm(`Delete ${document.filename}? This removes the file and its search index. LexChat will no longer cite it.`)) return
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
    'h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-neutral-500'
  const outlineButton =
    'h-10 rounded-lg border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50'
  const sectionHeading =
    'flex items-center gap-2.5 border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900'
  const rowClass =
    'grid grid-cols-[44px_minmax(0,1fr)] items-start gap-x-4 gap-y-3 px-1 py-5 transition-colors hover:bg-black/[0.025] md:grid-cols-[44px_minmax(0,1fr)_auto]'
  const tile = 'grid h-11 w-11 place-items-center rounded-lg bg-blue-50 text-[#1e3a8a]'

  return (
    <div className="mt-6">
      {error && <ErrorBanner className="mb-4" message={error} onDismiss={() => { setMutationError(null); onUploadError(null) }} />}

      {/* Where am I + folder creation */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Folder" className="flex min-w-0 items-center gap-1.5 text-body text-neutral-500">
          <button
            className={activeFolder ? 'hover:text-neutral-800' : 'text-neutral-900'}
            onClick={() => onFolderChange(null)}
            type="button"
          >
            All documents
          </button>
          {activeFolder && (
            <>
              <ChevronRight size={14} className="shrink-0 text-neutral-400" />
              <span className="truncate text-neutral-900">{activeFolder.name}</span>
            </>
          )}
        </nav>
        {!activeFolder && (
          <button className={outlineButton} onClick={() => setNewFolderName('')} type="button">
            <span className="inline-flex items-center gap-2">
              <FolderPlus size={15} />
              New folder
            </span>
          </button>
        )}
      </div>

      {newFolderName !== null && (
        <form
          className="mb-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newFolderName.trim()
            if (name) createFolderMutation.mutate(name)
          }}
        >
          <span className={tile}>
            <Folder size={18} />
          </span>
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
            <Check size={16} />
          </Button>
          <Button aria-label="Cancel" onClick={() => setNewFolderName(null)} size="icon" variant="ghost">
            <X size={16} />
          </Button>
        </form>
      )}

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

      {/* Folders (root only; one level deep) */}
      {!activeFolder && visibleFolders.length > 0 && (
        <section className="mt-9 first:mt-6">
          <h2 className={sectionHeading}>
            <Folder size={18} className="text-neutral-600" />
            Folders
            <span className="font-sans text-sm text-neutral-400">{visibleFolders.length}</span>
          </h2>
          <div className="divide-y divide-neutral-200/70">
            {visibleFolders.map((folder) => {
              const count = folderCounts.get(folder.id) ?? 0
              return (
                <article key={folder.id} className={rowClass}>
                  <span className={tile}>
                    <Folder size={18} />
                  </span>
                  {renamingFolderId === folder.id ? (
                    <form
                      className="col-span-1 flex min-w-0 items-center gap-1 md:col-span-2"
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
                        <Check size={16} />
                      </Button>
                      <Button aria-label="Cancel rename" onClick={() => setRenamingFolderId(null)} size="icon" variant="ghost">
                        <X size={16} />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <button className="min-w-0 text-left" onClick={() => onFolderChange(folder.id)} type="button">
                        <h3 className="truncate text-base font-medium leading-snug text-neutral-900">{folder.name}</h3>
                        <p className="mt-1 text-sm text-neutral-500">
                          {count} {count === 1 ? 'document' : 'documents'}
                        </p>
                      </button>
                      {folder.canManage && (
                        <div className="flex items-center gap-1 md:justify-end">
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
                            <Pencil size={15} />
                          </Button>
                          <Button
                            aria-label={`Delete folder ${folder.name}`}
                            disabled={deleteFolderMutation.isPending}
                            onClick={() => handleDeleteFolder(folder)}
                            size="icon"
                            title="Delete folder"
                            variant="danger"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* Documents */}
      {visibleDocuments.length > 0 && (
        <section className="mt-9">
          <h2 className={sectionHeading}>
            <FileText size={18} className="text-neutral-600" />
            {activeFolder ? activeFolder.name : 'Documents'}
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
                    {document.canManage && folders.length > 0 && (
                      <select
                        aria-label={`Folder for ${document.filename}`}
                        className="h-8 max-w-36 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-700"
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

      {visibleDocuments.length === 0 && (activeFolder || visibleFolders.length === 0) && (
        <div className="mt-6 grid min-h-40 place-items-center rounded-[14px] border border-dashed border-black/15 bg-white/50 p-6 text-center">
          <p className="text-sm text-neutral-500">
            {needle
              ? 'No documents match your search.'
              : activeFolder
                ? 'This folder is empty.'
                : 'No documents yet. Drop a file above to add one.'}
          </p>
        </div>
      )}
    </div>
  )
}

