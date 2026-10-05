import { docxToText } from './docx'

const CANT_READ = "Birdie can't read this page"
const CANT_READ_DOC =
  "Birdie couldn't read this Google Doc. Select all (⌘A) and copy (⌘C) in the doc, then click Review. Or use File → Save as Google Docs if it is a .docx."
const GOOGLE_DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/([^/]+)/

// Google Docs paints the body on a canvas, so innerText only returns the toolbar and tab list.
// The plain-text export, fetched with the user's own Google session, has the real content.
async function fetchExport(url: string, format: string, tab: string | null): Promise<Response | null> {
  const exportUrl = `https://docs.google.com/document/d/${GOOGLE_DOC_URL.exec(url)![1]}/export?format=${format}${
    tab ? `&tab=${encodeURIComponent(tab)}` : ''
  }`
  try {
    const response = await fetch(exportUrl, { credentials: 'include' })
    return response.ok ? response : null
  } catch {
    return null
  }
}

// Tries the plain-text export, then the .docx export (Word files opened in Docs often only allow the latter).
async function readGoogleDoc(url: string): Promise<string | null> {
  if (!GOOGLE_DOC_URL.test(url)) return null
  const tab = new URL(url).searchParams.get('tab')
  const txt = await fetchExport(url, 'txt', tab)
  if (txt) {
    const text = await txt.text()
    if (!text.trimStart().startsWith('<')) return text // HTML means a login page, not the doc
  }
  const docx = await fetchExport(url, 'docx', tab)
  if (docx) {
    try {
      const text = await docxToText(await docx.arrayBuffer())
      if (text) return text
    } catch {
      // fall through
    }
  }
  return null
}

export type ActiveTab = { id: number; url: string; title: string }

export function isGoogleDoc(url: string): boolean {
  return GOOGLE_DOC_URL.test(url)
}

export async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null
  return { id: tab.id, url: tab.url, title: tab.title ?? tab.url }
}

// Needs host permission for the tab's origin (see sites.ts); never prompts.
export async function readTabText(tab: ActiveTab): Promise<{ url: string; title: string; text: string }> {
  const docText = await readGoogleDoc(tab.url)
  if (docText) return { url: tab.url, title: tab.title, text: docText }
  // Docs paints on a canvas: innerText is only toolbar and tab-list text, never the document.
  if (isGoogleDoc(tab.url)) throw new Error(CANT_READ_DOC)
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body?.innerText ?? '',
    })
    return { url: tab.url, title: tab.title, text: String(result?.result ?? '') }
  } catch {
    throw new Error(CANT_READ)
  }
}
