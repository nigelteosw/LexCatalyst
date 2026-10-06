# Birdie floating popup (Chrome extension)

Date: 2026-10-06
Status: approved for implementation (v2: one shared panel)

## Goal

Add a floating Birdie bubble to the bottom-right of web pages, like Birdie in the web app. The bubble peeks in from past the screen edge and expands into the Birdie panel. The side panel stays, and both surfaces render the same panel component.

## Decisions

- **Role:** one shared panel (`BirdiePanel`: Chat, Review, Precedent) rendered in both the docked side panel and the floating popup. Full parity; no chat-only popup.
- **Where it appears:** only on origins the user has turned Birdie on for (the existing per-site opt-in in `lib/sites.ts`). No new permissions, no `<all_urls>`.
- **"Off the screen":** the collapsed bubble sits partly past the bottom-right viewport edge and slides in on hover or focus. The open panel is draggable and may extend partly past the viewport edges, with a visible minimum so it can always be grabbed.
- **Thread:** the popup and side panel share one conversation (the existing `birdieTurns` key in `chrome.storage.session`, via `lib/conversation.ts`).

## Approach

The content script injects only a bubble and an iframe. The iframe loads an extension page (`popup.html`) that renders the shared `BirdiePanel` (same component as the side panel, with a `host` prop and a pinned tab id when floating). Rejected alternatives: mounting React directly in the content script (CSS leakage, CORS, breaks the import-free script constraint) and a Chrome popup window (cannot overlay the page or peek from an edge).

## Components

- `src/content/bubble.ts` (new). Import-free classic script, like `selection.ts`. Creates a fixed host element with a closed Shadow DOM containing the peeking bubble, the drag handle, and the iframe (`chrome.runtime.getURL('popup.html')`). Registered for the same opted-in origins and injected into the already-open tab, via `syncContentScripts` and `injectSelectionScript` in `lib/sites.ts`. Top frame only (`allFrames: false`), so it does not appear inside embedded iframes.
- `popup.html`, `src/popup/main.tsx` (new). Thin entry point: asks for its host tab id, renders `<BirdieSidePanel host="floating" tabId={…} />`.
- `useBrowserContext` gains a pinned-tab mode: floating, it uses a fixed tab id and ignores active-tab/window-focus changes; docked, unchanged.
- Peek, drag clamping and snap-back live inline in `bubble.ts` (it must stay import-free, so no shared lib).
- `background.ts`. Answers the popup's "which tab am I in" request, relayed through `bubble.ts` so `sender.tab.id` is the host tab.
- `manifest.json`. Add `web_accessible_resources` for `popup.html` and its assets. The version is bumped by the release job, not by hand.
- `vite.config.ts`. Add `popup` and `content-bubble` entries.

## Data flow

- **Context:** `selection.ts` already broadcasts highlighted text, URL and title via `chrome.runtime.sendMessage`. The popup listens to the same messages. It learns its tab id from the background worker and ignores messages from other tabs, so one tab's highlight never shows in another tab's popup.
- **Nothing is sent automatically.** The highlight shows as a chip, as in the side panel. Page text is attached only on explicit user action. The request is the same `web_context` on `POST /birdie/stream`.
- **Auth and API:** the popup page makes all API calls, using the same Google sign-in and JWT as the side panel. The host page cannot read the chat or token because the iframe is cross-origin. When signed out, the popup shows the same sign-in prompt.
- **Shared thread:** both surfaces read and write `birdieTurns`. Each subscribes to `chrome.storage.onChanged` so a turn in one appears in the other. If both are streaming at once, the surface that started the stream owns it; the other shows the finished turn when storage updates. "New chat" clears the thread everywhere.
- **Open in side panel:** the popup sends a message; the background calls `chrome.sidePanel.open` for the sender's window. This must run synchronously within the user gesture, as in the existing context-menu handler.

## Privacy

- Opt-in origin model is unchanged: no script runs on a site until the user turns it on.
- The popup shows the same disclosure as the side panel: prompts, including any attached page text or highlight, leave for OpenRouter and the chosen model provider.
- Update `AGENTS.md` and `README.md` (extension section) to describe the popup.

## Errors and edge cases

- **CSP blocks the iframe** (strict `frame-src`): the popup posts a ready message on load; if none arrives within 5s the panel shows "can't load on this site, use the toolbar icon".
- **Orphaned script after extension reload:** `chrome.runtime` calls throw; the script removes its bubble, as `selection.ts` already tolerates this.
- **Fullscreen:** the bubble hides on `fullscreenchange`. It uses the maximum z-index otherwise.
- **Site turned off:** `syncContentScripts` unregisters the script; an already-open tab loses the bubble on next load. Removing it live is out of scope for v1.
- **Small viewport:** panel size clamps to the viewport with a minimum visible strip.

## Testing

- **Review in the floating panel** reads the pinned tab via `chrome.scripting`; verify on Google Docs and a plain page (main risk). Review state is per surface in v1.
- Unit: `bubbleLayout` (peek offset, drag clamp, snap-back), tab-id message filtering, thread-sync reducer if one is extracted. Follows the existing `*.test.ts` pattern.
- Existing `sites.test.ts` extended for the second registered script.
- Manual: a normal page, a Google Doc, a CSP-strict site, two tabs open at once, popup and side panel open together on one thread.

## Out of scope (v1)

Syncing Review sessions across surfaces, an every-site bubble, removing the bubble live when a site is turned off, a floating window outside the browser, per-tab separate threads.
