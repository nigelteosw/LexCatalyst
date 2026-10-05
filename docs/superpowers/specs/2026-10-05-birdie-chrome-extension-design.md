# Birdie Chrome Extension — Design

Date: 2026-10-05

## Goal

Users install a Chrome extension, sign in with their LexCatalyst account, and get Birdie (the AI mentor) as a helper on any webpage.

## Decisions

- **Location:** new top-level folder `extensions/` (sibling of `frontend/` and `backend/`).
- **Output:** `bun run build` emits `extensions/dist/` — a ready-to-load unpacked extension (Chrome → `chrome://extensions` → Developer mode → "Load unpacked" → select `extensions/dist`). `bun run package` also zips it to `extensions/birdie-extension.zip` for sharing. Chrome Web Store publishing is out of scope.
- **UI surface:** Chrome Side Panel API (no DOM injection into host pages).
- **Page access:** on demand only. Birdie sees highlighted text (via context menu) or the page text when the user clicks "Ask about this page". Nothing is read automatically.
- **Auth:** Google sign-in in the extension via `chrome.identity.launchWebAuthFlow` → Google ID token → existing `POST /auth/google` → LexCatalyst JWT stored in `chrome.storage.local`.

## Structure

```txt
extensions/
  package.json            # Bun + Vite + React + TS + Tailwind
  vite.config.ts          # multi-entry build: sidepanel + background -> dist/
  public/manifest.json    # MV3; copied into dist/
  public/icons/           # Birdie icons 16/48/128
  src/
    background.ts         # context menu, side panel open, auth flow
    sidepanel/
      index.html
      main.tsx
      BirdieSidePanel.tsx # chat UI, sign-in screen, context chip
    lib/
      api.ts              # /me, /birdie/stream with Bearer JWT
      auth.ts             # launchWebAuthFlow + token storage
      pageContext.ts      # chrome.scripting read of selection/page text
      config.ts           # API base URL (build-time env VITE_API_BASE_URL)
```

Manifest permissions: `sidePanel`, `contextMenus`, `activeTab`, `scripting`, `storage`, `identity`. No `<all_urls>` host permission; `activeTab` grants access only after user action. `host_permissions` covers the backend API origin only.

Shared code: stream parsing and `MarkdownContent` are copied or imported from `frontend/src/shared` via a Vite alias; keep the extension self-contained if the alias causes build friction.

## Data flow

1. User clicks the toolbar icon → side panel opens.
2. Not signed in → "Sign in with Google" → `launchWebAuthFlow` → ID token → `POST /auth/google` → JWT saved → `GET /me` shows name.
3. User highlights text → right-click "Ask Birdie about this" → background stores `{url, title, selection}` → side panel shows a removable context chip.
4. Or "Ask about this page" → `chrome.scripting.executeScript` returns `document.body.innerText` (truncated to 20k chars).
5. Send → `POST /birdie/stream` with `{message, history, page_context}` → streamed answer rendered as markdown.

## Backend changes

- `CORS_ORIGINS`: add `chrome-extension://<extension-id>` (pin the ID with a `key` in the manifest so it is stable).
- `/birdie/stream`: accept optional `page_context: {url, title, text}`; validate the length server-side (max 20k chars); inject into the prompt clearly labelled as user-supplied web content, not instructions.
- `/auth/google`: accept the extension's Google OAuth client ID as an allowed audience (new env `GOOGLE_EXTENSION_CLIENT_ID`) if it differs from the web client.
- Document the new field, env var, and extension setup in README and AGENTS.md.

## Disclosure

The side panel shows a one-line notice: selected/page text is sent to DeepSeek, or OpenRouter when the user has saved a personal key.

## Error handling

- 401 → clear JWT, show sign-in.
- Restricted pages (`chrome://`, Web Store) → "Birdie can't read this page"; chat still works.
- Oversized page → truncate, show "page truncated" in the chip.
- Network/stream errors → inline error with retry.

## Testing

- Backend: pytest for `page_context` validation, the length cap, and prompt labelling.
- Extension: manual checklist — load `dist/`, sign in, selection flow, page flow, restricted page, expired token.

## Out of scope

Chrome Web Store listing, Firefox, auto-reading pages, saving clips into Documents/KB.
