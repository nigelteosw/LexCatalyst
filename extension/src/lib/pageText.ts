import { base64ToArrayBuffer, docxToText } from './docx'

const CANT_READ = "Birdie can't read this page"
const CANT_READ_DOC =
  "Birdie couldn't read this Google Doc. Select all (⌘A) and copy (⌘C) in the doc, then click Review. Or use File → Save as Google Docs if it is a .docx."
const GOOGLE_DOC_URL = /^https:\/\/docs\.google\.com\/document\/d\/([^/]+)/

// Google Docs paints the body on a canvas, so innerText only returns the toolbar and tab list.
// The plain-text export, fetched with the user's own Google session, has the real content.
// Relative to docs.google.com: it must be built here, not from `location` (this runs in the side panel).
export function exportPath(docId: string, format: 'txt' | 'docx', tab: string | null): string {
  return `/document/d/${docId}/export?format=${format}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`
}

// Runs inside the Docs tab. The export redirects to *.googleusercontent.com, which answers with
// `Access-Control-Allow-Origin: *`; Chrome rejects that for a credentialed request, and an
// extension page has no host permission for googleusercontent.com. From the docs.google.com page
// a default (same-origin credentials) fetch works: cookies go to docs.google.com only, and the
// redirect target is authorised by the `dat` token in its URL.
async function fetchExportInTab(
  tabId: number,
  docId: string,
  format: 'txt' | 'docx',
  tab: string | null,
): Promise<string | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (path: string, binary: boolean) => {
        try {
          const response = await fetch(path)
          if (!response.ok) return null
          if (!binary) return await response.text()
          const bytes = new Uint8Array(await response.arrayBuffer())
          let binaryString = ''
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binaryString += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          }
          return btoa(binaryString)
        } catch {
          return null
        }
      },
      args: [
        exportPath(docId, format, tab),
        format === 'docx',
      ],
    })
    return typeof result?.result === 'string' ? result.result : null
  } catch {
    return null
  }
}

// Tries the plain-text export, then the .docx export (parsed here).
async function readGoogleDoc(current: { id: number; url: string }): Promise<string | null> {
  const docId = GOOGLE_DOC_URL.exec(current.url)?.[1]
  if (!docId) return null
  const tab = new URL(current.url).searchParams.get('tab')
  const txt = await fetchExportInTab(current.id, docId, 'txt', tab)
  if (txt && !txt.trimStart().startsWith('<')) return txt // HTML means a login page, not the doc
  const docx = await fetchExportInTab(current.id, docId, 'docx', tab)
  if (docx) {
    try {
      const text = await docxToText(base64ToArrayBuffer(docx))
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

export async function getActiveTab(pinnedTabId?: number): Promise<ActiveTab | null> {
  // The floating panel lives in one page, so it stays on that tab however focus moves.
  const tab =
    pinnedTabId === undefined
      ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      : await chrome.tabs.get(pinnedTabId).catch(() => undefined)
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null
  return { id: tab.id, url: tab.url, title: tab.title ?? tab.url }
}

// Needs host permission for the tab's origin (see sites.ts); never prompts.
export async function readTabText(tab: ActiveTab): Promise<{ url: string; title: string; text: string }> {
  const docText = await readGoogleDoc(tab)
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
