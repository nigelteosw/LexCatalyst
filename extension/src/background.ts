import { enabledOrigins, injectBubbleScript, originPattern, syncContentScripts } from './lib/sites'
import { buildWebContext, PENDING_CONTEXT_KEY } from './lib/webContext'

const MENU_ID = 'ask-birdie'

// Keep in sync with TOGGLE_TYPE in src/content/bubble.ts (content scripts cannot import).
const TOGGLE_TYPE = 'birdie-toggle'

// Sites with the floating Birdie: the toolbar icon toggles the popup there, and opens the side panel elsewhere.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error)
let enabled: string[] | null = null
const warm = () => enabledOrigins().then((origins) => (enabled = origins))
warm().catch(console.error)

chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open wants the click's gesture, so decide synchronously when the cache is warm.
  const open = () => {
    if (tab.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error)
  }
  const pattern = tab.url ? originPattern(tab.url) : null
  const decide = (origins: string[]) => {
    if (!pattern || !origins.includes(pattern) || tab.id === undefined) return open()
    const tabId = tab.id
    chrome.tabs.sendMessage(tabId, { type: TOGGLE_TYPE }).catch(async () => {
      // Tab predates the bubble: inject it, then toggle.
      await injectBubbleScript(tabId)
      await chrome.tabs.sendMessage(tabId, { type: TOGGLE_TYPE })
    })
  }
  if (enabled) decide(enabled)
  else void warm().then(decide)
})

const resync = () =>
  syncContentScripts()
    .then(() => warm())
    .catch(console.error)
chrome.runtime.onStartup.addListener(resync)
chrome.permissions.onAdded.addListener(resync)
chrome.permissions.onRemoved.addListener(resync)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Ask Birdie about this', contexts: ['selection'] })
  resync()
})

// The floating popup is an extension page inside a web page's tab; this tells it which tab.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { type?: string } | null)?.type !== 'birdie-whoami') return false
  sendResponse({ tabId: sender.tab?.id })
  return false
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.windowId === undefined) return
  // sidePanel.open must run synchronously inside the user gesture, before any await.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error)
  const context = buildWebContext({
    url: tab.url ?? info.pageUrl ?? '',
    title: tab.title ?? '',
    text: info.selectionText ?? '',
    source: 'selection',
  })
  if (context) chrome.storage.session.set({ [PENDING_CONTEXT_KEY]: context }).catch(console.error)
})
