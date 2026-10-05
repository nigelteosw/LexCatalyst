import { describe, expect, it } from 'vitest'
import { filterModels, modelLabel, providerDisclosure } from './models'

const models = [
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextLength: null, promptPricePerMillion: null },
  { id: 'openai/gpt-x', name: 'GPT X', contextLength: null, promptPricePerMillion: null },
]
const withKey = { hasOpenRouterKey: true, keyLast4: 'abcd', openRouterModel: null, effectiveModel: 'openai/gpt-x' }

describe('models', () => {
  it('filters by id or name, case-insensitively', () => {
    expect(filterModels(models, 'SONNET').map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5.5'])
    expect(filterModels(models, '').length).toBe(2)
  })

  it('labels the active model', () => {
    expect(modelLabel(null)).toBe('DeepSeek (firm default)')
    expect(modelLabel(withKey)).toBe('openai/gpt-x')
  })

  it('names where text is sent', () => {
    expect(providerDisclosure(null)).toBe('Text you share is sent to DeepSeek.')
    expect(providerDisclosure(withKey)).toBe('Text you share is sent to OpenRouter → openai.')
  })
})
