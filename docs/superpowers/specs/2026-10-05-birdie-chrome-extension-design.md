# Birdie Chrome Extension — Design

Date: 2026-10-05

## Goal

Users install a Chrome extension, sign in with their LexCatalyst account, and get Birdie (the AI mentor) as a helper on any webpage. Out of the box it talks to the hosted production backend.

## Decisions

- **Location:** new top-level folder `extension/`, separate from `frontend/` and `backend/`. Self-contained Bun package.
- **Output:** `bun run build` emits `extension/dist/` — a ready-to-load unpacked extension (Chrome → `chrome://extensions` → Developer mode → "Load unpacked" → select `extension/dist`). `bun run package` zips it to `extension/birdie-extension.zip` for sharing. Chrome Web Store publishing is out of scope.
- **Backend target:**
  - `bun run build` → hosted backend `https://lexcatalyst-production.up.railway.app` (default).
  - `bun run build:local` → `http://127.0.0.1:8000`.
  - Set at build time via `VITE_API_URL`; `src/lib/config.ts` falls back to the hosted URL.
- **UI surface:** Chrome Side Panel API (no DOM injection into host pages).
- **Page access:** on demand only. Birdie sees highlighted text (via context menu) or the page text when the user clicks "Ask about this page". Nothing is read automatically.
- **Auth:** Google sign-in via `chrome.identity.launchWebAuthFlow` (OAuth implicit flow, `response_type=id_token`) → existing `POST /auth/google` → LexCatalyst JWT stored in `chrome.storage.local`. Reuses the existing web OAuth client (`GOOGLE_CLIENT_ID`): add `https://<extension-id>.chromiumapp.org/` as an authorised redirect URI in Google Cloud Console. No backend auth change.
- **Stable extension ID:** pin the ID with a public `key` in `manifest.json` so the redirect URI is the same on every machine.

## Structure

```txt
extension/
  package.json            # Bun + Vite + React + TS + Tailwind + Vitest
  vite.config.ts          # multi-entry build: sidepanel.html + background.ts -> dist/
  sidepanel.html
  .env.example            # VITE_GOOGLE_CLIENT_ID=
  public/manifest.json    # MV3; copied into dist/
  (icons: Chrome default for now; Birdie art later)
  src/
    background.ts         # context menu, side panel behaviour
    sidepanel/
      main.tsx
      BirdieSidePanel.tsx # chat UI, sign-in screen, context chip, disclosure
      MarkdownContent.tsx # copy of frontend/src/shared/ui/MarkdownContent.tsx
      sidepanel.css
    lib/
      config.ts           # API_URL, GOOGLE_CLIENT_ID
      sse.ts              # SSE event parsing (pure, unit-tested)
      webContext.ts       # WebContext type + truncation (pure, unit-tested)
      api.ts              # signIn exchange, fetchMe, streamBirdie
      auth.ts             # launchWebAuthFlow + token storage
      pageText.ts         # permission request + chrome.scripting page read
```

Manifest permissions: `sidePanel`, `contextMenus`, `scripting`, `storage`, `identity`. `host_permissions`: the hosted backend and `http://127.0.0.1:8000/*` only (this also exempts extension fetches from CORS, so no `CORS_ORIGINS` change is needed). `optional_host_permissions: ["<all_urls>"]` — requested per-origin at the moment the user clicks "Ask about this page".

## Data flow

1. User clicks the toolbar icon → side panel opens (`openPanelOnActionClick`).
2. Not signed in → "Sign in with Google" → `launchWebAuthFlow` → ID token → `POST /auth/google` → JWT saved → user name shown.
3. Highlight text → right-click "Ask Birdie about this" → background writes `{url, title, text, source: "selection"}` to `chrome.storage.session` and opens the panel → panel shows a removable context chip.
4. Or "Ask about this page" → `chrome.permissions.request` for that origin → `chrome.scripting.executeScript` returns `document.body.innerText` → truncated to 20,000 chars → chip with `source: "page"`.
5. Send → `POST /birdie/stream` with `{message, history, web_context}` → streamed answer rendered as markdown.

## Backend changes

- `app/schemas.py`: new `WebContext` model (`url` ≤ 2048, `title` ≤ 500, `text` 1–20,000 chars, `source: Literal["selection", "page"]`). Do **not** reuse `PageContext` — that already describes which LexCatalyst view the user is on.
- `app/routers/birdie.py`: `BirdieRequest.web_context: WebContext | None = None`, passed through.
- `app/services/birdie_service.py`: `web_context` param on `build_birdie_messages` / `stream_birdie_response`; `_format_web_context` appends a block to the system prompt, fenced and labelled as untrusted user-supplied web content to analyse, never as instructions.
- Document the field, the extension, and the Google redirect-URI setup in README and AGENTS.md.
- The backend change must be deployed to Railway before web context works against production. Chat without context works against the current deployment.

## Disclosure

The side panel shows a one-line notice: selected/page text is sent to DeepSeek, or OpenRouter when the user has saved a personal key. This matters because the default target is production with live data.

## Error handling

- 401 → clear JWT, show sign-in.
- Restricted pages (`chrome://`, Web Store) or permission denied → "Birdie can't read this page"; chat still works.
- Oversized page → truncate, chip says "truncated".
- Network/stream errors → inline error; user can resend.

## Testing

- Backend: `backend/tests/test_birdie_web_context.py` — `WebContext` validation, length cap, prompt labelling.
- Extension: Vitest for `sse.ts` and `webContext.ts`; `tsc` + `vite build` must pass.
- Manual checklist — load `dist/`, sign in against production, selection flow, page flow, restricted page, expired token.

## Out of scope

Chrome Web Store listing, Firefox, auto-reading pages, saving clips into Documents/KB.
