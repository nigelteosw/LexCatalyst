import type { Matter, MessageSource } from '../../shared/types/workspace'

const SCOPE_LABELS: Record<string, string> = {
  firm_wide: 'Firm-wide',
  team: 'Team',
  private: 'Private',
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** One-line description under a source's title, e.g. "M-2026-0142 · p. 3" or "Firm-wide · Playbook". */
export function describeSource(source: MessageSource, matters: Matter[]): string {
  const matter = source.matterId ? matters.find((m) => m.id === source.matterId) : undefined
  const origin = matter
    ? matter.caseNumber
    : source.scope
      ? (SCOPE_LABELS[source.scope] ?? titleCase(source.scope.replace('_', ' ')))
      : 'General'
  return [origin, source.locator ? titleCase(source.locator) : null].filter(Boolean).join(' · ')
}

/** Source numbers actually cited as [n] in the answer, in order of first appearance. */
export function citedSources(body: string, sources: MessageSource[] | undefined): MessageSource[] {
  if (!sources?.length) return []
  const byNumber = new Map(sources.map((s) => [s.n, s]))
  const seen = new Set<number>()
  const cited: MessageSource[] = []
  for (const match of body.matchAll(/\[(\d{1,3})\](?!\()/g)) {
    const n = Number(match[1])
    const source = byNumber.get(n)
    if (source && !seen.has(n)) {
      seen.add(n)
      cited.push(source)
    }
  }
  return cited
}
