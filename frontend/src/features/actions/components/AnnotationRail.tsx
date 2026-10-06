import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { HighlightArea } from '@react-pdf-viewer/highlight'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Highlighter,
  Lightbulb,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  Strikethrough,
  Trash2,
  X,
} from 'lucide-react'
import {
  deleteAnnotationReply,
  deleteReviewAnnotation,
  getReviewAnnotationHistory,
  postAnnotationReply,
  promoteAnnotationToKb,
  updateReviewAnnotation,
} from '../../../shared/api/api'
import { getErrorMessage } from '../../../shared/lib/errors'
import { MarkdownContent } from '../../../shared/ui/MarkdownContent'
import type {
  KnowledgeBankScope,
  ReviewAnnotation,
  ReviewAnnotationKind,
  ReviewAnnotationReply,
  ReviewAnnotationStatus,
} from '../../../shared/types/workspace'

type Props = {
  handoffId: string
  annotations: ReviewAnnotation[]
  isReviewer: boolean
  /** Reviewer on an open round — status changes and deletes are allowed. */
  canEdit: boolean
  currentUserId: string | null
  selectedId: string | null
  onJumpTo: (annotationId: string, area: HighlightArea | null) => void
}

type RailFilter = 'all' | 'open' | 'resolved'

export function AnnotationRail({
  handoffId,
  annotations,
  isReviewer,
  canEdit,
  currentUserId,
  selectedId,
  onJumpTo,
}: Props) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<RailFilter>('all')

  // Per-card failure messages so a failed status change or delete never looks
  // like it succeeded.
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  function setCardError(id: string, message: string | null) {
    setCardErrors((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })
  }

  const deleteMutation = useMutation({
    mutationFn: (annotationId: string) => deleteReviewAnnotation(handoffId, annotationId),
    onSuccess: (_r, id) => {
      setCardError(id, null)
      queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
    },
    onError: (e, id) => setCardError(id, getErrorMessage(e, 'Could not delete')),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReviewAnnotationStatus }) =>
      updateReviewAnnotation(handoffId, id, { status }),
    onSuccess: (_r, { id }) => {
      setCardError(id, null)
      queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
    },
    onError: (e, { id }) => setCardError(id, getErrorMessage(e, 'Could not update status')),
  })

  if (annotations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Highlighter size={22} className="text-[#c4c3bc]" />
        <p className="text-xs text-[#76766f]">
          {canEdit
            ? 'Select text in the PDF to add a highlight, strike, or suggestion.'
            : 'No annotations yet.'}
        </p>
      </div>
    )
  }

  const visible = annotations.filter((a) => {
    if (filter === 'open') return a.status === 'open' || a.status === 'needs_rework'
    if (filter === 'resolved') return a.status === 'resolved' || a.status === 'rejected'
    return true
  })
  const openTotal = annotations.filter((a) => a.status === 'open' || a.status === 'needs_rework').length

  const byPage = visible.reduce<Record<number, ReviewAnnotation[]>>((acc, a) => {
    if (!acc[a.pageNo]) acc[a.pageNo] = []
    acc[a.pageNo].push(a)
    return acc
  }, {})
  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-3">
      <div className="flex items-center gap-1" role="group" aria-label="Filter annotations">
        {(
          [
            ['all', `All ${annotations.length}`],
            ['open', `Open ${openTotal}`],
            ['resolved', `Resolved ${annotations.length - openTotal}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
              filter === value ? 'bg-[#0f0f0f] text-white' : 'bg-white text-[#5a5a56] hover:bg-[#f4f3ef]'
            }`}
            onClick={() => setFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {pages.length === 0 && (
        <p className="text-center text-[10.5px] text-[#76766f]">Nothing matches this filter.</p>
      )}
      {pages.map((pageNo) => (
        <div key={pageNo}>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-[#76766f]">
            Page {pageNo}
          </p>
          <div className="flex flex-col gap-1.5">
            {byPage[pageNo].map((annotation) => (
              <AnnotationCard
                key={annotation.id}
                handoffId={handoffId}
                annotation={annotation}
                isReviewer={isReviewer}
                canEdit={canEdit}
                currentUserId={currentUserId}
                error={cardErrors[annotation.id] ?? null}
                selected={annotation.id === selectedId}
                isDeleting={deleteMutation.isPending && deleteMutation.variables === annotation.id}
                isUpdatingStatus={
                  statusMutation.isPending && statusMutation.variables?.id === annotation.id
                }
                onDelete={() => deleteMutation.mutate(annotation.id)}
                onUpdateStatus={(status) => statusMutation.mutate({ id: annotation.id, status })}
                onJumpTo={() => onJumpTo(annotation.id, annotation.anchorRects[0] ?? null)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AnnotationCard
// ---------------------------------------------------------------------------

function AnnotationCard({
  handoffId,
  annotation,
  isReviewer,
  canEdit,
  currentUserId,
  error,
  selected,
  isDeleting,
  isUpdatingStatus,
  onDelete,
  onUpdateStatus,
  onJumpTo,
}: {
  handoffId: string
  annotation: ReviewAnnotation
  isReviewer: boolean
  canEdit: boolean
  currentUserId: string | null
  error: string | null
  selected: boolean
  isDeleting: boolean
  isUpdatingStatus: boolean
  onDelete: () => void
  onUpdateStatus: (status: ReviewAnnotationStatus) => void
  onJumpTo: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showPromoteModal, setShowPromoteModal] = useState(false)
  const lastSeenKey = `annotation-seen-${annotation.id}`
  const queryClient = useQueryClient()

  const { icon, color, bg, border, label } = kindMeta(annotation.kind)

  // Unread dot: any reply after last-seen that isn't authored by current user.
  // Parse both strings through Date to handle non-UTC offsets correctly.
  const lastSeenMs = new Date(sessionStorage.getItem(lastSeenKey) ?? 0).getTime()
  const hasUnread = annotation.replies.some(
    (r) => new Date(r.createdAt).getTime() > lastSeenMs && r.authorUserId !== currentUserId,
  )

  function toggleExpand() {
    if (!expanded) {
      sessionStorage.setItem(lastSeenKey, new Date().toISOString())
    }
    setExpanded((v) => !v)
  }

  // Highlight border when needs_rework
  const needsReworkBorder =
    annotation.status === 'needs_rework' ? 'border-amber-400' : border

  // Carried forward from a previous round: the revised PDF may have shifted the
  // text, so there is no overlay to jump to until it is explicitly re-anchored.
  const isUnanchored = annotation.anchorRects.length === 0

  return (
    <div
      className={`rounded-lg border ${needsReworkBorder} ${bg} text-xs ${
        selected ? 'ring-2 ring-[#4a3db0]/60' : ''
      }`}
      aria-current={selected ? 'true' : undefined}
    >
      {/* Card header row */}
      <div className="flex items-start gap-2 p-2.5">
        <button
          aria-label={isUnanchored ? `${label} (not yet located in revised draft)` : `${label}: jump to mark in PDF`}
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
          onClick={onJumpTo}
          title={isUnanchored ? 'Not yet located in the revised draft' : 'Jump to in PDF'}
          type="button"
        >
          <span className={`mt-0.5 shrink-0 ${color}`}>{icon}</span>
          <span className="font-medium text-[#5a5a56]">{label}</span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {/* Reply count + unread dot */}
          {annotation.replies.length > 0 && (
            <button
              className="relative flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-[#76766f] hover:bg-black/5"
              onClick={toggleExpand}
              type="button"
            >
              <MessageSquare size={10} />
              {annotation.replies.length}
              {hasUnread && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          )}

          {/* Expand toggle */}
          <button
            className="rounded p-0.5 text-[#c4c3bc] hover:bg-black/5 hover:text-[#5a5a56]"
            onClick={toggleExpand}
            type="button"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>

          {/* Delete (reviewer, open round only) */}
          {canEdit && (
            <button
              aria-label="Delete annotation"
              className="rounded p-0.5 text-[#c4c3bc] hover:text-red-500 disabled:opacity-40"
              disabled={isDeleting}
              onClick={onDelete}
              type="button"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-2.5 pb-2.5">
        {error && (
          <p className="mb-1.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10.5px] text-red-600">{error}</p>
        )}
        {isUnanchored && annotation.previousAnnotationId && (
          <p className="mb-1.5 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">
            <RotateCcw size={9} />
            From previous round — locate in revised draft (was p. {annotation.pageNo})
          </p>
        )}
        <p
          className={`leading-4 text-[#76766f] ${annotation.kind === 'suggestion' ? 'line-through opacity-60' : ''} ${!expanded ? 'line-clamp-2' : ''}`}
        >
          &ldquo;{annotation.anchorQuote}&rdquo;
        </p>

        {annotation.kind === 'suggestion' && annotation.suggestedText && (
          <div className="mt-1.5 flex items-start gap-1">
            <ArrowRight size={10} className="mt-0.5 shrink-0 text-blue-400" />
            <p className="leading-4 text-[#0f0f0f]">{annotation.suggestedText}</p>
          </div>
        )}

        {annotation.note && (
          <div className="mt-1.5 border-t border-black/8 pt-1.5 text-[10.5px] text-[#5a5a56]">
            <MarkdownContent markdown={annotation.note} />
          </div>
        )}

        {/* Status controls — reviewer, open round only */}
        {canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <StatusButton
              active={annotation.status === 'needs_rework'}
              disabled={isUpdatingStatus}
              onClick={() => onUpdateStatus('needs_rework')}
              className="border-amber-200 text-amber-700 hover:bg-amber-100 data-[active=true]:bg-amber-200"
              icon={<RotateCcw size={9} />}
              label="Needs rework"
            />
            <StatusButton
              active={annotation.status === 'resolved'}
              disabled={isUpdatingStatus}
              onClick={() => onUpdateStatus('resolved')}
              className="border-[#c8e6d7] text-[#1a6b4a] hover:bg-[#e8f5ee] data-[active=true]:bg-[#c8e6d7]"
              icon={<Check size={9} />}
              label="Resolved"
            />
            <StatusButton
              active={annotation.status === 'rejected'}
              disabled={isUpdatingStatus}
              onClick={() => onUpdateStatus('rejected')}
              className="border-[#ddd] text-[#76766f] hover:bg-[#f4f3ef] data-[active=true]:bg-[#e8e8e4]"
              icon={<X size={9} />}
              label="Rejected"
            />
          </div>
        )}

        {/* Promote to KB / Promoted link — reviewer only */}
        {isReviewer && (
          <div className="mt-1.5">
            {annotation.promotedKbEntryId ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#1a6b4a]">
                <Sparkles size={9} />
                Promoted to KB
                <ArrowUpRight size={9} />
              </span>
            ) : (
              <button
                className="inline-flex items-center gap-1 rounded-full border border-[#c8e6d7] px-1.5 py-0.5 text-[10.5px] font-medium text-[#1a6b4a] hover:bg-[#e8f5ee]"
                onClick={() => setShowPromoteModal(true)}
                type="button"
              >
                <Sparkles size={9} />
                Promote to KB
              </button>
            )}
          </div>
        )}

        {/* Status pill when controls are hidden */}
        {!canEdit && annotation.status !== 'open' && (
          <span
            className={`mt-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${statusCls(annotation.status)}`}
          >
            {statusLabel(annotation.status)}
          </span>
        )}
      </div>

      {/* Promote modal */}
      {showPromoteModal && (
        <PromoteModal
          handoffId={handoffId}
          annotation={annotation}
          onClose={() => setShowPromoteModal(false)}
          onSuccess={() => {
            setShowPromoteModal(false)
            queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
          }}
        />
      )}

      {/* Reply thread — shown when expanded */}
      {expanded && (
        <>
          {annotation.previousAnnotationId && (
            <PreviousRoundsThread handoffId={handoffId} annotationId={annotation.id} />
          )}
          <ReplyThread
            handoffId={handoffId}
            annotation={annotation}
            currentUserId={currentUserId}
            queryClient={queryClient}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PreviousRoundsThread — read-only discussion from earlier rounds
// ---------------------------------------------------------------------------

function PreviousRoundsThread({
  handoffId,
  annotationId,
}: {
  handoffId: string
  annotationId: string
}) {
  const historyQuery = useQuery({
    queryKey: ['handoffs', handoffId, 'annotations', annotationId, 'history'],
    queryFn: () => getReviewAnnotationHistory(handoffId, annotationId),
    staleTime: 60_000,
  })

  if (historyQuery.isLoading) {
    return (
      <div className="border-t border-black/5 px-2.5 py-1.5 text-[10.5px] text-[#76766f]">
        Loading earlier discussion…
      </div>
    )
  }
  const rounds = historyQuery.data ?? []
  if (rounds.length === 0) return null

  return (
    <div className="border-t border-black/5 bg-[#fafaf8] px-2.5 py-2">
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#76766f]">
        Earlier rounds
      </p>
      <div className="space-y-2">
        {rounds.map((prev, i) => (
          <div key={prev.id} className="rounded-md border border-black/5 bg-white p-2">
            <p className="text-[10.5px] text-[#76766f]">
              {i === 0 ? 'Previous round' : `${i + 1} rounds ago`} · p. {prev.pageNo} ·{' '}
              {statusLabel(prev.status)}
            </p>
            {prev.suggestedText && (
              <p className="mt-1 text-[10.5px] text-[#5a5a56]">→ {prev.suggestedText}</p>
            )}
            {prev.note && <p className="mt-1 text-[10.5px] text-[#5a5a56]">{prev.note}</p>}
            {prev.replies.length > 0 && (
              <div className="mt-1.5 space-y-1 border-t border-black/5 pt-1.5">
                {prev.replies.map((r) => (
                  <div key={r.id} className="text-[10.5px]">
                    <span className="font-medium text-[#5a5a56]">
                      {r.author?.fullName ?? r.author?.email ?? 'Someone'}
                    </span>
                    <div className="text-[#5a5a56]">
                      <MarkdownContent markdown={r.bodyMarkdown} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatusButton
// ---------------------------------------------------------------------------

function StatusButton({
  active,
  disabled,
  onClick,
  className,
  icon,
  label,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  className: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      data-active={active}
      disabled={disabled}
      onClick={onClick}
      type="button"
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors disabled:opacity-40 ${className} ${active ? 'font-semibold' : ''}`}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// ReplyThread
// ---------------------------------------------------------------------------

function ReplyThread({
  handoffId,
  annotation,
  currentUserId,
  queryClient,
}: {
  handoffId: string
  annotation: ReviewAnnotation
  currentUserId: string | null
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const postMutation = useMutation({
    mutationFn: (text: string) => postAnnotationReply(handoffId, annotation.id, text),
    onSuccess: () => {
      setBody('')
      queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (replyId: string) => deleteAnnotationReply(handoffId, annotation.id, replyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] }),
  })

  function submit() {
    const trimmed = body.trim()
    if (!trimmed || postMutation.isPending) return
    postMutation.mutate(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-black/8 bg-white/60 px-2.5 pb-2.5 pt-2">
      {/* Existing replies */}
      {annotation.replies.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          {annotation.replies.map((reply) => (
            <ReplyRow
              key={reply.id}
              reply={reply}
              isOwn={reply.authorUserId === currentUserId}
              isDeleting={deleteMutation.isPending && deleteMutation.variables === reply.id}
              onDelete={() => deleteMutation.mutate(reply.id)}
            />
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-1.5">
        <textarea
          ref={textareaRef}
          className="min-h-[48px] flex-1 resize-none rounded-lg border border-black/15 bg-white px-2 py-1.5 text-[11px] leading-4 outline-none focus:border-black/30"
          placeholder="Reply… (⌘ Enter to send)"
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="self-end rounded-lg bg-[#0f0f0f] p-1.5 text-white disabled:opacity-40"
          disabled={!body.trim() || postMutation.isPending}
          onClick={submit}
          type="button"
          aria-label="Send reply"
        >
          <Send size={11} />
        </button>
      </div>
      {postMutation.isError && (
        <p className="mt-1 text-[11px] text-red-600">{getErrorMessage(postMutation.error)}</p>
      )}
    </div>
  )
}

function ReplyRow({
  reply,
  isOwn,
  isDeleting,
  onDelete,
}: {
  reply: ReviewAnnotationReply
  isOwn: boolean
  isDeleting: boolean
  onDelete: () => void
}) {
  const author = reply.author?.fullName ?? reply.author?.email ?? 'Unknown'
  const ts = new Date(reply.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="group flex items-start gap-1.5">
      <div className="flex-1">
        <div className="mb-0.5 flex items-baseline gap-1.5">
          <span className="text-[11px] font-semibold text-[#0f0f0f]">{author}</span>
          <span className="text-[10.5px] text-[#c4c3bc]">{ts}</span>
        </div>
        <div className="text-[10.5px] leading-[1.4] text-[#5a5a56]">
          <MarkdownContent markdown={reply.bodyMarkdown} />
        </div>
      </div>
      {isOwn && (
        <button
          aria-label="Delete reply"
          className="mt-0.5 shrink-0 rounded p-0.5 text-[#c4c3bc] opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 disabled:opacity-40"
          disabled={isDeleting}
          onClick={onDelete}
          type="button"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PromoteModal
// ---------------------------------------------------------------------------

function PromoteModal({
  handoffId,
  annotation,
  onClose,
  onSuccess,
}: {
  handoffId: string
  annotation: ReviewAnnotation
  onClose: () => void
  onSuccess: () => void
}) {
  const defaultTitle = (annotation.note ?? annotation.anchorQuote).split('.')[0].slice(0, 120)
  const [title, setTitle] = useState(defaultTitle)
  const [scope, setScope] = useState<KnowledgeBankScope>('matter')
  const [error, setError] = useState<string | null>(null)

  const promoteMutation = useMutation({
    mutationFn: () =>
      promoteAnnotationToKb(handoffId, annotation.id, {
        title: title.trim() || undefined,
        targetScope: scope,
        entryType: 'knowledge_bank',
      }),
    onSuccess: onSuccess,
    onError: (e) => setError(getErrorMessage(e)),
  })

  return (
    <div
      className="viewport-overlay fixed inset-0 z-[90] grid place-items-center overflow-y-auto p-3 bg-black/40 backdrop-blur-sm"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="max-h-[calc(var(--app-height,100dvh)-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-sm overflow-y-auto rounded-xl border border-black/10 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#0f0f0f]">
            <Sparkles size={14} className="text-[#1a6b4a]" />
            Promote to Knowledge Bank
          </div>
          <button className="rounded p-1 text-[#76766f] hover:bg-[#f4f3ef]" onClick={onClose} type="button">
            <X size={13} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
              Title
            </label>
            <input
              autoFocus
              className="w-full rounded-lg border border-black/15 px-2.5 py-1.5 text-xs outline-none focus:border-[#1a6b4a]"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
              Scope
            </label>
            <select
              className="w-full rounded-lg border border-black/15 px-2.5 py-1.5 text-xs outline-none focus:border-[#1a6b4a]"
              value={scope}
              onChange={(e) => setScope(e.target.value as KnowledgeBankScope)}
            >
              <option value="matter">Matter</option>
              <option value="team">Team</option>
              <option value="firm_wide">Firm-wide</option>
            </select>
          </div>
          <p className="text-[10.5px] text-[#76766f]">
            Content will be pre-filled from the annotation's quote, suggested wording, and rationale.
            {scope !== 'matter' && ' PII review will run before publishing.'}
          </p>
        </div>

        {error && <p className="mt-2 text-[10.5px] text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-3 py-1.5 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="rounded-lg bg-[#1a6b4a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#155a3e] disabled:opacity-50"
            disabled={!title.trim() || promoteMutation.isPending}
            onClick={() => promoteMutation.mutate()}
            type="button"
          >
            {promoteMutation.isPending ? 'Promoting…' : 'Promote'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindMeta(kind: ReviewAnnotationKind) {
  switch (kind) {
    case 'highlight':
      return {
        icon: <Highlighter size={11} />,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-100',
        label: 'Highlight',
      }
    case 'strike':
      return {
        icon: <Strikethrough size={11} />,
        color: 'text-red-500',
        bg: 'bg-red-50',
        border: 'border-red-100',
        label: 'Strike',
      }
    case 'suggestion':
      return {
        icon: <Lightbulb size={11} />,
        color: 'text-blue-500',
        bg: 'bg-blue-50',
        border: 'border-blue-100',
        label: 'Suggestion',
      }
  }
}

function statusLabel(status: ReviewAnnotation['status']) {
  switch (status) {
    case 'needs_rework': return 'Needs rework'
    case 'resolved': return 'Resolved'
    case 'rejected': return 'Rejected'
    default: return status
  }
}

function statusCls(status: ReviewAnnotation['status']) {
  switch (status) {
    case 'needs_rework': return 'bg-amber-100 text-amber-700'
    case 'resolved': return 'bg-[#e8f5ee] text-[#1a6b4a]'
    case 'rejected': return 'bg-[#f4f3ef] text-[#76766f]'
    default: return 'bg-[#f4f3ef] text-[#76766f]'
  }
}
