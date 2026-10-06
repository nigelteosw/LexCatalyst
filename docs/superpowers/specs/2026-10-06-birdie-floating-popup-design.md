# Birdie floating popup (Chrome extension)

Date: 2026-10-06
Status: draft, awaiting review

## Goal

Add a floating Birdie bubble to the bottom-right of web pages, like Birdie in the web app. The bubble peeks in from past the screen edge and expands into a chat panel. It sits alongside the existing side panel and does not replace it.

## Decisions

- **Role:** alongside the side panel. The popup is chat only in v1. Review and Precedent stay in the side panel; the popup has an "Open in side panel" button.
- **Where it appears:** only on origins the user has turned Birdie on for (the existing per-site opt-in in `lib/sites.ts`). No new permissions, no `<all_urls>`.
- **"Off the screen":** the collapsed bubble sits partly past the bottom-right viewport edge and slides in on hover or focus. The open panel is draggable and may extend partly past the viewport edges, with a visible minimum so it can always be grabbed.
- **Thread:** the popup and side panel share one conversation (the existing `birdieTurns` key in `chrome.storage.session`, via `lib/conversation.ts`).

## Approach

The content script injects only a bubble and an iframe. The iframe loads an extension page (`popup.html`) that holds the chat UI. Rejected alternatives: mounting React directly in the content script (CSS leakage, CORS, breaks the import-free script constraint) and a Chrome popup window (cannot overlay the page or peek from an edge).

## Components

- `src/content/bubble.ts` (new). Import-free classic script, like `selection.ts`. Creates a fixed host element with a closed Shadow DOM containing the peeking bubble, the drag handle, and the iframe (`chrome.runtime.getURL('popup.html')`). Registered for the same opted-in origins and injected into the already-open tab, via `syncContentScripts` and `injectSelectionScript` in `lib/sites.ts`. Top frame only (`allFrames: false`), so it does not appear inside embedded iframes.
- `popup.html`, `src/popup/BirdiePopup.tsx` (new). Chat-only view. Reuses `lib/api`, `lib/auth`, `ModelPicker`, `MarkdownContent`.
- Shared chat hook (refactor). Extract the chat state and streaming logic from `sidepanel/BirdieSidePanel.tsx` into a hook used by both surfaces, so they do not diverge.
- `lib/bubbleLayout.ts` (new, pure). Peek offset, drag clamping, and snap-back rules. Unit tested.
- `background.ts`. Handles a message to open the side panel for the sender's window, and answers a "what is my tab id" request from the popup.
- `manifest.json`. Add `web_accessible_resources` for `popup.html` and its assets. Bump the version.
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

- **CSP blocks the iframe** (strict `frame-src`): the bubble detects a failed load within a timeout, removes itself, and the side panel shows "Popup isn't available on this site."
- **Orphaned script after extension reload:** `chrome.runtime` calls throw; the script removes its bubble, as `selection.ts` already tolerates this.
- **Fullscreen:** the bubble hides on `fullscreenchange`. It uses the maximum z-index otherwise.
- **Site turned off:** `syncContentScripts` unregisters the script; an already-open tab loses the bubble on next load. Removing it live is out of scope for v1.
- **Small viewport:** panel size clamps to the viewport with a minimum visible strip.

## Testing

- Unit: `bubbleLayout` (peek offset, drag clamp, snap-back), tab-id message filtering, thread-sync reducer if one is extracted. Follows the existing `*.test.ts` pattern.
- Existing `sites.test.ts` extended for the second registered script.
- Manual: a normal page, a Google Doc, a CSP-strict site, two tabs open at once, popup and side panel open together on one thread.

## Out of scope (v1)

Review and Precedent in the popup, an every-site bubble, removing the bubble live when a site is turned off, a floating window outside the browser, per-tab separate threads.
