import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BirdieSidePanel } from '../sidepanel/BirdieSidePanel'
import '../sidepanel/sidepanel.css'

// Keep in sync with READY_TYPE in src/content/bubble.ts (content scripts cannot import).
const READY_TYPE = 'birdie-popup-ready'

// This page is framed by the floating bubble; the background tells it which tab hosts it.
function Popup() {
  const [tabId, setTabId] = useState<number | null>(null)
  useEffect(() => {
    window.parent.postMessage({ type: READY_TYPE }, '*')
    chrome.runtime
      .sendMessage({ type: 'birdie-whoami' })
      .then((response: { tabId?: number } | undefined) => setTabId(response?.tabId ?? null))
      .catch(console.error)
  }, [])
  if (tabId === null) return null
  return <BirdieSidePanel tabId={tabId} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)
