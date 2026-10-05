// Runs only on sites the user switched Birdie on for. Must stay import-free: registered content
// scripts are classic scripts, so this file has to bundle to a single self-contained chunk.
const MESSAGE_TYPE = 'birdie-selection' // keep in sync with src/lib/selection.ts
const DEBOUNCE_MS = 300
const MAX_CHARS = 5000

const marker = window as unknown as { __birdieSelection?: boolean }
if (!marker.__birdieSelection) {
  marker.__birdieSelection = true
  let lastSent = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  const page = (): { url: string; title: string } => {
    try {
      return { url: window.top!.location.href, title: window.top!.document.title }
    } catch {
      return { url: location.href, title: document.title }
    }
  }

  const send = (raw: string) => {
    const text = raw.trim().slice(0, MAX_CHARS)
    if (text === lastSent) return
    lastSent = text
    try {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPE, text, ...page() }).catch(() => {})
    } catch {
      // Extension reloaded: this orphaned script can no longer reach the side panel.
    }
  }

  if (page().url.startsWith('https://docs.google.com/document/')) {
    // Docs paints text on a canvas, so getSelection() is empty. Copy (⌘C / Ctrl+C) carries the text.
    document.addEventListener('copy', (event) => {
      const text = event.clipboardData?.getData('text/plain') || document.getSelection()?.toString() || ''
      if (text.trim()) send(text)
    })
  } else {
    document.addEventListener('selectionchange', () => {
      clearTimeout(timer)
      timer = setTimeout(() => send(document.getSelection()?.toString() ?? ''), DEBOUNCE_MS)
    })
  }
}
