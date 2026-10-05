import { buildWebContext, PENDING_CONTEXT_KEY } from './lib/webContext'

const MENU_ID = 'ask-birdie'

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Ask Birdie about this', contexts: ['selection'] })
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
