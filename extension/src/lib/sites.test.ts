import { describe, expect, it } from 'vitest'
import { originPattern } from './sites'

describe('originPattern', () => {
  it('builds an origin match pattern', () => {
    expect(originPattern('https://docs.google.com/document/d/abc/edit')).toBe('https://docs.google.com/*')
  })

  it('keeps a port', () => {
    expect(originPattern('http://localhost:5173/x')).toBe('http://localhost:5173/*')
  })

  it('rejects non-web urls', () => {
    expect(originPattern('chrome://extensions')).toBeNull()
    expect(originPattern('not a url')).toBeNull()
  })
})
