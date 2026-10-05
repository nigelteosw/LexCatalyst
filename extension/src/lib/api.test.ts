import { describe, expect, it } from 'vitest'
import { toBirdieSettings, toCaseLinks, toOpenRouterModel, toPrecedentResponse } from './api'

describe('settings mapping', () => {
  it('maps snake_case settings', () => {
    expect(
      toBirdieSettings({
        has_openrouter_key: true,
        key_last4: 'abcd',
        openrouter_model: 'anthropic/claude-sonnet-5.5',
        effective_model: 'anthropic/claude-sonnet-5.5',
      }),
    ).toEqual({
      hasOpenRouterKey: true,
      keyLast4: 'abcd',
      openRouterModel: 'anthropic/claude-sonnet-5.5',
      effectiveModel: 'anthropic/claude-sonnet-5.5',
    })
  })

  it('maps models', () => {
    expect(toOpenRouterModel({ id: 'a/b', name: 'B', context_length: 1000, prompt_price_per_million: 3 })).toEqual({
      id: 'a/b',
      name: 'B',
      contextLength: 1000,
      promptPricePerMillion: 3,
    })
  })
})

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
