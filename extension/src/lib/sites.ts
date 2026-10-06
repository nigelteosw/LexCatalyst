const SCRIPT_ID = 'birdie-selection'
const SCRIPT_FILE = 'content-selection.js'
const BUBBLE_ID = 'birdie-bubble'
const BUBBLE_FILE = 'content-bubble.js'

export function originPattern(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return `${parsed.protocol}//${parsed.host}/*`
  } catch {
    return null
  }
}

export async function isSiteEnabled(url: string): Promise<boolean> {
  const pattern = originPattern(url)
  return pattern ? chrome.permissions.contains({ origins: [pattern] }) : false
}

// The API hosts are required permissions, not sites the user switched on.
export async function enabledOrigins(): Promise<string[]> {
  const required = new Set(chrome.runtime.getManifest().host_permissions ?? [])
  const { origins = [] } = await chrome.permissions.getAll()
  return origins.filter((origin) => origin !== '<all_urls>' && !required.has(origin))
}

export async function syncContentScripts(): Promise<void> {
  const matches = await enabledOrigins()
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, BUBBLE_ID] })
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) })
  if (!matches.length) return
  await chrome.scripting.registerContentScripts([
    {
      id: BUBBLE_ID,
      js: [BUBBLE_FILE],
      matches,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
    {
      id: SCRIPT_ID,
      js: [SCRIPT_FILE],
      matches,
      allFrames: true, // Google Docs routes keyboard and clipboard through an about:blank iframe
      matchOriginAsFallback: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ])
}

// Must be the first await in a click handler: chrome.permissions.request needs the user gesture.
export async function enableSite(url: string): Promise<boolean> {
  const pattern = originPattern(url)
  if (!pattern) return false
  const granted = await chrome.permissions.request({ origins: [pattern] })
  if (granted) await syncContentScripts()
  return granted
}

// Registered scripts only reach pages loaded after registration; cover the tab already open.
export async function injectSelectionScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [SCRIPT_FILE] })
  await injectBubbleScript(tabId)
}

export async function injectBubbleScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: [BUBBLE_FILE] })
}
