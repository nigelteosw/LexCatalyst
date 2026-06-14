import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  createReviewFinding,
  createReviewHandoff,
  deleteReviewHandoff,
  fetchDocumentFile,
  getReviewHandoff,
  listReviewHandoffsForAction,
  promoteFindingToKb,
  restartReviewExtraction,
  updateReviewFinding,
  updateReviewHandoff,
  uploadDocument,
} from '../../../shared/api/api'
import type {
  ActionItem,
  CurrentUser,
  ReviewFinding,
  ReviewFindingStatus,
  ReviewHandoff,
} from '../../../shared/types/workspace'
import { getErrorMessage } from '../../../shared/lib/errors'

type Props = {
  action: ActionItem
  currentUser: CurrentUser | null
  onActionStateChange: (patch: Partial<ActionItem>) => void
}

export function ReviewHandoffPane({ action, currentUser, onActionStateChange }: Props) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handoffsQuery = useQuery({
    queryKey: ['handoffs', 'action', action.id],
    queryFn: () => listReviewHandoffsForAction(action.id),
    staleTime: 5_000,
  })

  const latest = handoffsQuery.data?.[0]
  // Poll while extraction is in flight so the pane flips into review mode
  // as soon as the worker finishes.
  const detailQuery = useQuery({
    queryKey: ['handoffs', latest?.id],
    queryFn: () => getReviewHandoff(latest!.id),
    enabled: !!latest,
    refetchInterval: (query) =>
      query.state.data?.status === 'extracting' ? 2_000 : false,
    staleTime: 1_000,
  })

  const handoff: ReviewHandoff | undefined = detailQuery.data ?? latest

  const reExtractMutation = useMutation({
    mutationFn: (id: string) => restartReviewExtraction(id),
    onSuccess: (updated) => {
      onActionStateChange({ status: 'review', activeHandoffId: updated.id })
      queryClient.invalidateQueries({ queryKey: ['handoffs', 'action', action.id] })
      if (latest) queryClient.invalidateQueries({ queryKey: ['handoffs', latest.id] })
    },
    onError: (e) => setError(getErrorMessage(e)),
  })

  const isSubmitter = handoff?.submittedBy === currentUser?.id
  const isReviewer =
    handoff?.reviewerId === currentUser?.id ||
    action.assignerId === currentUser?.id ||
    currentUser?.isAdmin === true
  const canReview = isReviewer && handoff?.status !== 'completed' && handoff?.status !== 'returned'

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
      queryClient.invalidateQueries({ queryKey: ['actions'] })
      queryClient.invalidateQueries({ queryKey: ['reviewsWaiting'] })
    },
    onError: (e) => setError(getErrorMessage(e)),
  })

  function pickFile() {
    fileInputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  if (handoffsQuery.isPending) {
    return <Loading label="Loading review handoff…" />
  }

  if (!handoff) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-[#5a5a56]">
          Upload your review as a PDF so the senior can see each flagged clause with your
          proposed wording and reasoning. The system extracts the findings automatically.
        </p>
        {error && <ErrorBox message={error} />}
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-[#0f0f0f] px-3 py-2 text-xs font-medium text-white hover:bg-[#333] disabled:opacity-50"
          disabled={uploading}
          onClick={pickFile}
          type="button"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? 'Uploading…' : 'Upload review PDF'}
        </button>
        <input
          ref={fileInputRef}
          accept="application/pdf"
          className="hidden"
          onChange={onFileChange}
          type="file"
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <HandoffHeader
        handoff={handoff}
        canReview={!!canReview}
        isSubmitter={isSubmitter}
        canDelete={true}
        onDocumentError={(message) => setError(message)}
        onReExtract={() => reExtractMutation.mutate(handoff.id)}
        reExtracting={reExtractMutation.isPending}
        onDelete={async () => {
          if (!window.confirm('Are you sure you want to delete this review handoff?')) return
          try {
            await deleteReviewHandoff(handoff.id)
            onActionStateChange({ status: 'in_progress', activeHandoffId: null })
            await queryClient.invalidateQueries({ queryKey: ['handoffs', 'action', action.id] })
            await queryClient.invalidateQueries({ queryKey: ['actions'] })
            await queryClient.invalidateQueries({ queryKey: ['reviewsWaiting'] })
          } catch (e) {
            setError(getErrorMessage(e))
          }
        }}
        onReturn={async () => {
          try {
            await updateReviewHandoff(handoff.id, { status: 'returned' })
            onActionStateChange({ status: 'in_progress' })
            await detailQuery.refetch()
            await queryClient.invalidateQueries({ queryKey: ['actions'] })
            await queryClient.invalidateQueries({ queryKey: ['reviewsWaiting'] })
          } catch (e) {
            setError(getErrorMessage(e))
          }
        }}
        onComplete={async () => {
          try {
            await updateReviewHandoff(handoff.id, { status: 'completed' })
            onActionStateChange({ status: 'done', activeHandoffId: null })
            await detailQuery.refetch()
            await queryClient.invalidateQueries({ queryKey: ['actions'] })
            await queryClient.invalidateQueries({ queryKey: ['reviewsWaiting'] })
          } catch (e) {
            setError(getErrorMessage(e))
          }
        }}
      />

      {error && <ErrorBox message={error} />}

      {handoff.status === 'extracting' ? (
        <Loading label="Extracting findings from the PDF…" />
      ) : handoff.status === 'extraction_failed' ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          Extraction failed. {handoff.errorMessage ?? ''}
        </div>
      ) : (
        <>
          {handoff.findings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-black/10 px-3 py-4 text-center text-xs text-[#8c8c86]">
              No findings extracted automatically. Open the PDF and add findings manually below.
            </div>
          ) : (
            <ol className="space-y-3">
              {handoff.findings.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  handoffId={handoff.id}
                  matterId={handoff.matterId}
                  canReview={!!canReview}
                  onError={setError}
                />
              ))}
            </ol>
          )}
          {canReview && handoff.status !== 'completed' && (
            <AddFindingForm handoffId={handoff.id} onError={setError} />
          )}
        </>
      )}
    </div>
  )
}

function AddFindingForm({
  handoffId,
  onError,
}: {
  handoffId: string
  onError: (msg: string) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [originalClause, setOriginalClause] = useState('')
  const [proposedRevision, setProposedRevision] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setOriginalClause('')
    setProposedRevision('')
    setReasoning('')
  }

  async function submit() {
    if (!originalClause.trim() || !reasoning.trim()) {
      onError('Original clause and reasoning are required')
      return
    }
    setSaving(true)
    try {
      await createReviewFinding(handoffId, {
        originalClause: originalClause.trim(),
        proposedRevision: proposedRevision.trim() || null,
        reasoning: reasoning.trim(),
      })
      reset()
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
    } catch (e) {
      onError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-black/15 bg-white px-3 py-2 text-xs font-medium text-[#5a5a56] hover:border-black/30 hover:bg-[#f4f3ef]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus size={12} />
        Add finding manually
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-[12px] border border-black/10 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
        New finding
      </div>
      <div>
        <label className="text-[10.5px] font-medium text-[#5a5a56]">Original clause</label>
        <textarea
          autoFocus
          className="mt-1 w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[11.5px] leading-5 outline-none focus:border-black/35"
          onChange={(e) => setOriginalClause(e.target.value)}
          placeholder="Quote the clause from the contract…"
          rows={3}
          value={originalClause}
        />
      </div>
      <div>
        <label className="text-[10.5px] font-medium text-[#5a5a56]">
          Proposed revision <span className="text-[#aaa9a3]">(optional)</span>
        </label>
        <textarea
          className="mt-1 w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[11.5px] leading-5 outline-none focus:border-black/35"
          onChange={(e) => setProposedRevision(e.target.value)}
          placeholder="Suggested wording…"
          rows={3}
          value={proposedRevision}
        />
      </div>
      <div>
        <label className="text-[10.5px] font-medium text-[#5a5a56]">Reasoning</label>
        <textarea
          className="mt-1 w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[11.5px] leading-5 outline-none focus:border-black/35"
          onChange={(e) => setReasoning(e.target.value)}
          placeholder="Why this matters — playbook position, risk, precedent…"
          rows={3}
          value={reasoning}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-md px-2.5 py-1 text-[11px] text-[#5a5a56] hover:bg-[#f4f3ef]"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-md bg-[#0f0f0f] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#333] disabled:opacity-50"
          disabled={saving || !originalClause.trim() || !reasoning.trim()}
          onClick={submit}
          type="button"
        >
          {saving ? 'Saving…' : 'Add finding'}
        </button>
      </div>
    </div>
  )
}

function HandoffHeader({
  handoff,
  canReview,
  canDelete,
  isSubmitter,
  onReturn,
  onComplete,
  onDelete,
  onDocumentError,
  onReExtract,
  reExtracting,
}: {
  handoff: ReviewHandoff
  canReview: boolean
  canDelete: boolean
  isSubmitter: boolean
  onReturn: () => void
  onComplete: () => void
  onDelete: () => void
  onDocumentError: (message: string) => void
  onReExtract: () => void
  reExtracting: boolean
}) {
  const [isOpeningDocument, setIsOpeningDocument] = useState(false)
  const total = handoff.findings.length
  const pending = handoff.findings.filter((f) => f.status === 'pending').length
  // Complete is allowed when there's nothing left to decide on:
  //  - 0 findings (e.g. extraction returned nothing and senior judges nothing to flag)
  //  - all findings have a non-pending status (approved / edited / rejected / needs_rework)
  const canComplete = pending === 0
  const completeHint = canComplete
    ? total === 0
      ? 'No findings to review — mark this handoff complete'
      : undefined
    : `${pending} finding${pending === 1 ? '' : 's'} still pending`

  async function openDocument() {
    if (isOpeningDocument) return
    const target = window.open('about:blank', '_blank')
    if (target) target.opener = null
    setIsOpeningDocument(true)
    try {
      const blob = await fetchDocumentFile(handoff.documentId)
      const objectUrl = URL.createObjectURL(blob)
      if (target) {
        target.location.href = objectUrl
      } else {
        const anchor = window.document.createElement('a')
        anchor.href = objectUrl
        anchor.target = '_blank'
        anchor.rel = 'noreferrer'
        anchor.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (error) {
      target?.close()
      onDocumentError(getErrorMessage(error, 'Could not open review PDF'))
    } finally {
      setIsOpeningDocument(false)
    }
  }

  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[#0f0f0f]">
          <FileText size={13} className="shrink-0 text-[#5a5a56]" />
          <span className="truncate font-medium">{handoff.documentFilename ?? 'Review PDF'}</span>
          <StatusPill status={handoff.status} />
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-[#8c8c86]">
          <button
            className="inline-flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[#0f0f0f] hover:bg-[#f4f3ef]"
            disabled={isOpeningDocument}
            onClick={() => void openDocument()}
            type="button"
          >
            {isOpeningDocument ? <Loader2 className="animate-spin" size={11} /> : <ExternalLink size={11} />}
            {isOpeningDocument ? 'Opening...' : 'View PDF'}
          </button>
          <span>
            Submitted by {handoff.submitter?.fullName ?? handoff.submitter?.email ?? 'lawyer'}
          </span>
        </div>
      </div>
      {total > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#5a5a56]">
          <div className="h-1.5 flex-1 rounded-full bg-[#f4f3ef]">
            <div
              className="h-full rounded-full bg-[#0f0f0f] transition-all"
              style={{ width: `${((total - pending) / total) * 100}%` }}
            />
          </div>
          <span>
            {total - pending} of {total} reviewed
          </span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {canReview && handoff.status !== 'completed' && (
          <>
            {total === 0 && (
              <button
                className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1 text-[11px] hover:bg-[#f4f3ef] disabled:opacity-50"
                disabled={reExtracting || handoff.status === 'extracting'}
                onClick={onReExtract}
                type="button"
                title="Re-run AI extraction on the source PDF"
              >
                <RefreshCw size={11} className={reExtracting ? 'animate-spin' : undefined} />
                {reExtracting ? 'Re-extracting…' : 'Re-run extraction'}
              </button>
            )}
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1 text-[11px] hover:bg-[#f4f3ef]"
              onClick={onReturn}
              type="button"
            >
              <RotateCcw size={11} />
              Return for rework
            </button>
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-[#0f0f0f] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#333] disabled:opacity-50"
              disabled={!canComplete}
              onClick={onComplete}
              type="button"
              title={completeHint}
            >
              <CheckCircle2 size={11} />
              Mark review complete
            </button>
          </>
        )}
        {canDelete && handoff.status !== 'completed' && (
          <button
            className="inline-flex items-center gap-1 rounded-lg border border-red-100 px-2.5 py-1 text-[11px] text-red-700 hover:bg-red-50"
            onClick={onDelete}
            type="button"
          >
            <Trash2 size={11} />
            Delete
          </button>
        )}
      </div>
      {!canReview && isSubmitter && handoff.status === 'returned' && (
        <p className="mt-2 text-[10.5px] text-amber-700">
          Sent back for rework. Address the comments and resubmit.
        </p>
      )}
    </div>
  )
}

function FindingCard({
  finding,
  handoffId,
  matterId,
  canReview,
  onError,
}: {
  finding: ReviewFinding
  handoffId: string
  matterId: string | null | undefined
  canReview: boolean
  onError: (msg: string) => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(finding.reviewerEdit ?? finding.proposedRevision ?? '')
  const [commentDraft, setCommentDraft] = useState(finding.reviewerComment ?? '')
  const [editingComment, setEditingComment] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const finalWording = finding.reviewerEdit || finding.proposedRevision || null

  async function patch(payload: Parameters<typeof updateReviewFinding>[2]) {
    try {
      await updateReviewFinding(handoffId, finding.id, payload)
      await queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
      await queryClient.invalidateQueries({ queryKey: ['actions'] })
    } catch (e) {
      onError(getErrorMessage(e))
    }
  }

  async function promote() {
    setPromoting(true)
    try {
      await promoteFindingToKb(handoffId, finding.id, {
        targetScope: matterId ? 'matter' : 'firm_wide',
      })
      await queryClient.invalidateQueries({ queryKey: ['handoffs', handoffId] })
    } catch (e) {
      onError(getErrorMessage(e))
    } finally {
      setPromoting(false)
    }
  }

  return (
    <li className="rounded-[12px] border border-black/10 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-[#5a5a56]">
          <span className="rounded-full bg-[#f4f3ef] px-2 py-0.5 text-[10px] font-medium">
            Finding {finding.sequence}
          </span>
          <FindingStatusPill status={finding.status} />
          {finding.promotedKbEntryId && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[#1a6b4a]">
              <Sparkles size={10} /> Promoted to KB
            </span>
          )}
        </div>
        {canReview && (
          <div className="flex items-center gap-1">
            <ActionButton
              label="Approve"
              icon={<Check size={11} />}
              active={finding.status === 'approved'}
              onClick={() => patch({ status: 'approved' })}
            />
            <ActionButton
              label="Edit"
              icon={<Pencil size={11} />}
              active={finding.status === 'edited'}
              onClick={() => setEditing((v) => !v)}
            />
            <ActionButton
              label="Comment"
              icon={<MessageSquare size={11} />}
              onClick={() => setEditingComment((v) => !v)}
            />
            <ActionButton
              label="Reject"
              icon={<X size={11} />}
              danger
              active={finding.status === 'rejected'}
              onClick={() => patch({ status: 'rejected' })}
            />
          </div>
        )}
      </header>

      <div className="grid gap-3 px-3 py-3 sm:grid-cols-2">
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            Original clause
          </div>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-[#fafaf8] px-2 py-1.5 text-[11.5px] leading-5 text-[#0f0f0f]">
            {finding.originalClause}
          </p>
        </div>
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            Proposed revision
          </div>
          {editing ? (
            <div className="mt-1 space-y-1">
              <textarea
                autoFocus
                className="w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[11.5px] leading-5 outline-none focus:border-black/35"
                onChange={(e) => setEditDraft(e.target.value)}
                rows={5}
                value={editDraft}
              />
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-md px-2 py-1 text-[10.5px] text-[#5a5a56] hover:bg-[#f4f3ef]"
                  onClick={() => {
                    setEditDraft(finding.reviewerEdit ?? finding.proposedRevision ?? '')
                    setEditing(false)
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-[#0f0f0f] px-2 py-1 text-[10.5px] font-medium text-white hover:bg-[#333]"
                  onClick={async () => {
                    await patch({ status: 'edited', reviewerEdit: editDraft.trim() })
                    setEditing(false)
                  }}
                  type="button"
                >
                  Save edit
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-[#fafaf8] px-2 py-1.5 text-[11.5px] leading-5 text-[#0f0f0f]">
              {finalWording ?? <em className="text-[#aaa9a3]">Flagged for discussion (no rewrite)</em>}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            Reasoning
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-5 text-[#5a5a56]">
            {finding.reasoning}
          </p>
        </div>
        {finding.citations.length > 0 && (
          <div>
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
              Citations
            </div>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {finding.citations.map((c, i) => (
                <li
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-[#eeecff] px-2 py-0.5 text-[10.5px] font-medium text-[#4a3db0]"
                  title={c.ref ?? undefined}
                >
                  {c.kind}: {c.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        {finding.reviewerComment && !editingComment && (
          <div className="rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
            <span className="font-semibold">Comment:</span> {finding.reviewerComment}
          </div>
        )}
        {editingComment && (
          <div className="space-y-1">
            <textarea
              autoFocus
              className="w-full resize-y rounded-md border border-black/15 bg-white px-2 py-1.5 text-[11.5px] leading-5 outline-none focus:border-black/35"
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="Leave a comment or ask for rework"
              rows={3}
              value={commentDraft}
            />
            <div className="flex justify-end gap-2">
              <button
                className="rounded-md px-2 py-1 text-[10.5px] text-[#5a5a56] hover:bg-[#f4f3ef]"
                onClick={() => {
                  setCommentDraft(finding.reviewerComment ?? '')
                  setEditingComment(false)
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-black/10 px-2 py-1 text-[10.5px] text-[#5a5a56] hover:bg-[#f4f3ef]"
                onClick={async () => {
                  await patch({
                    status: 'needs_rework',
                    reviewerComment: commentDraft.trim() || null,
                  })
                  setEditingComment(false)
                }}
                type="button"
              >
                Send back to junior
              </button>
              <button
                className="rounded-md bg-[#0f0f0f] px-2 py-1 text-[10.5px] font-medium text-white hover:bg-[#333]"
                onClick={async () => {
                  await patch({ reviewerComment: commentDraft.trim() || null })
                  setEditingComment(false)
                }}
                type="button"
              >
                Save comment
              </button>
            </div>
          </div>
        )}
        {canReview &&
          (finding.status === 'approved' || finding.status === 'edited') &&
          !finding.promotedKbEntryId && (
            <button
              className="mt-1 inline-flex items-center gap-1 rounded-lg border border-[#1a6b4a]/30 bg-[#e8f5ee] px-2.5 py-1 text-[10.5px] font-medium text-[#1a6b4a] hover:bg-[#d8eee0] disabled:opacity-50"
              disabled={promoting}
              onClick={promote}
              type="button"
            >
              <Sparkles size={11} />
              {promoting ? 'Promoting…' : 'Promote to Knowledge Bank'}
            </button>
          )}
      </div>
    </li>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  active,
  danger,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  active?: boolean
  danger?: boolean
}) {
  const base =
    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors'
  const variant = danger
    ? active
      ? 'bg-red-600 text-white'
      : 'text-red-700 hover:bg-red-50'
    : active
      ? 'bg-[#0f0f0f] text-white'
      : 'text-[#5a5a56] hover:bg-[#f4f3ef]'
  return (
    <button className={`${base} ${variant}`} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: ReviewHandoff['status'] }) {
  const map: Record<ReviewHandoff['status'], { label: string; cls: string }> = {
    extracting: { label: 'Extracting', cls: 'bg-[#eeecff] text-[#4a3db0]' },
    ready_for_review: { label: 'Ready for review', cls: 'bg-[#fff1d6] text-[#8a5a00]' },
    in_review: { label: 'In review', cls: 'bg-[#e8f0fe] text-[#1a4a8a]' },
    completed: { label: 'Completed', cls: 'bg-[#e8f5ee] text-[#1a6b4a]' },
    returned: { label: 'Returned for rework', cls: 'bg-amber-100 text-amber-900' },
    extraction_failed: { label: 'Extraction failed', cls: 'bg-red-50 text-red-700' },
  }
  const v = map[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  )
}

function FindingStatusPill({ status }: { status: ReviewFindingStatus }) {
  const map: Record<ReviewFindingStatus, { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-[#f4f3ef] text-[#5a5a56]' },
    approved: { label: 'Approved', cls: 'bg-[#e8f5ee] text-[#1a6b4a]' },
    edited: { label: 'Edited', cls: 'bg-[#eeecff] text-[#4a3db0]' },
    rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700' },
    needs_rework: { label: 'Needs rework', cls: 'bg-amber-100 text-amber-900' },
  }
  const v = map[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-3 text-xs text-[#5a5a56]">
      <Loader2 size={13} className="animate-spin" />
      {label}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
      {message}
    </div>
  )
}
