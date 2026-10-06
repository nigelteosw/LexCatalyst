export const MAX_WEB_CONTEXT_CHARS = 120_000
export const PENDING_CONTEXT_KEY = 'pendingWebContext'

export type WebContextSource = 'selection' | 'page'

export type WebContext = {
  url: string
  title: string
  text: string
  source: WebContextSource
  truncated: boolean
}

export function buildWebContext(input: {
  url: string
  title: string
  text: string
  source: WebContextSource
}): WebContext | null {
  const text = input.text.trim().replace(/\n{3,}/g, '\n\n')
  if (!text) return null
  const truncated = text.length > MAX_WEB_CONTEXT_CHARS
  return {
    url: input.url.slice(0, 2048),
    title: input.title.slice(0, 500),
    text: truncated ? text.slice(0, MAX_WEB_CONTEXT_CHARS) : text,
    source: input.source,
    truncated,
  }
}
