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
    mutationFn: (file: File) => uploadDocument(file),
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
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [mobileTab, setMobileTab] = useState<'document' | 'annotations'>('document')

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
      queryClient.invalidateQueries({ queryKey: ['handoffs', 'action'] })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectReviewHandoff(handoff.id, reason),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'in_progress' })
      queryClient.setQueryData(['handoffs', handoff.id], updated)
      queryClient.invalidateQueries({ queryKey: ['handoffs', 'action'] })
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
    if (!canAnnotate) return <></>

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
    if (!canAnnotate) return <></>

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
              if (annotation.kind === 'strike') {
                // Render a wrapper at the exact text rect position, then draw the
                // strike line as a child centered vertically inside it.
                // Do NOT override top/height from getCssProperties — those encode
                // the actual page coordinates of the selected text.
                return (
                  <div key={`${annotation.id}-${i}`} style={{ ...css, background: 'transparent' }}>
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
  }, [handoff.documentId])

  function jumpToAnnotation(area: HighlightArea) {
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
          {annotationError && (
            <span className="text-[10.5px] text-red-600">{annotationError}</span>
          )}
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
            <div className="flex items-center justify-center p-8 text-xs text-red-600">
              {fileError}
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
            {canAnnotate && (
              <p className="mt-0.5 text-[9.5px] text-[#9a9a94]">
                Select text in the PDF to annotate.
              </p>
            )}
          </div>
          <AnnotationRail
            handoffId={handoff.id}
            annotations={annotations}
            isReviewer={isReviewer}
            canEdit={canAnnotate}
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
