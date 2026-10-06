import { useCallback, useEffect, useRef, useState } from 'react'
import { type ActiveTab, getActiveTab, readTabText } from '../lib/pageText'
import { selectionFromMessage } from '../lib/selection'
import { enableSite, injectSelectionScript, isSiteEnabled } from '../lib/sites'
import { buildWebContext, PENDING_CONTEXT_KEY, type WebContext } from '../lib/webContext'

export type BrowserContext = {
  tab: ActiveTab | null
  siteEnabled: boolean
  selection: WebContext | null
  page: WebContext | null
  error: string | null
  clearSelection: () => void
  clearPage: () => void
  clearAll: () => void
  share: (ctx: WebContext) => void
  enableCurrentSite: () => Promise<void>
}

// pinnedTabId: the floating panel's host page; omitted, the docked panel follows the active tab.
export function useBrowserContext(pinnedTabId?: number): BrowserContext {
  const [tab, setTab] = useState<ActiveTab | null>(null)
  const [siteEnabled, setSiteEnabled] = useState(false)
  const [selection, setSelection] = useState<WebContext | null>(null)
  const [page, setPage] = useState<WebContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tabRef = useRef<ActiveTab | null>(null)

  const loadPage = useCallback(async (current: ActiveTab) => {
    try {
      const text = await readTabText(current)
      if (tabRef.current?.id === current.id) setPage(buildWebContext({ ...text, source: 'page' }))
    } catch {
      setPage(null)
    }
  }, [])

  const refreshTab = useCallback(async () => {
    const current = await getActiveTab(pinnedTabId)
    const changed = current?.id !== tabRef.current?.id || current?.url !== tabRef.current?.url
    tabRef.current = current
    setTab(current)
    if (!changed) return
    setSelection(null)
    setPage(null)
    const enabled = current ? await isSiteEnabled(current.url) : false
    setSiteEnabled(enabled)
    if (current && enabled) await loadPage(current)
  }, [loadPage])

  useEffect(() => {
    void refreshTab()
    const onActivated = () => {
      if (pinnedTabId === undefined) void refreshTab()
    }
    const onUpdated = (tabId: number, info: { status?: string; url?: string }) => {
      if (tabId === tabRef.current?.id && (info.url || info.status === 'complete')) void refreshTab()
    }
    const onFocus = () => {
      if (pinnedTabId === undefined) void refreshTab()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.windows.onFocusChanged.addListener(onFocus)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.windows.onFocusChanged.removeListener(onFocus)
    }
  }, [refreshTab, pinnedTabId])

  useEffect(() => {
    const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
      const next = selectionFromMessage(message, sender.tab?.id, tabRef.current?.id)
      if (next !== undefined) setSelection(next)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  // Right-click "Ask Birdie about this" (background.ts) hands over through session storage.
  useEffect(() => {
    const take = (value: unknown) => {
      if (!value) return
      setSelection(value as WebContext)
      chrome.storage.session.remove(PENDING_CONTEXT_KEY).catch(console.error)
    }
    chrome.storage.session.get(PENDING_CONTEXT_KEY).then((stored) => take(stored[PENDING_CONTEXT_KEY]))
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[PENDING_CONTEXT_KEY]) take(changes[PENDING_CONTEXT_KEY].newValue)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const enableCurrentSite = useCallback(async () => {
    const current = tabRef.current
    if (!current) {
      setError("Birdie can't read this page")
      return
    }
    setError(null)
    // enableSite first: the permission prompt needs the click's user gesture.
    const granted = await enableSite(current.url)
    if (!granted) {
      setError("Birdie can't read this page without permission")
      return
    }
    setSiteEnabled(true)
    await injectSelectionScript(current.id).catch(console.error)
    await loadPage(current)
  }, [loadPage])

  return {
    tab,
    siteEnabled,
    selection,
    page,
    error,
    clearSelection: () => setSelection(null),
    clearPage: () => setPage(null),
    clearAll: () => {
      setSelection(null)
      setPage(null)
    },
    share: setSelection,
    enableCurrentSite,
  }
}
