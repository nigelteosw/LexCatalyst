// Floating Birdie bubble. Runs only on sites the user switched Birdie on for, in the top frame.
// Must stay import-free: registered content scripts are classic scripts (see selection.ts).
// The panel is an iframe of the extension page popup.html, so the host page cannot read the chat.
const READY_TYPE = 'birdie-popup-ready' // keep in sync with src/popup/main.tsx
const PANEL_W = 380
const PANEL_H = 560
const MARGIN = 16
const MIN_VISIBLE = 80 // the panel may hang off-screen, but this much stays reachable
const LOAD_TIMEOUT_MS = 5000

const bubbleMarker = window as unknown as { __birdieBubble?: boolean }
if (window === window.top && !bubbleMarker.__birdieBubble) {
  bubbleMarker.__birdieBubble = true

  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
      .bubble { position: fixed; bottom: ${MARGIN}px; right: -34px; width: 56px; height: 56px; border: 0;
        border-radius: 50%; background: #1c1917; color: #fff; font-size: 26px; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.3); transition: right .18s ease; padding: 0; }
      .bubble:hover, .bubble:focus-visible { right: ${MARGIN}px; }
      .panel { position: fixed; display: none; flex-direction: column; background: #fafaf9;
        border: 1px solid #d6d3d1; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.28); overflow: hidden; }
      .panel.open { display: flex; }
      .bar { height: 28px; flex: none; display: flex; align-items: center; justify-content: space-between;
        padding: 0 4px 0 10px; background: #1c1917; color: #fff; font-size: 12px; cursor: grab; user-select: none; }
      .bar.dragging { cursor: grabbing; }
      .close { border: 0; background: transparent; color: #fff; font-size: 16px; cursor: pointer; padding: 2px 8px; }
      iframe { flex: 1; width: 100%; border: 0; background: #fafaf9; }
      iframe.dragging { pointer-events: none; }
      .note { padding: 16px; font-size: 13px; color: #44403c; }
    </style>
    <button class="bubble" aria-label="Open Birdie" title="Birdie">🐦</button>
    <div class="panel" role="dialog" aria-label="Birdie">
      <div class="bar"><span>Birdie</span><button class="close" aria-label="Close Birdie">×</button></div>
    </div>`
  const bubble = root.querySelector<HTMLButtonElement>('.bubble')!
  const panel = root.querySelector<HTMLDivElement>('.panel')!
  const bar = root.querySelector<HTMLDivElement>('.bar')!
  const closeButton = root.querySelector<HTMLButtonElement>('.close')!
  let frame: HTMLIFrameElement | null = null
  let ready = false
  let readyTimer: ReturnType<typeof setTimeout> | undefined

  const size = () => ({
    w: Math.min(PANEL_W, window.innerWidth - MARGIN * 2),
    h: Math.min(PANEL_H, window.innerHeight - MARGIN * 2),
  })
  const place = (left: number, top: number) => {
    const { w, h } = size()
    // Allow hanging past every edge, but keep MIN_VISIBLE px of the panel (and its bar) on screen.
    const x = Math.min(Math.max(left, MIN_VISIBLE - w), window.innerWidth - MIN_VISIBLE)
    const y = Math.min(Math.max(top, 0), window.innerHeight - 28)
    panel.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
  }
  const home = () => {
    const { w, h } = size()
    place(window.innerWidth - w - MARGIN, window.innerHeight - h - MARGIN)
  }

  const open = () => {
    if (!chrome.runtime?.id) {
      host.remove() // orphaned by an extension reload
      return
    }
    if (!frame) {
      frame = document.createElement('iframe')
      frame.src = chrome.runtime.getURL('popup.html')
      panel.append(frame)
      // A page CSP that forbids framing leaves the iframe blank; the popup announces itself when it loads.
      readyTimer = setTimeout(() => {
        if (ready || !frame) return
        frame.remove()
        frame = null
        const note = document.createElement('p')
        note.className = 'note'
        note.textContent = "Birdie's popup can't load on this site. Use the toolbar icon to open the side panel."
        panel.append(note)
      }, LOAD_TIMEOUT_MS)
    }
    if (!panel.style.left) home()
    panel.classList.add('open')
    bubble.style.display = 'none'
  }
  const close = () => {
    panel.classList.remove('open')
    bubble.style.display = ''
  }

  bubble.addEventListener('click', open)
  closeButton.addEventListener('click', close)
  root.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') close()
  })

  window.addEventListener('message', (event) => {
    if (frame && event.source === frame.contentWindow && (event.data as { type?: string } | null)?.type === READY_TYPE) {
      ready = true
      clearTimeout(readyTimer)
    }
  })

  bar.addEventListener('pointerdown', (event) => {
    if (event.target === closeButton) return
    const rect = panel.getBoundingClientRect()
    const dx = event.clientX - rect.left
    const dy = event.clientY - rect.top
    bar.setPointerCapture(event.pointerId)
    bar.classList.add('dragging')
    frame?.classList.add('dragging')
    const move = (e: PointerEvent) => place(e.clientX - dx, e.clientY - dy)
    const up = () => {
      bar.classList.remove('dragging')
      frame?.classList.remove('dragging')
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
  })

  window.addEventListener('resize', () => {
    if (!panel.classList.contains('open')) return
    const rect = panel.getBoundingClientRect()
    place(rect.left, rect.top)
  })
  document.addEventListener('fullscreenchange', () => {
    host.style.display = document.fullscreenElement ? 'none' : ''
  })

  document.documentElement.append(host)
}
