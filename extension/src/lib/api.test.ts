import { describe, expect, it } from 'vitest'
import { toBirdieReview, toCaseLinks, toPrecedentResponse } from './api'

describe('precedent mapping', () => {
  it('maps the response', () => {
    const mapped = toPrecedentResponse({
      clause_type: 'option_period',
      terms_summary: [{ label: '21 days', count: 3 }],
      results: [
        {
          id: 'c1',
          source_type: 'document',
          excerpt: 'Option Period of 21 days',
          document_title: 'Signed SPA.pdf',
          matter_ref: 'MAT-2',
          date: '2024-05-06',
          author: 'Sam',
          status: 'executed',
          document_id: 'd1',
          term: { kind: 'days', value: '21', label: '21 days' },
        },
      ],
    })
    expect(mapped.clauseType).toBe('option_period')
    expect(mapped.termsSummary).toEqual([{ label: '21 days', count: 3 }])
    expect(mapped.results[0]).toMatchObject({
      sourceType: 'document',
      documentTitle: 'Signed SPA.pdf',
      documentId: 'd1',
      termLabel: '21 days',
    })
  })
})

describe('case links', () => {
  it('maps and drops malformed entries', () => {
    expect(
      toCaseLinks([
        {
          citation: '[2011] SGCA 1',
          title: 'Holcim',
          decision_date: '2011-01-19',
          url: 'https://www.elitigation.sg/gd/s/2011_SGCA_1',
        },
        { citation: 'x' },
      ]),
    ).toEqual([
      {
        citation: '[2011] SGCA 1',
        title: 'Holcim',
        decisionDate: '2011-01-19',
        url: 'https://www.elitigation.sg/gd/s/2011_SGCA_1',
      },
    ])
  })

  it('drops links that are not eLitigation', () => {
    expect(toCaseLinks([{ citation: 'a', title: 'b', decision_date: null, url: 'https://evil.example' }])).toEqual([])
  })
})

describe('review mapping', () => {
  it('maps a review with suggestions, sources and replies', () => {
    const review = toBirdieReview({
      id: 'r1',
      source_url: 'https://docs.google.com/document/d/1',
      title: null,
      status: 'ready',
      error: null,
      model: 'm',
      source_text: 'A will B',
      current_text: 'A shall B',
      created_at: '2026-10-05T00:00:00Z',
      suggestions: [
        {
          id: 's1',
          clause_ref: '3.2',
          anchor_text: 'will',
          anchor_start: 2,
          anchor_end: 6,
          type: 'replace',
          suggested_text: 'shall',
          reason: "Style guide 2.1: 'shall' for obligations.",
          category: 'style',
          source: { kind: 'style_guide', title: 'Style Guide', path: '/knowledge-bank/k1', matter_ref: 'M1' },
          status: 'pending',
          decided_at: null,
          replies: [{ id: 'p1', body: 'ok', created_at: 't', author_user_id: 'u' }],
        },
      ],
    })
    expect(review.sourceUrl).toBe('https://docs.google.com/document/d/1')
    expect(review.suggestions[0]).toMatchObject({
      clauseRef: '3.2',
      anchorStart: 2,
      suggestedText: 'shall',
      source: { kind: 'style_guide', path: '/knowledge-bank/k1', matterRef: 'M1', url: null },
      replies: [{ body: 'ok', authorUserId: 'u' }],
    })
  })

  it('tolerates a missing source and suggestion list', () => {
    const review = toBirdieReview({
      id: 'r2', source_url: 'u', title: 't', status: 'processing', error: null, model: null,
      source_text: '', current_text: '', created_at: 't',
    })
    expect(review.suggestions).toEqual([])
  })
})

describe('historyForRequest', () => {
  it('keeps the highlighted passage with the turn it belonged to', async () => {
    const { historyForRequest } = await import('./api')
    const [turn] = historyForRequest([
      { role: 'user', content: 'Is this usual?', quoted: { title: 'SPA', text: 'Completion in 8 weeks' } },
    ])
    expect(turn.content).toContain('Completion in 8 weeks')
    expect(turn.content).toContain('Is this usual?')
  })
})
