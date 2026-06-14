import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Worker, Viewer } from '@react-pdf-viewer/core'
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
  createReviewAnnotation,
  createReviewHandoff,
  deleteReviewHandoff,
  exportAnnotatedPdf,
  fetchDocumentFile,
  getReviewHandoff,
  listReviewHandoffsForAction,
  rejectReviewHandoff,
  updateReviewHandoff,
  uploadDocument,
} from '../../../shared/api/api'
import { getErrorMessage } from '../../../shared/lib/errors'
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
  'pdfjs-dist/build/pdf.worker.min.mjs',
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
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handoffsQuery = useQuery({
    queryKey: ['handoffs', 'action', action.id],
    queryFn: () => listReviewHandoffsForAction(action.id),
    staleTime: 5_000,
  })

  const latest = handoffsQuery.data?.[0]

  const detailQuery = useQuery({
    queryKey: ['handoffs', latest?.id],
    queryFn: () => getReviewHandoff(latest!.id),
    enabled: !!latest,
    staleTime: 5_000,
  })

  const handoff: ReviewHandoff | undefined = detailQuery.data ?? latest

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploading(true)
      try {
        const doc = await uploadDocument(file)
        return await createReviewHandoff({
          documentId: doc.id,
          actionId: action.id,
          matterId: action.matterId ?? null,
        })
      } finally {
        setUploading(false)
      }
    },
    onSuccess: (created) => {
      onActionStateChange({ status: 'review', activeHandoffId: created.id })
      queryClient.invalidateQueries({ queryKey: ['handoffs', 'action', action.id] })
    },
    onError: (e) => setError(getErrorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReviewHandoff(id),
    onSuccess: () => {
      onActionStateChange({ status: 'in_progress', activeHandoffId: null })
      queryClient.invalidateQueries({ queryKey: ['handoffs', 'action', action.id] })
    },
    onError: (e) => setError(getErrorMessage(e)),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    uploadMutation.mutate(file)
  }

  if (handoffsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-[#9a9a94]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

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
          <input
            ref={fileInputRef}
            accept=".pdf"
            className="hidden"
            onChange={handleFileChange}
            type="file"
          />
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {uploading ? 'Uploading…' : 'Choose PDF'}
          </button>
        </div>
      </div>
    )
  }

  const isReviewer =
    handoff.reviewerId === currentUser?.id ||
    action.assignerId === currentUser?.id ||
    currentUser?.isAdmin === true

  return (
    <HandoffViewer
      handoff={handoff}
      isReviewer={isReviewer}
      currentUserId={currentUser?.id ?? null}
      onDelete={() => deleteMutation.mutate(handoff.id)}
      onActionStateChange={onActionStateChange}
      queryClient={queryClient}
    />
  )
}

// ---------------------------------------------------------------------------
// HandoffViewer — PDF + annotation rail
// ---------------------------------------------------------------------------

type ViewerProps = {
  handoff: ReviewHandoff
  isReviewer: boolean
  currentUserId: string | null
  onDelete: () => void
  onActionStateChange: (patch: Partial<ActionItem>) => void
  queryClient: ReturnType<typeof useQueryClient>
}

function HandoffViewer({
  handoff,
  isReviewer,
  currentUserId,
  onDelete,
  onActionStateChange,
  queryClient,
}: ViewerProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const highlightPluginRef = useRef<ReturnType<typeof highlightPlugin> | null>(null)
  const defaultLayoutRef = useRef<ReturnType<typeof defaultLayoutPlugin> | null>(null)

  // Build the current annotations list from the handoff (kept fresh by query)
  const annotations = handoff.annotations

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createReviewAnnotation>[1]) =>
      createReviewAnnotation(handoff.id, payload),
    onSuccess: () => {
      setAnnotationError(null)
      queryClient.invalidateQueries({ queryKey: ['handoffs', handoff.id] })
    },
    onError: (e) => setAnnotationError(getErrorMessage(e)),
  })

  const completeMutation = useMutation({
    mutationFn: () => updateReviewHandoff(handoff.id, { status: 'completed' }),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'done', activeHandoffId: null })
      queryClient.setQueryData(['handoffs', handoff.id], updated)
      queryClient.invalidateQueries({ queryKey: ['handoffs', 'action'] })
    },
  })

  const returnMutation = useMutation({
    mutationFn: () => updateReviewHandoff(handoff.id, { status: 'returned' }),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'in_progress' })
      queryClient.setQueryData(['handoffs', handoff.id], updated)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectReviewHandoff(handoff.id, reason),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'in_progress' })
      queryClient.setQueryData(['handoffs', handoff.id], updated)
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
  })

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
    cancel,
    toggle,
  }: RenderHighlightTargetProps) {
    if (!isReviewer) return <></>

    function post(kind: 'highlight' | 'strike') {
      cancel()
      const pageNo = (highlightAreas[0]?.pageIndex ?? 0) + 1
      createMutation.mutate({
        documentId: handoff.documentId,
        pageNo,
        kind,
        anchorQuote: selectedText.trim().slice(0, 20_000),
        anchorRects: highlightAreas,
      })
    }

    return (
      <div
        className="z-50 flex items-center gap-0.5 rounded-lg border border-black/10 bg-white px-1 py-1 shadow-lg"
        style={{ position: 'absolute', zIndex: 50 }}
      >
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
      </div>
    )
  }

  function renderHighlightContent({
    highlightAreas,
    selectedText,
    cancel,
  }: RenderHighlightContentProps) {
    if (!isReviewer) return <></>

    function save(suggestedText: string, note: string) {
      cancel()
      const pageNo = (highlightAreas[0]?.pageIndex ?? 0) + 1
      createMutation.mutate({
        documentId: handoff.documentId,
        pageNo,
        kind: 'suggestion',
        anchorQuote: selectedText.trim().slice(0, 20_000),
        anchorRects: highlightAreas,
        suggestedText,
        note: note || undefined,
      })
    }

    return (
      <div style={{ position: 'absolute', zIndex: 50 }}>
        <SuggestionEditor
          selectedText={selectedText}
          onSave={save}
          onCancel={cancel}
          isSaving={createMutation.isPending}
        />
      </div>
    )
  }

  function renderHighlights({ pageIndex, getCssProperties, rotation }: RenderHighlightsProps) {
    const pageAnnotations = annotations.filter(
      (a) => a.pageNo === pageIndex + 1,
    )
    if (pageAnnotations.length === 0) return <></>

    return (
      <>
        {pageAnnotations.flatMap((annotation) =>
          annotation.anchorRects
            .filter((r) => r.pageIndex === pageIndex)
            .map((rect, i) => {
              const css = getCssProperties(rect, rotation)
              return (
                <div
                  key={`${annotation.id}-${i}`}
                  style={{
                    ...css,
                    mixBlendMode: 'multiply',
                    ...overlayStyle(annotation.kind),
                  }}
                />
              )
            }),
        )}
      </>
    )
  }

  function buildPlugins() {
    highlightPluginRef.current = highlightPlugin({
      renderHighlightTarget,
      renderHighlightContent,
      renderHighlights,
      trigger: Trigger.TextSelection,
    })
    // defaultLayoutPlugin must be rebuilt together with the highlight plugin so
    // both receive fresh Viewer-internal store refs on every remount. Reusing a
    // stale defaultLayoutPlugin instance across viewerKey increments leaves its
    // toolbar DOM refs pointing at the previous (unmounted) Viewer.
    defaultLayoutRef.current = defaultLayoutPlugin()
  }

  // Build plugins on first render.
  if (!highlightPluginRef.current || !defaultLayoutRef.current) {
    buildPlugins()
  }

  // Rebuild both plugins and remount the Viewer whenever annotations or
  // isReviewer change. Doing this in a ref-guard + effect (rather than
  // useCallback) avoids an extra render cycle while still giving closures
  // fresh values.
  const [viewerKey, setViewerKey] = useState(0)
  const prevAnnotationsRef = useRef(annotations)
  const prevIsReviewerRef = useRef(isReviewer)
  useEffect(() => {
    const annotationsChanged = annotations !== prevAnnotationsRef.current
    const reviewerChanged = isReviewer !== prevIsReviewerRef.current
    if (annotationsChanged || reviewerChanged) {
      prevAnnotationsRef.current = annotations
      prevIsReviewerRef.current = isReviewer
      buildPlugins()
      setViewerKey((k) => k + 1)
    }
  // buildPlugins is redeclared each render and captures current closures —
  // intentional; deps are tracked via the prev-refs above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, isReviewer])

  // PDF fetch
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    void fetchDocumentFile(handoff.documentId, { signal: controller.signal })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setFileUrl(objectUrl)
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setFileError(getErrorMessage(err, 'Could not load PDF'))
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [handoff.documentId])

  function jumpToAnnotation(area: HighlightArea) {
    highlightPluginRef.current?.jumpToHighlightArea(area)
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
          {annotationError && (
            <span className="text-[10.5px] text-red-600">{annotationError}</span>
          )}
          <HandoffStatusPill status={handoff.status} returnReason={handoff.returnReason} />
          <button
            className="rounded-lg px-2.5 py-1.5 text-[10.5px] text-[#9a9a94] hover:bg-[#f4f3ef] hover:text-red-600"
            onClick={onDelete}
            type="button"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Action strip */}
      {(isReviewer && isActive) || annotations.length > 0 ? (
        <div className="flex items-center gap-3 border-b border-black/10 bg-[#fafaf8] px-4 py-2">
          {annotations.length > 0 && isActive && (
            <span className="text-[10.5px] text-[#9a9a94]">
              {addressedCount} / {annotations.length} addressed
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
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
                  disabled={!hasNeedsRework || returnMutation.isPending}
                  onClick={() => returnMutation.mutate()}
                  title={!hasNeedsRework ? 'Mark at least one annotation as "Needs rework" first' : undefined}
                  type="button"
                >
                  <RotateCcw size={11} />
                  Return for rework
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium text-red-600 hover:bg-red-50"
                  onClick={() => setShowRejectModal(true)}
                  type="button"
                >
                  <AlertTriangle size={11} />
                  Reject draft
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-lg bg-[#1a6b4a] px-3 py-1.5 text-[10.5px] font-medium text-white hover:bg-[#155a3e] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={openCount > 0 || completeMutation.isPending}
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

      {/* Body: PDF viewer + rail */}
      <div className="flex min-h-0 flex-1">
        {/* PDF */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {fileError ? (
            <div className="flex items-center justify-center p-8 text-xs text-red-600">
              {fileError}
            </div>
          ) : !fileUrl ? (
            <div className="flex items-center justify-center p-8 text-[#9a9a94]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : (
            <div style={{ height: 'calc(100vh - 14rem)' }}>
              <Worker workerUrl={PDFJS_WORKER_URL}>
                <Viewer
                  key={viewerKey}
                  fileUrl={fileUrl}
                  plugins={[defaultLayoutRef.current!, highlightPluginRef.current!]}
                />
              </Worker>
            </div>
          )}
        </div>

        {/* Rail */}
        <div className="w-72 shrink-0 overflow-y-auto border-l border-black/10 bg-[#f9f8f5]">
          <div className="border-b border-black/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
              Annotations
              {annotations.length > 0 && (
                <span className="ml-1.5 rounded-full bg-[#eeecff] px-1.5 py-0.5 text-[9px] text-[#4a3db0]">
                  {annotations.length}
                </span>
              )}
            </p>
            {isReviewer && (
              <p className="mt-0.5 text-[9.5px] text-[#9a9a94]">
                Select text in the PDF to annotate.
              </p>
            )}
          </div>
          <AnnotationRail
            handoffId={handoff.id}
            annotations={annotations}
            isReviewer={isReviewer}
            currentUserId={currentUserId}
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
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${className}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function overlayStyle(kind: ReviewAnnotation['kind']): React.CSSProperties {
  switch (kind) {
    case 'highlight':
      return { background: 'rgba(250, 204, 21, 0.4)' } // amber-400/40
    case 'strike':
      return {
        background: 'transparent',
        borderBottom: '2px solid rgba(239, 68, 68, 0.8)', // red-500
        height: '50%',
        top: '25%',
      }
    case 'suggestion':
      return { background: 'rgba(59, 130, 246, 0.25)' } // blue-500/25
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
