import type { BirdieTurn } from './api'

// Session storage: survives closing the panel, cleared on browser restart or New chat.
export const TURNS_KEY = 'birdieTurns'

export async function loadTurns(): Promise<BirdieTurn[]> {
  const stored = await chrome.storage.session.get(TURNS_KEY)
  const turns = stored[TURNS_KEY]
  return Array.isArray(turns) ? (turns as BirdieTurn[]) : []
}

export async function saveTurns(turns: BirdieTurn[]): Promise<void> {
  await chrome.storage.session.set({ [TURNS_KEY]: turns })
}

export async function clearTurns(): Promise<void> {
  await chrome.storage.session.remove(TURNS_KEY)
}
