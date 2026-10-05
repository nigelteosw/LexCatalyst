import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  acceptStyleFixes,
  type BirdieReview,
  decideSuggestion,
  fetchBirdieReview,
  fetchLatestReview,
  type ModelChoice,
  replyToSuggestion,
  startBirdieReview,
  type Suggestion,
  type SuggestionSource,
  type SuggestionStatus,
} from '../lib/api'
import { APP_URL } from '../lib/config'
import { readTabText } from '../lib/pageText'
import { buildSegments, countByGroup, type Group, groupOf, isPlaceholder } from '../lib/reviewSegments'
import type { BrowserContext } from './useBrowserContext'

const POLL_MS = 2000
const GROUPS: { group: Group; title: string }[] = [
  { group: 'drafted', title: 'Drafted' },
  { group: 'fixed', title: 'Fixed' },
  { group: 'decision', title: 'Needs your decision' },
]
const KIND_LABELS: Record<SuggestionSource['kind'], string> = {
  style_guide: 'Style guide',
  kb: 'Knowledge Bank',
  document: 'Precedent',
  elitigation: 'eLitigation',
}

type Props = {
  browser: BrowserContext
  model: ModelChoice
  needsKey: boolean
  onError: (err: unknown) => void
}

function sourceHref(source: SuggestionSource): string | null {
  if (source.url) return source.url
  return source.path ? `${APP_URL}${source.path}` : null
}

function SourceLine({ source }: { source: SuggestionSource | null }) {
  if (!source) return null
  const meta = [source.status, source.side, source.date, source.matterRef].filter(Boolean).join(' · ')
  const href = sourceHref(source)
  return (
    <p className="text-[11px] text-stone-500">
      Source: {KIND_LABELS[source.kind] ?? source.kind},{' '}
      {href ? (
        <a className="text-blue-600 underline" href={href} target="_blank" rel="noreferrer">
          {source.title}
        </a>
      ) : (
        source.title
      )}
      {meta && ` (${meta})`}
    </p>
  )
}

function Card({
  suggestion,
  active,
  busy,
  onDecide,
  onReply,
  onCopy,
}: {
  suggestion: Suggestion
  active: boolean
  busy: boolean
  onDecide: (status: SuggestionStatus) => void
  onReply: (body: string) => Promise<void>
  onCopy: (text: string) => void
}) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const { status, type } = suggestion

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  async function sendReply() {
    if (!reply.trim()) return
    await onReply(reply.trim())
    setReply('')
    setReplying(false)
  }

  return (
    <div
      id={`card-${suggestion.id}`}
      ref={ref}
      className={`space-y-1 rounded-md bg-white p-2 shadow-sm ${active ? 'ring-2 ring-amber-400' : ''} ${
        status === 'rejected' ? 'opacity-60' : ''
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-stone-400">
        {type}
        {suggestion.clauseRef && ` · Clause ${suggestion.clauseRef}`}
        {status !== 'pending' && ` · ${status}`}
      </p>
      <p className="text-sm">
        {type !== 'comment' && (
          <>
            <del className="text-red-700">{suggestion.anchorText}</del>{' '}
            <ins className="bg-green-50 text-green-800 no-underline">{suggestion.suggestedText}</ins>
          </>
        )}
        {type === 'comment' && <span>“{suggestion.anchorText}”</span>}
      </p>
      <p className="text-xs text-stone-700">{suggestion.reason}</p>
      <SourceLine source={suggestion.source} />
      {suggestion.replies.map((r) => (
        <p key={r.id} className="rounded bg-stone-100 px-2 py-1 text-xs">
          {r.body}
        </p>
      ))}
      <div className="flex flex-wrap gap-2 pt-1 text-xs">
        {type !== 'comment' ? (
          <>
            <button
              className="rounded bg-stone-900 px-2 py-0.5 text-white disabled:opacity-50"
              disabled={busy || status === 'accepted'}
              onClick={() => onDecide('accepted')}
            >
              Accept
            </button>
            <button
              className="rounded border border-stone-300 px-2 py-0.5 disabled:opacity-50"
              disabled={busy || status === 'rejected'}
              onClick={() => onDecide('rejected')}
            >
              Reject
            </button>
          </>
        ) : (
          <button className="rounded border border-stone-300 px-2 py-0.5" disabled={busy} onClick={() => onDecide(status === 'accepted' ? 'pending' : 'accepted')}>
            {status === 'accepted' ? 'Reopen' : 'Resolve'}
          </button>
        )}
        {status !== 'pending' && type !== 'comment' && (
          <button className="underline" disabled={busy} onClick={() => onDecide('pending')}>
            Undo
          </button>
        )}
        <button className="underline" onClick={() => setReplying((v) => !v)}>
          Reply
        </button>
        {suggestion.suggestedText && (
          <button className="underline" onClick={() => onCopy(suggestion.suggestedText ?? '')}>
            Copy
          </button>
        )}
      </div>
      {replying && (
        <div className="flex gap-1">
          <input
            className="flex-1 rounded border border-stone-300 px-2 py-1 text-xs"
            value={reply}
            placeholder="Reply…"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void sendReply()}
          />
          <button className="text-xs underline" onClick={() => void sendReply()}>
            Send
          </button>
        </div>
      )}
    </div>
  )
}

function DraftView({
  review,
  activeId,
  onSelect,
}: {
  review: BirdieReview
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const segments = useMemo(() => buildSegments(review.sourceText, review.suggestions), [review])
  return (
    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-white p-2 text-xs leading-relaxed shadow-sm">
      {segments.map((seg, index) => {
        if (seg.kind === 'text') return <span key={index}>{seg.text}</span>
        const s = seg.suggestion
        const ring = activeId === s.id ? 'ring-2 ring-amber-400' : ''
        const dim = s.status === 'rejected' ? 'opacity-50' : ''
        const accepted = s.status === 'accepted'
        const common = `cursor-pointer rounded ${ring} ${dim}`
        if (s.type === 'comment') {
          return (
            <span key={index} className={`${common} bg-amber-100`} onClick={() => onSelect(s.id)}>
              {s.anchorText}
              <sup className="text-amber-700"> ●</sup>
            </span>
          )
        }
        if (s.type === 'replace') {
          return accepted ? (
            <ins key={index} className={`${common} bg-green-50 text-green-800 no-underline`} onClick={() => onSelect(s.id)}>
              {s.suggestedText}
            </ins>
          ) : (
            <span key={index} className={common} onClick={() => onSelect(s.id)}>
              <del className="text-red-700">{s.anchorText}</del>{' '}
              <ins className="bg-green-50 text-green-800 no-underline">{s.suggestedText}</ins>
            </span>
          )
        }
        // insert: over a bracketed placeholder, otherwise after the anchor
        const over = isPlaceholder(s.anchorText)
        return (
          <span key={index} className={common} onClick={() => onSelect(s.id)}>
            {over ? (
              accepted ? null : <del className="text-red-700">{s.anchorText}</del>
            ) : (
              s.anchorText
            )}
            <ins className="block bg-green-50 text-green-800 no-underline">{s.suggestedText}</ins>
          </span>
        )
      })}
    </div>
  )
}

export function ReviewTab({ browser, model, needsKey, onError }: Props) {
  const [review, setReview] = useState<BirdieReview | null>(null)
  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const tabUrl = browser.tab?.url ?? null

  const fail = useCallback(
    (err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
      onError(err)
    },
    [onError],
  )

  // Restore the latest review for the page being viewed.
  useEffect(() => {
    setReview(null)
    setActiveId(null)
    if (!tabUrl) return
    let cancelled = false
    fetchLatestReview(tabUrl)
      .then((found) => !cancelled && setReview(found))
      .catch((err) => !cancelled && fail(err))
    return () => {
      cancelled = true
    }
  }, [tabUrl, fail])

  // Poll while the review is processing.
  const reviewId = review?.id
  const processing = review?.status === 'processing'
  useEffect(() => {
    if (!reviewId || !processing) return
    const timer = setInterval(() => {
      fetchBirdieReview(reviewId)
        .then(setReview)
        .catch(fail)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [reviewId, processing, fail])

  async function start() {
    const tab = browser.tab
    if (!tab) return
    setError(null)
    setStarting(true)
    try {
      const page = await readTabText(tab) // full text, not the 20,000-char chat context
      if (!page.text.trim()) throw new Error('No text found on this page')
      setReview(await startBirdieReview({ url: page.url, title: page.title, text: page.text, model }))
    } catch (err) {
      fail(err)
    } finally {
      setStarting(false)
    }
  }

  async function run(action: () => Promise<BirdieReview>) {
    setBusy(true)
    setError(null)
    try {
      setReview(await action())
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  async function reply(suggestion: Suggestion, body: string) {
    try {
      const created = await replyToSuggestion(suggestion.id, body)
      setReview((prev) =>
        prev
          ? {
              ...prev,
              suggestions: prev.suggestions.map((s) =>
                s.id === suggestion.id ? { ...s, replies: [...s.replies, created] } : s,
              ),
            }
          : prev,
      )
    } catch (err) {
      fail(err)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(console.error)
  }

  async function copyAccepted() {
    if (!review) return
    await navigator.clipboard.writeText(review.currentText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const counts = review ? countByGroup(review.suggestions) : null
  const pendingStyle = review?.suggestions.filter(
    (s) => s.status === 'pending' && s.type === 'replace' && s.category === 'style',
  ).length
  const canStart = !!browser.tab && browser.siteEnabled && !needsKey && !starting && !processing

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          className="rounded-md bg-stone-900 px-3 py-1 text-white disabled:opacity-50"
          disabled={!canStart}
          onClick={() => void start()}
        >
          {starting || processing ? 'Reviewing…' : review ? 'Review again' : 'Review this draft'}
        </button>
        {review?.status === 'ready' && (
          <button className="text-xs underline" onClick={() => void copyAccepted()}>
            {copied ? 'Copied' : 'Copy accepted text'}
          </button>
        )}
      </div>
      {browser.tab && !browser.siteEnabled && (
        <p className="text-xs text-stone-500">
          <button className="underline" onClick={() => void browser.enableCurrentSite()}>
            Turn on Birdie for this site
          </button>{' '}
          to review this page. Birdie only reads sites you turn on.
        </p>
      )}
      {needsKey && (
        <p className="text-xs text-red-600">Add your OpenRouter key in the LexCatalyst web app (Settings → Models).</p>
      )}
      {!browser.tab && <p className="text-xs text-stone-500">Open a document to review it.</p>}
      <p className="text-[11px] text-stone-500">The page text is sent to OpenRouter and the model provider you choose.</p>
      {error && <p className="text-red-600">{error}</p>}
      {processing && <p className="text-stone-500">Birdie is reading the draft and checking the firm's precedent…</p>}
      {review?.status === 'failed' && <p className="text-red-600">{review.error ?? 'Review failed'}</p>}

      {review?.status === 'ready' && counts && (
        <>
          <p className="text-xs text-stone-600">
            {counts.drafted} drafted, {counts.fixed} fixes, {counts.decision} questions. Nothing changes until you
            accept it.
          </p>
          <DraftView review={review} activeId={activeId} onSelect={setActiveId} />
          {GROUPS.map(({ group, title }) => {
            const items = review.suggestions.filter((s) => groupOf(s) === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {title} ({items.length})
                  </h3>
                  {group === 'fixed' && !!pendingStyle && (
                    <button
                      className="text-xs underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void run(() => acceptStyleFixes(review.id))}
                    >
                      Accept all style fixes
                    </button>
                  )}
                </div>
                {items.map((s) => (
                  <Card
                    key={s.id}
                    suggestion={s}
                    active={activeId === s.id}
                    busy={busy}
                    onDecide={(status) => void run(() => decideSuggestion(s.id, status))}
                    onReply={(body) => reply(s, body)}
                    onCopy={copy}
                  />
                ))}
              </div>
            )
          })}
          {review.suggestions.length === 0 && <p className="text-stone-500">Birdie found nothing to suggest.</p>}
        </>
      )}
    </section>
  )
}
