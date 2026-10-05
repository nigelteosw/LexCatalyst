import { buildWebContext, type WebContext } from './webContext'

// Keep in sync with MESSAGE_TYPE in src/content/selection.ts (content scripts cannot import).
export const SELECTION_MESSAGE = 'birdie-selection'

type SelectionMessage = { type: string; text: string; url: string; title: string }

function isSelectionMessage(message: unknown): message is SelectionMessage {
  if (!message || typeof message !== 'object') return false
  const m = message as Record<string, unknown>
  return m.type === SELECTION_MESSAGE && typeof m.text === 'string' && typeof m.url === 'string'
}

// undefined: not for us. null: the user cleared their selection.
export function selectionFromMessage(
  message: unknown,
  senderTabId: number | undefined,
  activeTabId: number | undefined,
): WebContext | null | undefined {
  if (!isSelectionMessage(message) || senderTabId === undefined || senderTabId !== activeTabId) return undefined
  return buildWebContext({ url: message.url, title: message.title ?? '', text: message.text, source: 'selection' })
}
