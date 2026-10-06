// Floating Birdie bubble. Runs only on sites the user switched Birdie on for, in the top frame.
// Must stay import-free: registered content scripts are classic scripts (see selection.ts).
// The panel is an iframe of the extension page popup.html, so the host page cannot read the chat.
const READY_TYPE = 'birdie-popup-ready' // keep in sync with src/popup/main.tsx
const PANEL_W = 360
const PANEL_H = 560
const MARGIN = 16
const MIN_VISIBLE = 80 // the panel may hang off-screen, but this much stays reachable
const LOAD_TIMEOUT_MS = 5000

const bubbleMarker = window as unknown as { __birdieBubble?: boolean }
if (window === window.top && !bubbleMarker.__birdieBubble) {
  bubbleMarker.__birdieBubble = true

  const host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;'
  const logo = chrome.runtime.getURL('Birdie.png')
  const root = host.attachShadow({ mode: 'closed' })
  // Built with DOM calls, not innerHTML: sites that enforce Trusted Types reject HTML strings.
  const style = document.createElement('style')
  style.textContent = `
      * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
      .avatar { position: relative; display: grid; place-items: center; overflow: hidden; border-radius: 50%;
        background: #fff8d8; border: 1px solid rgba(45,158,107,.45); }
      .avatar img { width: 250%; max-width: none; height: auto; pointer-events: none; }
      .bubble { position: fixed; bottom: ${MARGIN}px; right: -30px; width: 48px; height: 48px; padding: 0;
        cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); transition: right .2s cubic-bezier(.34,1.56,.64,1); }
      .bubble:hover, .bubble:focus-visible { right: ${MARGIN}px; outline: 2px solid rgba(45,158,107,.5); }
      .panel { position: fixed; display: none; flex-direction: column; background: #fff;
        border: 1px solid rgba(0,0,0,.1); border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,.28); overflow: hidden; }
      .panel.open { display: flex; }
      .bar { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff;
        border-bottom: 1px solid rgba(0,0,0,.1); font-size: 12px; font-weight: 600; color: #0f0f0f;
        cursor: grab; user-select: none; touch-action: none; }
      .bar.dragging { cursor: grabbing; }
      .bar .avatar { width: 32px; height: 32px; flex: none; }
      .title { flex: 1; }
      .live { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; color: #1a6b4a; }
      .live i { width: 6px; height: 6px; border-radius: 50%; background: #2d9e6b; }
      .close { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: #76766f;
        font-size: 16px; line-height: 1; cursor: pointer; }
      .close:hover { background: #f4f3ef; }
      iframe { flex: 1; width: 100%; border: 0; background: #fff; }
      iframe.dragging { pointer-events: none; }
      .note { padding: 16px; font-size: 13px; color: #44403c; }
    `
  const el = (tag: string, className?: string, text?: string) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text) node.textContent = text
    return node
  }
  const avatar = (extra = '') => {
    const wrap = el('span', `avatar ${extra}`.trim())
    const img = document.createElement('img')
    img.alt = ''
    img.src = logo
    wrap.append(img)
    return wrap
  }
  const bubbleEl = el('button', 'bubble avatar')
  bubbleEl.setAttribute('aria-label', 'Open Birdie')
  bubbleEl.title = 'Birdie'
  bubbleEl.append(Object.assign(document.createElement('img'), { alt: '', src: logo }))
  const barEl = el('div', 'bar')
  const closeEl = el('button', 'close', '×')
  closeEl.setAttribute('aria-label', 'Close Birdie')
  const live = el('span', 'live')
  live.append(el('i'), 'Live')
  barEl.append(avatar(), el('span', 'title', 'Birdie'), live, closeEl)
  const panelEl = el('div', 'panel')
  panelEl.setAttribute('role', 'dialog')
  panelEl.setAttribute('aria-label', 'Birdie')
  panelEl.append(barEl)
  root.append(style, bubbleEl, panelEl)
  const bubble = bubbleEl
  const panel = panelEl
  const bar = barEl
  const closeButton = closeEl
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
    const y = Math.min(Math.max(top, 0), window.innerHeight - 52)
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
