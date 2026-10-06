import { useEffect, useState } from 'react'
import { type PrecedentResponse, type PrecedentResult, searchPrecedent } from '../lib/api'
import { APP_URL } from '../lib/config'

const AUTO_RUN_MS = 800
const CLAUSE_LABELS: Record<string, string> = {
  option_period: 'Option period',
  governing_law: 'Governing law',
  limitation_of_liability: 'Limitation of liability',
  termination: 'Termination',
  confidentiality: 'Confidentiality',
  payment_terms: 'Payment terms',
  notice: 'Notice',
  other: 'Clause',
}

type Props = {
  selectionText: string | null
  onUseInChat: (result: PrecedentResult) => void
  onError: (err: unknown) => void
}

export function PrecedentTab({ selectionText, onUseInChat, onError }: Props) {
  const [data, setData] = useState<PrecedentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function run(text: string) {
    setLoading(true)
    try {
      setData(await searchPrecedent(text))
    } catch (err) {
      onError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!selectionText || selectionText.length < 3) return
    const timer = setTimeout(() => void run(selectionText), AUTO_RUN_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionText])

  async function copy(result: PrecedentResult) {
    await navigator.clipboard.writeText(result.excerpt)
    setCopied(result.id)
  }

  if (!selectionText) {
    return <p className="flex-1 p-3 text-sm text-stone-500">Highlight a clause to see how the firm has drafted it before.</p>
  }

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{data ? (CLAUSE_LABELS[data.clauseType] ?? 'Clause') : 'Related documents'}</span>
        <button className="text-xs underline" disabled={loading} onClick={() => void run(selectionText)}>
          {loading ? 'Searching…' : 'Find related documents'}
        </button>
      </div>
      {data && data.termsSummary.length > 0 && (
        <p className="rounded-md bg-stone-100 px-2 py-1 text-xs">
          {data.termsSummary.map((t) => `${t.label} ×${t.count}`).join(' · ')}
        </p>
      )}
      {data && data.results.length === 0 && <p className="text-stone-500">No related documents found for this clause.</p>}
      {data?.results.map((r) => (
        <article key={r.id} className="space-y-1 rounded-md bg-white p-2 shadow-sm">
          <p className="line-clamp-4 whitespace-pre-wrap">{r.excerpt}</p>
          <p className="text-[11px] text-stone-500">
            {r.documentTitle}
            {r.matterRef && ` · ${r.matterRef}`}
            {r.date && ` · ${r.date}`}
            {r.author && ` · ${r.author}`}
            {r.status && (
              <span
                className={`ml-1 rounded px-1 ${r.status === 'executed' ? 'bg-green-100 text-green-800' : 'bg-stone-200'}`}
              >
                {r.status === 'executed' ? 'Executed' : 'Draft'}
              </span>
            )}
            {r.termLabel && <strong className="ml-1">{r.termLabel}</strong>}
          </p>
          <div className="flex gap-3 text-xs">
            <button className="underline" onClick={() => void copy(r)}>
              {copied === r.id ? 'Copied' : 'Copy'}
            </button>
            <button className="underline" onClick={() => onUseInChat(r)}>
              Use in chat
            </button>
            {r.documentId && (
              <a className="underline" href={`${APP_URL}/documents/${r.documentId}`} target="_blank" rel="noreferrer">
                Open
              </a>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
