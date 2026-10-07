import { describe, expect, it } from 'vitest'
import type { Suggestion } from './api'
import { buildSegments, countByGroup, groupOf, isPlaceholder } from './reviewSegments'

function s(partial: Partial<Suggestion>): Suggestion {
  return {
    id: 'x',
    clauseRef: null,
    anchorText: '',
    anchorStart: 0,
    anchorEnd: 0,
    type: 'replace',
    suggestedText: 'new',
    reason: 'why',
    category: 'style',
    source: null,
    status: 'pending',
    decidedAt: null,
    replies: [],
    ...partial,
  }
}

describe('buildSegments', () => {
  const text = 'A will B and C'
  it('interleaves text and marks in offset order', () => {
    const marks = [s({ id: 'b', anchorStart: 13, anchorEnd: 14 }), s({ id: 'a', anchorStart: 2, anchorEnd: 6 })]
    const out = buildSegments(text, marks)
    expect(out.map((x) => (x.kind === 'text' ? x.text : `<${x.suggestion.id}>`))).toEqual([
      'A ',
      '<a>',
      ' B and ',
      '<b>',
    ])
  })

  it('skips overlapping and out-of-range anchors', () => {
    const out = buildSegments(text, [
      s({ id: 'a', anchorStart: 2, anchorEnd: 6 }),
      s({ id: 'overlap', anchorStart: 4, anchorEnd: 8 }),
      s({ id: 'far', anchorStart: 10, anchorEnd: 99 }),
    ])
    expect(out.filter((x) => x.kind === 'mark').length).toBe(1)
  })

  it('leaves rejected replacements and insertions as unchanged source text', () => {
    const rejected = s({ anchorStart: 2, anchorEnd: 6, status: 'rejected' })
    expect(buildSegments(text, [rejected])).toEqual([{ kind: 'text', text }])
    expect(buildSegments(text, [{ ...rejected, type: 'insert' }])).toEqual([{ kind: 'text', text }])
  })

  it('returns the whole text when there are no suggestions', () => {
    expect(buildSegments(text, [])).toEqual([{ kind: 'text', text }])
  })
})

describe('grouping', () => {
  it('maps suggestions to the three groups', () => {
    expect(groupOf(s({ category: 'style' }))).toBe('fixed')
    expect(groupOf(s({ category: 'substance', type: 'insert' }))).toBe('drafted')
    expect(groupOf(s({ category: 'question', type: 'comment', suggestedText: null }))).toBe('decision')
    expect(groupOf(s({ category: 'substance', type: 'comment', suggestedText: null }))).toBe('decision')
    expect(countByGroup([s({}), s({}), s({ category: 'substance' })])).toEqual({ drafted: 1, fixed: 2, decision: 0 })
  })

  it('detects bracketed placeholders', () => {
    expect(isPlaceholder('[JUNIOR TO DRAFT]')).toBe(true)
    expect(isPlaceholder('Clause 7')).toBe(false)
  })
})
