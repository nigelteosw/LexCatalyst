import { describe, expect, it } from 'vitest'
import { splitSseBuffer } from './sse'

describe('splitSseBuffer', () => {
  it('parses complete events and keeps the partial tail', () => {
    const buffer =
      'event: token\ndata: {"content":"Hel"}\n\n' +
      'event: token\ndata: {"content":"lo"}\n\n' +
      'event: done\ndata: {"con'
    const { events, rest } = splitSseBuffer(buffer)
    expect(events).toEqual([
      { event: 'token', data: { content: 'Hel' } },
      { event: 'token', data: { content: 'lo' } },
    ])
    expect(rest).toBe('event: done\ndata: {"con')
  })

  it('skips blocks without event or data lines', () => {
    expect(splitSseBuffer(': ping\n\n').events).toEqual([])
  })
})
