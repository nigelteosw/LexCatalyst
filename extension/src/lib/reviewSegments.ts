import type { Suggestion } from './api'

export type Segment = { kind: 'text'; text: string } | { kind: 'mark'; suggestion: Suggestion }

export type Group = 'drafted' | 'fixed' | 'decision'

export function isPlaceholder(anchor: string): boolean {
  const trimmed = anchor.trim()
  return trimmed.startsWith('[') && trimmed.endsWith(']')
}

// Offsets index into source_text and never overlap; defensively skip any that do or fall outside it.
export function buildSegments(sourceText: string, suggestions: Suggestion[]): Segment[] {
  const ordered = [...suggestions].sort((a, b) => a.anchorStart - b.anchorStart)
  const segments: Segment[] = []
  let cursor = 0
  for (const suggestion of ordered) {
    const { anchorStart, anchorEnd } = suggestion
    if (anchorStart < cursor || anchorEnd < anchorStart || anchorEnd > sourceText.length) continue
    if (anchorStart > cursor) segments.push({ kind: 'text', text: sourceText.slice(cursor, anchorStart) })
    segments.push({ kind: 'mark', suggestion })
    cursor = anchorEnd
  }
  if (cursor < sourceText.length) segments.push({ kind: 'text', text: sourceText.slice(cursor) })
  return segments
}

export function groupOf(s: Suggestion): Group {
  if (s.type === 'comment' || s.category === 'question') return 'decision'
  return s.category === 'style' ? 'fixed' : 'drafted'
}

export function countByGroup(suggestions: Suggestion[]): Record<Group, number> {
  const counts: Record<Group, number> = { drafted: 0, fixed: 0, decision: 0 }
  for (const s of suggestions) counts[groupOf(s)] += 1
  return counts
}
