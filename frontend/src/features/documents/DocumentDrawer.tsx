import { useEffect, useState } from 'react'
import { ArrowLeft, Download, FileText, LoaderCircle, Send, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createDocumentComment,
  deleteDocumentComment,
  fetchDocumentFile,
  listDocumentComments,
} from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import type { CurrentUser, DocumentComment, WorkspaceDocument } from '../../shared/types/workspace'
import { Button } from '../../shared/ui/Button'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { StatusBadge } from '../../shared/ui/StatusBadge'

type DocumentDrawerProps = {
  currentUser: CurrentUser | null
  document: WorkspaceDocument
  onClose: () => void
}

export function DocumentDrawer({ currentUser, document, onClose }: DocumentDrawerProps) {
  const queryClient = useQueryClient()
  const queryKey = ['documentComments', document.id]
  const [content, setContent] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const isPdf =
    document.contentType === 'application/pdf' ||
    document.filename.toLowerCase().endsWith('.pdf')

  useEffect(() => {
    if (!isPdf) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    void fetchDocumentFile(document.id, { signal: controller.signal })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setFileUrl(objectUrl)
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setFileError(getErrorMessage(error, 'Could not load document preview'))
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [document.id, isPdf])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => listDocumentComments(document.id),
  })

  const createMutation = useMutation({
    mutationFn: (comment: string) => createDocumentComment(document.id, comment),
    onMutate: async (comment) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<DocumentComment[]>(queryKey) ?? []
      const optimisticId = `optimistic-${Date.now()}`
      queryClient.setQueryData<DocumentComment[]>(queryKey, [
        ...previous,
        {
          id: optimisticId,
          documentId: document.id,
          userId: currentUser?.id ?? 'current-user',
          content: comment,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          canDelete: false,
          author: {
            id: currentUser?.id ?? 'current-user',
            fullName: currentUser?.fullName,
            email: currentUser?.email ?? 'You',
          },
        },
      ])
      setContent('')
      setMutationError(null)
      return { previous, optimisticId }
    },
    onSuccess: (created, _comment, context) => {
      queryClient.setQueryData<DocumentComment[]>(queryKey, (current = []) =>
        current.map((comment) => comment.id === context.optimisticId ? created : comment),
      )
    },
    onError: (error, _comment, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous)
      setMutationError(getErrorMessage(error))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDocumentComment,
    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<DocumentComment[]>(queryKey) ?? []
      queryClient.setQueryData<DocumentComment[]>(
        queryKey,
        previous.filter((comment) => comment.id !== commentId),
      )
      setMutationError(null)
      return { previous }
    },
    onError: (error, _commentId, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous)
      setMutationError(getErrorMessage(error))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  function submitComment() {
    const trimmed = content.trim()
    if (!trimmed || createMutation.isPending) return
    createMutation.mutate(trimmed)
  }

  async function downloadDocument() {
    if (isDownloading) return
    setIsDownloading(true)
    setFileError(null)
    try {
      const blob = await fetchDocumentFile(document.id, { download: true })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = objectUrl
      anchor.download = document.filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
    } catch (error) {
      setFileError(getErrorMessage(error, 'Could not download document'))
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <section
      aria-label={`Review ${document.filename}`}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-4 py-3 sm:px-5">
        <Button onClick={onClose} size="sm" variant="ghost">
          <ArrowLeft size={15} />
          All documents
        </Button>
        <div className="hidden h-6 w-px bg-neutral-200 sm:block" />
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600">
          <FileText size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-neutral-900">
              {document.filename}
            </h2>
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
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {document.chunkCount} searchable chunks
          </p>
        </div>
        <Button
          disabled={isDownloading}
          onClick={() => void downloadDocument()}
          size="sm"
          variant="ghost"
        >
          {isDownloading ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
          <span className="hidden sm:inline">{isDownloading ? 'Downloading' : 'Download'}</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-[55dvh] flex-1 bg-neutral-100 lg:min-h-0">
          {isPdf && fileUrl ? (
            <iframe
              className="h-full w-full border-0"
              src={fileUrl}
              title={document.filename}
            />
          ) : isPdf && fileError ? (
            <div className="grid h-full place-items-center p-8 text-center text-sm text-red-700">
              {fileError}
            </div>
          ) : isPdf ? (
            <div className="grid h-full place-items-center text-neutral-500">
              <LoaderCircle className="animate-spin" size={22} />
            </div>
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <FileText className="mx-auto text-neutral-400" size={36} />
                <h3 className="mt-3 text-sm font-semibold text-neutral-900">
                  Preview not available
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  DOCX preview is not supported in the browser yet.
                </p>
                <Button
                  className="mt-4"
                  disabled={isDownloading}
                  onClick={() => void downloadDocument()}
                  size="sm"
                  variant="primary"
                >
                  <Download size={14} />
                  {isDownloading ? 'Downloading...' : 'Download document'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <section className="flex min-h-[320px] shrink-0 flex-col border-t border-neutral-200 bg-white lg:h-full lg:w-[340px] lg:min-h-0 lg:border-l lg:border-t-0 xl:w-[390px]">
          <div className="shrink-0 border-b border-neutral-100 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-neutral-900">Matter comments</h3>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Visible to colleagues who can access this document.
            </p>
          </div>

          <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            {commentsQuery.isLoading ? (
              <p className="text-xs text-neutral-500">Loading comments...</p>
            ) : commentsQuery.isError ? (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {getErrorMessage(commentsQuery.error)}
              </div>
            ) : (commentsQuery.data ?? []).length === 0 ? (
              <p className="py-4 text-center text-xs text-neutral-500">
                No comments yet. Be the first to leave review context.
              </p>
            ) : (
              <div className="space-y-4">
                {(commentsQuery.data ?? []).map((comment) => (
                  <article key={comment.id} className="group flex gap-2.5">
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">
                      {initials(comment.author.fullName || comment.author.email)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-neutral-900">
                          {comment.author.fullName || comment.author.email}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                        {comment.canDelete && (
                          <button
                            aria-label="Delete comment"
                            className="ml-auto rounded p-1 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(comment.id)}
                            type="button"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <MarkdownContent
                        className="mt-1 text-xs leading-5 text-neutral-700"
                        markdown={comment.content}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-neutral-100 p-3 sm:px-5">
            {mutationError && (
              <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {mutationError}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                className="min-h-10 max-h-28 flex-1 resize-y rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
                maxLength={3000}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    submitComment()
                  }
                }}
                placeholder="Add review context... (Cmd/Ctrl+Enter to post)"
                value={content}
              />
              <Button
                aria-label="Post comment"
                disabled={!content.trim() || createMutation.isPending}
                onClick={submitComment}
                size="icon"
                variant="primary"
              >
                <Send size={15} />
              </Button>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'recently'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}
