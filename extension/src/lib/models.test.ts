import { describe, expect, it } from 'vitest'
import { filterModels } from './models'

const models = [
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', promptPricePerMillion: null },
  { id: 'openai/gpt-x', name: 'GPT X', promptPricePerMillion: null },
]

describe('models', () => {
  it('filters by id or name, case-insensitively', () => {
    expect(filterModels(models, 'SONNET').map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5.5'])
    expect(filterModels(models, '').length).toBe(2)
  })
})
