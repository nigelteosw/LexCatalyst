import { describe, expect, it } from 'vitest'
import { buildWebContext, MAX_WEB_CONTEXT_CHARS } from './webContext'

const base = { url: 'https://example.com/a', title: 'Example', source: 'page' as const }

describe('buildWebContext', () => {
  it('returns null for blank text', () => {
    expect(buildWebContext({ ...base, text: '   \n ' })).toBeNull()
  })

  it('trims and collapses runs of blank lines', () => {
    expect(buildWebContext({ ...base, text: '  a\n\n\n\nb  ' })?.text).toBe('a\n\nb')
  })

  it('truncates long text and flags it', () => {
    const ctx = buildWebContext({ ...base, text: 'x'.repeat(MAX_WEB_CONTEXT_CHARS + 5) })
    expect(ctx?.text.length).toBe(MAX_WEB_CONTEXT_CHARS)
    expect(ctx?.truncated).toBe(true)
  })

  it('caps url and title lengths', () => {
    const ctx = buildWebContext({ ...base, url: 'u'.repeat(3000), title: 't'.repeat(600), text: 'ok' })
    expect(ctx?.url.length).toBe(2048)
    expect(ctx?.title.length).toBe(500)
  })
})
