const CANT_READ = "Birdie can't read this page"

// Must be called directly from a click handler: chrome.permissions.request needs a user gesture.
export async function readActiveTabText(): Promise<{ url: string; title: string; text: string }> {
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] })
  if (!granted) throw new Error(`${CANT_READ} without permission`)

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error(CANT_READ)

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
