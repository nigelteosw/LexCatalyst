import { beforeEach, describe, expect, it } from 'vitest'
import { clearTurns, loadTurns, saveTurns, TURNS_KEY } from './conversation'

const store: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
    },
  }
})

describe('conversation storage', () => {
  it('round-trips turns', async () => {
    await saveTurns([{ role: 'user', content: 'hi' }])
    expect(await loadTurns()).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('returns [] when empty or corrupt', async () => {
    expect(await loadTurns()).toEqual([])
    store[TURNS_KEY] = 'nope'
    expect(await loadTurns()).toEqual([])
  })

  it('clears', async () => {
    await saveTurns([{ role: 'user', content: 'hi' }])
    await clearTurns()
    expect(await loadTurns()).toEqual([])
  })
})
