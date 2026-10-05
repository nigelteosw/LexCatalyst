import { describe, expect, it } from 'vitest'
import { exportPath } from './pageText'

describe('exportPath', () => {
  it('builds a docs.google.com path from the doc id', () => {
    expect(exportPath('abc123', 'txt', null)).toBe('/document/d/abc123/export?format=txt')
  })

  it('keeps the selected tab', () => {
    expect(exportPath('abc123', 'docx', 't.0')).toBe('/document/d/abc123/export?format=docx&tab=t.0')
  })
})
