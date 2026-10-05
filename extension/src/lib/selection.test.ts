import { describe, expect, it } from 'vitest'
import { SELECTION_MESSAGE, selectionFromMessage } from './selection'

const msg = (text: string) => ({ type: SELECTION_MESSAGE, text, url: 'https://a.com/x', title: 'A' })

describe('selectionFromMessage', () => {
  it('builds selection context from the active tab', () => {
    expect(selectionFromMessage(msg(' Clause 4 '), 7, 7)).toMatchObject({ text: 'Clause 4', source: 'selection' })
  })

  it('returns null when the selection is cleared', () => {
    expect(selectionFromMessage(msg('  '), 7, 7)).toBeNull()
  })

  it('ignores other tabs and other messages', () => {
    expect(selectionFromMessage(msg('x'), 8, 7)).toBeUndefined()
    expect(selectionFromMessage({ type: 'other' }, 7, 7)).toBeUndefined()
    expect(selectionFromMessage(null, 7, 7)).toBeUndefined()
  })
})
