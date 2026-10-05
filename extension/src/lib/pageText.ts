const CANT_READ = "Birdie can't read this page"
const GOOGLE_DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/([^/]+)/

// Google Docs paints the body on a canvas, so innerText only returns the toolbar and tab list.
// The plain-text export, fetched with the user's own Google session, has the real content.
async function readGoogleDoc(url: string): Promise<string | null> {
  const match = GOOGLE_DOC_URL.exec(url)
  if (!match) return null
  const tab = new URL(url).searchParams.get('tab')
  const exportUrl = `https://docs.google.com/document/d/${match[1]}/export?format=txt${
    tab ? `&tab=${encodeURIComponent(tab)}` : ''
  }`
  try {
    const response = await fetch(exportUrl, { credentials: 'include' })
    if (!response.ok) return null
    const text = await response.text()
    return text.trimStart().startsWith('<') ? null : text // HTML means a login page, not the doc
  } catch {
    return null
  }
}

// Must be called directly from a click handler: chrome.permissions.request needs a user gesture.
export async function readActiveTabText(): Promise<{ url: string; title: string; text: string }> {
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] })
  if (!granted) throw new Error(`${CANT_READ} without permission`)

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error(CANT_READ)

  const docText = await readGoogleDoc(tab.url)
  if (docText) return { url: tab.url, title: tab.title ?? tab.url, text: docText }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body?.innerText ?? '',
    })
    return { url: tab.url, title: tab.title ?? tab.url, text: String(result?.result ?? '') }
  } catch {
    throw new Error(CANT_READ)
  }
}
