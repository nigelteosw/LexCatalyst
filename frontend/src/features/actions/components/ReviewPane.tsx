import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Worker, Viewer } from '@react-pdf-viewer/core'
import type { DocumentLoadEvent } from '@react-pdf-viewer/core'
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout'
import {
  highlightPlugin,
  Trigger,
  type HighlightArea,
  type RenderHighlightContentProps,
  type RenderHighlightTargetProps,
  type RenderHighlightsProps,
} from '@react-pdf-viewer/highlight'
import '@react-pdf-viewer/core/lib/styles/index.css'
import '@react-pdf-viewer/default-layout/lib/styles/index.css'
import '@react-pdf-viewer/highlight/lib/styles/index.css'
import {
  createDocumentComment,
  createReviewAnnotation,
  createReviewHandoff,
  deleteReviewHandoff,
  exportAnnotatedPdf,
  fetchDocumentFile,
  getReviewHandoff,
  listDocumentComments,
  listReviewHandoffsForAction,
  rejectReviewHandoff,
  updateReviewHandoff,
  uploadDocument,
} from '../../../shared/api/api'
import { getErrorMessage } from '../../../shared/lib/errors'
import { MarkdownContent } from '../../../shared/ui/MarkdownContent'
import type {
  ActionItem,
  CurrentUser,
  ReviewAnnotation,
  ReviewHandoff,
} from '../../../shared/types/workspace'
import { AlertTriangle, CheckCircle2, Download, FileText, Highlighter, Lightbulb, Loader2, RotateCcw, Strikethrough, Upload, X } from 'lucide-react'
import { AnnotationRail } from './AnnotationRail'
import { SuggestionEditor } from './SuggestionEditor'

const PDFJS_WORKER_URL = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString()

type Props = {
  action: ActionItem
  currentUser: CurrentUser | null
  onActionStateChange: (patch: Partial<ActionItem>) => void
}

export function ReviewPane({ action, currentUser, onActionStateChange }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Which round is being viewed; null means "the latest".
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Set when the PDF uploaded fine but creating the handoff failed, so the
  // user can retry without re-uploading.
  const [pendingDocumentId, setPendingDocumentId] = useState<string | null>(null)

  const handoffsQuery = useQuery({
    queryKey: ['handoffs', 'action', action.id],
    queryFn: () => listReviewHandoffsForAction(action.id),
    staleTime: 5_000,
  })

  // Newest first from the API.
  const rounds = handoffsQuery.data ?? []
  const latest = rounds[0]
  const selected = rounds.find((r) => r.id === selectedId) ?? latest

  const detailQuery = useQuery({
    queryKey: ['handoffs', selected?.id],
    queryFn: () => getReviewHandoff(selected!.id),
    enabled: !!selected,
    staleTime: 5_000,
  })

  const handoff: ReviewHandoff | undefined = detailQuery.data ?? selected

  function invalidateRounds() {
    queryClient.invalidateQueries({ queryKey: ['handoffs', 'action', action.id] })
    queryClient.invalidateQueries({ queryKey: ['actions'] })
  }

  const submitMutation = useMutation({
    mutationFn: (documentId: string) =>
      createReviewHandoff({
        documentId,
        actionId: action.id,
        matterId: action.matterId ?? null,
      }),
    onSuccess: (created) => {
      setPendingDocumentId(null)
      setError(null)
      setSelectedId(null)
      onActionStateChange({ status: 'review', activeHandoffId: created.id })
      invalidateRounds()
    },
    onError: (e, documentId) => {
      setPendingDocumentId(documentId)
      setError(getErrorMessage(e))
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const doc = await uploadDocument(file)
      // The upload endpoint returns 200 with status 'failed' when storing the
      // file fails; surface that reason instead of submitting a document with
      // no stored PDF.
      if (doc.status === 'failed') {
        throw new Error(
          doc.errorMessage
            ? `Upload failed: ${doc.errorMessage}`
            : 'Upload failed: the PDF could not be stored. Please try again.',
        )
      }
      return doc
    },
    onSuccess: (doc) => submitMutation.mutate(doc.id),
    onError: (e) => setError(getErrorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReviewHandoff(id),
    onSuccess: (_result, id) => {
      if (id === action.activeHandoffId) {
        onActionStateChange({ status: 'in_progress', activeHandoffId: null })
      }
      setSelectedId(null)
      invalidateRounds()
    },
    onError: (e) => setError(getErrorMessage(e)),
  })

  const busy = uploadMutation.isPending || submitMutation.isPending

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    setPendingDocumentId(null)
    uploadMutation.mutate(file)
  }

  if (handoffsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-[#9a9a94]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (handoffsQuery.isError) {
    return (
      <div className="p-5">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {getErrorMessage(handoffsQuery.error, 'Could not load review rounds')}
        </p>
        <button
          className="mt-3 rounded-lg border border-black/10 px-3 py-1.5 text-xs"
          onClick={() => handoffsQuery.refetch()}
          type="button"
        >
          Retry
        </button>
      </div>
    )
  }

  const uploadControls = (
    <>
      <input
        ref={fileInputRef}
        accept=".pdf"
        className="hidden"
        onChange={handleFileChange}
        type="file"
      />
      {pendingDocumentId ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => submitMutation.mutate(pendingDocumentId)}
            type="button"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Retry submission
          </button>
          <button
            className="rounded-lg border border-black/10 px-3 py-2 text-xs text-[#5a5a56] disabled:opacity-50"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Choose a different PDF
          </button>
        </div>
      ) : (
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploadMutation.isPending
            ? 'Uploading…'
            : submitMutation.isPending
              ? 'Submitting…'
              : 'Choose PDF'}
        </button>
      )}
    </>
  )

  if (!handoff) {
    return (
      <div className="space-y-4 p-5">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <div className="rounded-xl border border-dashed border-black/15 bg-[#f9f8f5] p-8 text-center">
          <FileText size={28} className="mx-auto mb-3 text-[#c4c3bc]" />
          <p className="mb-1 text-sm font-medium text-[#0f0f0f]">Upload your review PDF</p>
          <p className="mb-4 text-xs text-[#9a9a94]">
            Upload your completed review for the senior to annotate and redline.
          </p>
          {uploadControls}
        </div>
      </div>
    )
  }

  // A revised draft can be submitted once the latest round has been returned.
  const canResubmit = latest?.status === 'returned'

  return (
    <div className="flex h-full flex-col">
      {(rounds.length > 1 || canResubmit || error) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-black/10 bg-[#fafaf8] px-4 py-2">
          {rounds.length > 1 && (
            <label className="flex items-center gap-1.5 text-[10.5px] text-[#5a5a56]">
              Round
              <select
                className="rounded-md border border-black/10 bg-white px-1.5 py-1 text-[10.5px]"
                onChange={(e) => setSelectedId(e.target.value === latest?.id ? null : e.target.value)}
                value={selected?.id ?? ''}
              >
                {rounds.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {rounds.length - i}
                    {i === 0 ? ' (latest)' : ''} · {roundStatusLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <span className="text-[10.5px] text-red-600">{error}</span>}
          {canResubmit && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10.5px] text-[#9a9a94]">Upload a revised PDF to start the next round.</span>
              {uploadControls}
            </div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <HandoffViewer
          key={handoff.id}
          handoff={handoff}
          isReviewer={handoff.canReview}
          canAnnotate={handoff.canAnnotate}
          currentUserId={currentUser?.id ?? null}
          onDelete={() => deleteMutation.mutate(handoff.id)}
          onActionStateChange={onActionStateChange}
          queryClient={queryClient}
        />
      </div>
    </div>
  )
}

/**
 * Absolute placement for a popover next to the selected text. The plugin gives the
 * selection region as page percentages, so the popover is anchored just below the
 * selection and flipped to hang from its right edge when the selection sits in the
 * right half of the page, which keeps it inside the viewer at page edges.
 */
function popoverStyle(region: HighlightArea): React.CSSProperties {
  const anchorRight = region.left + region.width / 2 > 50
  const top = Math.min(region.top + region.height + 0.5, 94)
  return anchorRight
    ? { position: 'absolute', zIndex: 50, top: `${top}%`, right: `${Math.max(100 - region.left - region.width, 0)}%` }
    : { position: 'absolute', zIndex: 50, top: `${top}%`, left: `${Math.min(region.left, 70)}%` }
}

// ---------------------------------------------------------------------------
// DocumentCommentThread — fallback for scanned PDFs (matter-wide comments)
// ---------------------------------------------------------------------------

function DocumentCommentThread({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['documentComments', documentId]
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const commentsQuery = useQuery({ queryKey, queryFn: () => listDocumentComments(documentId) })
  const postMutation = useMutation({
    mutationFn: (content: string) => createDocumentComment(documentId, content),
    onSuccess: () => {
      setDraft('')
      setError(null)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (e) => setError(getErrorMessage(e, 'Could not post comment')),
  })
  const comments = commentsQuery.data ?? []

  return (
    <div className="border-b border-black/10 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">Document comments</p>
      {commentsQuery.isError && (
        <p className="mt-1 text-[10.5px] text-red-600">
          {getErrorMessage(commentsQuery.error, 'Could not load comments')}
        </p>
      )}
      <div className="mt-1.5 space-y-1.5">
        {comments.map((c) => (
          <div key={c.id} className="rounded-md border border-black/5 bg-white p-2 text-[10.5px]">
            <span className="font-medium text-[#5a5a56]">{c.author.fullName ?? c.author.email}</span>
            <div className="text-[#5a5a56]">
              <MarkdownContent markdown={c.content} />
            </div>
          </div>
        ))}
        {comments.length === 0 && !commentsQuery.isLoading && (
          <p className="text-[10.5px] text-[#9a9a94]">No comments yet.</p>
        )}
      </div>
      <div className="mt-2">
        <textarea
          aria-label="New document comment"
          className="w-full resize-none rounded-lg border border-black/15 bg-white px-2 py-1.5 text-[11px] leading-4 outline-none focus:border-blue-400"
          placeholder="Comment on the document as a whole (e.g. “p. 3, para 2: wrong party”)"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {error && <p className="mt-1 text-[10px] text-red-600">{error} — your draft is kept.</p>}
        <button
          className="mt-1 rounded-lg bg-[#0f0f0f] px-3 py-1.5 text-[10.5px] font-medium text-white disabled:opacity-50"
          disabled={!draft.trim() || postMutation.isPending}
          onClick={() => postMutation.mutate(draft.trim())}
          type="button"
        >
          {postMutation.isPending ? 'Posting…' : error ? 'Retry' : 'Post comment'}
        </button>
      </div>
    </div>
  )
}

function roundStatusLabel(r: ReviewHandoff): string {
  switch (r.status) {
    case 'ready_for_review':
      return 'ready'
    case 'in_review':
      return 'in review'
    case 'completed':
      return 'completed'
    case 'returned':
      return r.returnReason ? 'rejected' : 'returned'
  }
}

// ---------------------------------------------------------------------------
// HandoffViewer — PDF + annotation rail
// ---------------------------------------------------------------------------

type ViewerProps = {
  handoff: ReviewHandoff
  isReviewer: boolean
  canAnnotate: boolean
  currentUserId: string | null
  onDelete: () => void
  onActionStateChange: (patch: Partial<ActionItem>) => void
  queryClient: ReturnType<typeof useQueryClient>
}

function HandoffViewer({
  handoff,
  isReviewer,
  canAnnotate,
  currentUserId,
  onDelete,
  onActionStateChange,
  queryClient,
}: ViewerProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileReloadKey, setFileReloadKey] = useState(0)
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [mobileTab, setMobileTab] = useState<'document' | 'annotations'>('document')
  // Card clicked in the rail; its mark is emphasised in the PDF.
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  // null = unknown (not loaded yet); false = scanned/image-only PDF with no
  // selectable text, so text-anchored annotation is impossible in this viewer.
  const [hasTextLayer, setHasTextLayer] = useState<boolean | null>(null)

  async function detectTextLayer(e: DocumentLoadEvent) {
    try {
      const pagesToCheck = Math.min(e.doc.numPages, 3)
      for (let i = 0; i < pagesToCheck; i++) {
        const page = await e.doc.getPage(i + 1)
        const content = await page.getTextContent()
        if (content.items.some((item) => item.str.trim().length > 0)) {
          setHasTextLayer(true)
          return
        }
      }
      setHasTextLayer(false)
    } catch {
      setHasTextLayer(null)
    }
  }

  // Build the current annotations list from the handoff (kept fresh by query)
  const annotations = handoff.annotations

  // Annotation saves keep the popover/editor open until the request succeeds,
  // so a failed save never loses the reviewer's text.
  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createReviewAnnotation>[1]) =>
      createReviewAnnotation(handoff.id, payload),
    onSuccess: () => {
      setAnnotationError(null)
      queryClient.invalidateQueries({ queryKey: ['handoffs', handoff.id] })
    },
    onError: (e) => setAnnotationError(getErrorMessage(e)),
  })

  // One error slot for the action strip; each lifecycle mutation sets it.
  const [actionError, setActionError] = useState<string | null>(null)
  function onLifecycleSettled(updated: ReviewHandoff) {
    setActionError(null)
    queryClient.setQueryData(['handoffs', handoff.id], updated)
    queryClient.invalidateQueries({ queryKey: ['handoffs', 'action'] })
  }

  const completeMutation = useMutation({
    mutationFn: () => updateReviewHandoff(handoff.id, { status: 'completed' }),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'done', activeHandoffId: null })
      onLifecycleSettled(updated)
    },
    onError: (e) => setActionError(getErrorMessage(e, 'Could not mark complete')),
  })

  const returnMutation = useMutation({
    mutationFn: () => updateReviewHandoff(handoff.id, { status: 'returned' }),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'in_progress' })
      onLifecycleSettled(updated)
    },
    onError: (e) => setActionError(getErrorMessage(e, 'Could not return for rework')),
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectReviewHandoff(handoff.id, reason),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'in_progress' })
      onLifecycleSettled(updated)
      setShowRejectModal(false)
    },
  })

  const exportMutation = useMutation({
    mutationFn: async () => {
      const blob = await exportAnnotatedPdf(handoff.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const filename = (handoff.documentFilename ?? 'review').replace(/\.pdf$/i, '') + '_annotated.pdf'
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    onSuccess: () => setActionError(null),
    onError: (e) => setActionError(getErrorMessage(e, 'Export failed')),
  })

  // A status change in flight blocks the other status changes.
  const lifecycleBusy =
    completeMutation.isPending || returnMutation.isPending || rejectMutation.isPending

  // Derived state for the action strip
  const isActive =
    handoff.status === 'ready_for_review' || handoff.status === 'in_review'
  const openCount = annotations.filter(
    (a) => a.status === 'open' || a.status === 'needs_rework',
  ).length
  const addressedCount = annotations.length - openCount
  const hasNeedsRework = annotations.some((a) => a.status === 'needs_rework')

  // --------------------------------------------------------------------------
  // Highlight plugin — selection popover + overlay rendering
  // --------------------------------------------------------------------------

  function renderHighlightTarget({
    highlightAreas,
    selectedText,
    selectionRegion,
    cancel,
    toggle,
  }: RenderHighlightTargetProps) {
    if (!canAnnotate) return <></>

    function post(kind: 'highlight' | 'strike') {
      if (createMutation.isPending) return
      const pageNo = (highlightAreas[0]?.pageIndex ?? 0) + 1
      createMutation
        .mutateAsync({
          documentId: handoff.documentId,
          pageNo,
          kind,
          anchorQuote: selectedText.trim().slice(0, 20_000),
          anchorRects: highlightAreas,
        })
        .then(() => cancel())
        .catch(() => {
          /* error is shown in the popover; selection stays for retry */
        })
    }

    return (
      <div
        aria-label="Annotate selection"
        className="z-50 flex flex-col gap-1 rounded-lg border border-black/10 bg-white px-1 py-1 shadow-lg"
        role="toolbar"
        style={popoverStyle(selectionRegion)}
      >
        {annotationError && (
          <p className="max-w-56 px-1.5 text-[10px] text-red-600">{annotationError} — try again.</p>
        )}
        <div className="flex items-center gap-0.5">
        <ToolbarButton
          icon={<Highlighter size={13} />}
          label="Highlight"
          className="text-amber-600 hover:bg-amber-50"
          onClick={() => post('highlight')}
        />
        <ToolbarButton
          icon={<Strikethrough size={13} />}
          label="Strike"
          className="text-red-500 hover:bg-red-50"
          onClick={() => post('strike')}
        />
        <div className="mx-0.5 h-4 w-px bg-black/10" />
        <ToolbarButton
          icon={<Lightbulb size={13} />}
          label="Suggest…"
          className="text-blue-600 hover:bg-blue-50"
          onClick={toggle}
        />
        {createMutation.isPending && <Loader2 size={12} className="ml-1 animate-spin text-[#9a9a94]" />}
        </div>
      </div>
    )
  }

  function renderHighlightContent({
    highlightAreas,
    selectedText,
    selectionRegion,
    cancel,
  }: RenderHighlightContentProps) {
    if (!canAnnotate) return <></>

    function save(suggestedText: string, note: string) {
      if (createMutation.isPending) return
      const pageNo = (highlightAreas[0]?.pageIndex ?? 0) + 1
      createMutation
        .mutateAsync({
          documentId: handoff.documentId,
          pageNo,
          kind: 'suggestion',
          anchorQuote: selectedText.trim().slice(0, 20_000),
          anchorRects: highlightAreas,
          suggestedText,
          note: note || undefined,
        })
        .then(() => cancel())
        .catch(() => {
          /* editor stays open with the draft; error shown inside it */
        })
    }

    return (
      <div style={popoverStyle(selectionRegion)}>
        <SuggestionEditor
          selectedText={selectedText}
          onSave={save}
          onCancel={() => {
            setAnnotationError(null)
            cancel()
          }}
          isSaving={createMutation.isPending}
          error={annotationError}
        />
      </div>
    )
  }

  function renderHighlights({ pageIndex, getCssProperties, rotation }: RenderHighlightsProps) {
    // A selection can span pages, so pick annotations by where their rectangles
    // actually are. pageNo is only the first page, used for rail grouping.
    const pageAnnotations = annotations.filter((a) =>
      a.anchorRects.some((r) => r.pageIndex === pageIndex),
    )
    if (pageAnnotations.length === 0) return <></>

    return (
      <>
        {pageAnnotations.flatMap((annotation) =>
          annotation.anchorRects
            .filter((r) => r.pageIndex === pageIndex)
            .map((rect, i) => {
              const css = getCssProperties(rect, rotation)
              const selected = annotation.id === selectedAnnotationId
              const emphasis: React.CSSProperties = selected
                ? { outline: '2px solid #4a3db0', outlineOffset: 1, zIndex: 2 }
                : {}
              if (annotation.kind === 'strike') {
                // Render a wrapper at the exact text rect position, then draw the
                // strike line as a child centered vertically inside it.
                // Do NOT override top/height from getCssProperties — those encode
                // the actual page coordinates of the selected text.
                return (
                  <div key={`${annotation.id}-${i}`} style={{ ...css, background: 'transparent', ...emphasis }}>
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: 0,
                        right: 0,
                        height: '2px',
                        background: 'rgba(239, 68, 68, 0.85)',
                        transform: 'translateY(-50%)',
                      }}
                    />
                  </div>
                )
              }
              return (
                <div
                  key={`${annotation.id}-${i}`}
                  style={{
                    ...css,
                    mixBlendMode: 'multiply',
                    ...overlayStyle(annotation.kind),
                    ...emphasis,
                  }}
                />
              )
            }),
        )}
      </>
    )
  }

  // These plugin factories use React hooks internally and must be invoked
  // unconditionally on every render, just like custom hooks.
  const highlightPluginInstance = highlightPlugin({
    renderHighlightTarget,
    renderHighlightContent,
    renderHighlights,
    trigger: Trigger.TextSelection,
  })
  const defaultLayoutInstance = defaultLayoutPlugin()

  // PDF fetch
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    // HandoffViewer is keyed by handoff id, so a different document always
    // mounts fresh; the abort below discards any load that is still in flight.
    // Pre-attach a no-op catch so the browser marks this promise as "handled"
    // before any microtask runs. Without this, React 18 StrictMode's synchronous
    // effect double-invoke causes the AbortError to be logged as uncaught.
    const p = fetchDocumentFile(handoff.documentId, { signal: controller.signal })
    p.catch(() => {})
    void p
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setFileUrl(objectUrl)
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return
        setFileError(getErrorMessage(err, 'Could not load PDF'))
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [handoff.documentId, fileReloadKey])

  function jumpToAnnotation(annotationId: string, area: HighlightArea | null) {
    setSelectedAnnotationId(annotationId)
    if (!area) return
    setMobileTab('document')
    requestAnimationFrame(() => highlightPluginInstance.jumpToHighlightArea(area))
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#0f0f0f]">
            {handoff.documentFilename ?? 'Review document'}
          </p>
          <p className="text-[10.5px] text-[#9a9a94]">
            Submitted by {handoff.submitter?.fullName ?? handoff.submitter?.email ?? '—'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <HandoffStatusPill status={handoff.status} returnReason={handoff.returnReason} />
          {handoff.canRemove && (
            <button
              className="rounded-lg px-2.5 py-1.5 text-[10.5px] text-[#9a9a94] hover:bg-[#f4f3ef] hover:text-red-600"
              onClick={onDelete}
              type="button"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Action strip */}
      {(isReviewer && isActive) || annotations.length > 0 ? (
        <div className="flex flex-col gap-2 border-b border-black/10 bg-[#fafaf8] px-4 py-2 sm:flex-row sm:items-center">
          {annotations.length > 0 && isActive && (
            <span className="text-[10.5px] text-[#9a9a94]">
              {addressedCount} / {annotations.length} addressed
            </span>
          )}
          {actionError && (
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-red-600">
              {actionError}
              <button
                className="rounded px-1 text-[#9a9a94] hover:bg-black/5"
                onClick={() => setActionError(null)}
                type="button"
                aria-label="Dismiss"
              >
                <X size={10} />
              </button>
            </span>
          )}
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto sm:gap-2">
            {/* Export — available whenever there are annotations */}
            {annotations.length > 0 && (
              <button
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium text-[#5a5a56] hover:bg-[#f4f3ef] disabled:opacity-40"
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
                type="button"
              >
                {exportMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Export PDF
              </button>
            )}
            {/* Reviewer controls — active rounds only */}
            {isReviewer && isActive && (
              <>
                <button
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!hasNeedsRework || lifecycleBusy}
                  onClick={() => returnMutation.mutate()}
                  title={!hasNeedsRework ? 'Mark at least one annotation as "Needs rework" first' : undefined}
                  type="button"
                >
                  <RotateCcw size={11} />
                  Return for rework
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                  disabled={lifecycleBusy}
                  onClick={() => setShowRejectModal(true)}
                  type="button"
                >
                  <AlertTriangle size={11} />
                  Reject draft
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-lg bg-[#1a6b4a] px-3 py-1.5 text-[10.5px] font-medium text-white hover:bg-[#155a3e] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={openCount > 0 || lifecycleBusy}
                  onClick={() => completeMutation.mutate()}
                  title={openCount > 0 ? 'Resolve all open annotations first' : undefined}
                  type="button"
                >
                  <CheckCircle2 size={11} />
                  Mark complete
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Scanned PDF banner */}
      {hasTextLayer === false && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            This PDF has no text layer (it looks scanned), so text cannot be selected for highlights,
            strikes or suggestions here. Leave document-level comments in the annotation panel instead.
          </span>
        </div>
      )}

      {/* Rejection banner */}
      {handoff.status === 'returned' && handoff.returnReason && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <span className="mr-1.5 text-[10.5px] font-semibold text-amber-700">Draft rejected:</span>
          <span className="text-xs text-amber-800">{handoff.returnReason}</span>
        </div>
      )}

      {/* Reject draft modal */}
      {showRejectModal && (
        <RejectModal
          isPending={rejectMutation.isPending}
          error={rejectMutation.isError ? getErrorMessage(rejectMutation.error) : null}
          onConfirm={(reason) => rejectMutation.mutate(reason)}
          onClose={() => setShowRejectModal(false)}
        />
      )}

      {/* Mobile sub-tabs: Document | Annotations */}
      <div className="flex shrink-0 items-center gap-1 border-b border-black/10 bg-white px-3 py-1.5 sm:hidden">
        <button
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            mobileTab === 'document' ? 'bg-[#0f0f0f] text-white' : 'text-[#5a5a56] hover:bg-[#f4f3ef]'
          }`}
          onClick={() => setMobileTab('document')}
          type="button"
        >
          Document
        </button>
        <button
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            mobileTab === 'annotations' ? 'bg-[#0f0f0f] text-white' : 'text-[#5a5a56] hover:bg-[#f4f3ef]'
          }`}
          onClick={() => setMobileTab('annotations')}
          type="button"
        >
          Annotations
          {annotations.length > 0 && (
            <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] ${
              mobileTab === 'annotations' ? 'bg-white/20 text-white' : 'bg-[#eeecff] text-[#4a3db0]'
            }`}>
              {annotations.length}
            </span>
          )}
        </button>
      </div>

      {/* Body: PDF viewer + rail */}
      <div className="flex min-h-0 flex-1">
        {/* PDF — hidden on mobile when viewing annotations */}
        <div className={`min-w-0 flex-1 overflow-hidden ${mobileTab === 'annotations' ? 'hidden sm:block' : ''}`}>
          {fileError ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-xs text-red-600">
              {fileError}
              <button
                className="rounded-lg border border-black/10 px-3 py-1.5 text-[11px] text-[#5a5a56]"
                onClick={() => {
                  setFileError(null)
                  setFileReloadKey((k) => k + 1)
                }}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : !fileUrl ? (
            <div className="flex items-center justify-center p-8 text-[#9a9a94]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : (
            <div style={{ height: 'calc(100dvh - 14rem)' }}>
              <Worker workerUrl={PDFJS_WORKER_URL}>
                <Viewer
                  fileUrl={fileUrl}
                  onDocumentLoad={(e) => void detectTextLayer(e)}
                  plugins={[defaultLayoutInstance, highlightPluginInstance]}
                />
              </Worker>
            </div>
          )}
        </div>

        {/* Rail — full-width on mobile annotations tab, fixed sidebar on desktop */}
        <div className={`overflow-y-auto border-black/10 bg-[#f9f8f5] ${
          mobileTab === 'document'
            ? 'hidden sm:flex sm:w-72 sm:shrink-0 sm:flex-col sm:border-l'
            : 'flex w-full flex-col sm:w-72 sm:shrink-0 sm:border-l'
        }`}>
          <div className="border-b border-black/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
              Annotations
              {annotations.length > 0 && (
                <span className="ml-1.5 rounded-full bg-[#eeecff] px-1.5 py-0.5 text-[9px] text-[#4a3db0]">
                  {annotations.length}
                </span>
              )}
            </p>
            {canAnnotate && hasTextLayer !== false && (
              <p className="mt-0.5 text-[9.5px] text-[#9a9a94]">
                Select text in the PDF to annotate.
              </p>
            )}
            {hasTextLayer === false && (
              <p className="mt-0.5 text-[9.5px] text-amber-700">
                Scanned PDF — no selectable text. Use document comments below.
              </p>
            )}
          </div>
          {hasTextLayer === false && (
            <DocumentCommentThread documentId={handoff.documentId} />
          )}
          <AnnotationRail
            handoffId={handoff.id}
            annotations={annotations}
            isReviewer={isReviewer}
            canEdit={canAnnotate}
            currentUserId={currentUserId}
            selectedId={selectedAnnotationId}
            onJumpTo={jumpToAnnotation}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RejectModal
// ---------------------------------------------------------------------------

function RejectModal({
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  isPending: boolean
  error: string | null
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (reason.trim()) onConfirm(reason.trim())
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/40 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-md rounded-xl border border-black/10 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-[#0f0f0f]">Reject this draft?</p>
            <p className="mt-0.5 text-xs text-[#9a9a94]">
              The junior will see your reason and be asked to re-submit.
            </p>
          </div>
          <button
            className="ml-auto shrink-0 rounded p-1 text-[#9a9a94] hover:bg-[#f4f3ef]"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          autoFocus
          className="w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100"
          placeholder="Explain why this draft is being rejected… (required)"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <p className="mt-1.5 text-[10.5px] text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            disabled={!reason.trim() || isPending}
            onClick={() => onConfirm(reason.trim())}
            type="button"
          >
            {isPending ? 'Rejecting…' : 'Reject draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ToolbarButton({
  icon,
  label,
  onClick,
  className = '',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${className}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function overlayStyle(kind: Exclude<ReviewAnnotation['kind'], 'strike'>): React.CSSProperties {
  switch (kind) {
    case 'highlight':
      return { background: 'rgba(250, 204, 21, 0.4)' }
    case 'suggestion':
      return { background: 'rgba(59, 130, 246, 0.25)' }
  }
}

function HandoffStatusPill({
  status,
  returnReason,
}: {
  status: ReviewHandoff['status']
  returnReason?: string | null
}) {
  const map: Record<ReviewHandoff['status'], { label: string; cls: string }> = {
    ready_for_review: { label: 'Ready for review', cls: 'bg-blue-50 text-blue-700' },
    in_review: { label: 'In review', cls: 'bg-[#eeecff] text-[#4a3db0]' },
    completed: { label: 'Completed', cls: 'bg-[#e8f5ee] text-[#1a6b4a]' },
    returned: {
      label: returnReason ? 'Rejected' : 'Returned for rework',
      cls: 'bg-amber-50 text-amber-700',
    },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-[#f4f3ef] text-[#5a5a56]' }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
  )
}
