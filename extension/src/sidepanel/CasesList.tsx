import type { CaseLink } from '../lib/api'

export function CasesList({ cases }: { cases: CaseLink[] }) {
  if (!cases.length) return null
  return (
    <div className="mt-2 border-t border-stone-200 pt-2 text-xs">
      <p className="mb-1 font-medium text-stone-600">Cases (eLitigation)</p>
      <ul className="space-y-1">
        {cases.map((c) => (
          <li key={c.url}>
            <a className="text-blue-600 underline" href={c.url} target="_blank" rel="noreferrer">
              {c.citation}
            </a>{' '}
            {c.title}
            {c.decisionDate && <span className="text-stone-400"> · {c.decisionDate}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
