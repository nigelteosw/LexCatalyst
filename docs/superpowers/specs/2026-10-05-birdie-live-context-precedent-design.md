# Birdie extension: live context, Precedent, conversations, model choice

Date: 2026-10-05 · Source brief: `LexCatalyst — Developer Brief.md` (build order phase 2)

## Goal

Make the Birdie Chrome extension aware of what the lawyer is reading and highlighting, surface the firm's
past drafting of the highlighted clause (Precedent), let the lawyer start a clean conversation, and let them
choose the model Birdie uses through OpenRouter.

Out of scope for this spec: Research and Review features, Word/Outlook add-ins, direct tracked-change
insertion into Google Docs, DMS connectors, SSO.

## 1. Live selection context

- New content script `src/content/selection.ts`, injected only on origins the user has approved
  (`chrome.permissions` `optional_host_permissions`; registered via `chrome.scripting.registerContentScripts`
  after grant).
- Listens to `selectionchange`, debounced 300 ms, and sends
  `{type: 'selection', text, url, title}` via `chrome.runtime.sendMessage`. Empty selection sends `text: ''`.
- Selection is held in side panel state only; nothing leaves the device until the user sends a chat
  message or runs Precedent.
- **Google Docs:** the editor is canvas-rendered, so `getSelection()` is empty. The script attaches a
  `copy` listener inside `.docs-texteventtarget-iframe` and reports the copied text as the selection. The
  right-click "Ask Birdie about this" menu remains the fallback. This is spiked first (plan task 1); if it
  fails, Docs falls back to the context menu only and the chip says "Copy (⌘C) or right-click to share".
- **UI:** a chip directly above the `Ask Birdie…` textarea:
  `Highlighted: "The Option Period shall be 14 days…"  ×`. Truncated to two lines. × dismisses it until
  the selection changes. On send, it becomes `web_context` with `source: 'selection'`.
- Pure helper `src/lib/selection.ts` (`normaliseSelection`, debounce) is unit-tested with vitest.

## 2. Page awareness

- On tab activation/URL change, if the origin is approved, the side panel reads the page with the existing
  `readActiveTabText` logic (Google Docs export or `innerText`), split into `readPermitted` (no permission
  prompt) and the existing gesture-driven path.
- Shown as a second chip `Page: <title>  ×` beneath the selection chip.
- When sending: selection present → `source: 'selection'`; otherwise page → `source: 'page'`.
  Backend `WebContext` already accepts both; no backend change.

## 3. New conversation / clear context

- Header button **New chat** (also `⌘K` / `Ctrl+K` in the panel): aborts any in-flight stream, clears
  `turns`, streaming text, errors, the selection chip and page chip.
- Conversation turns persist to `chrome.storage.session` (`birdieTurns`) so closing/reopening the panel
  keeps the chat until New chat or browser restart. New chat removes the key.
- No backend change: `POST /birdie/stream` is stateless and takes `history` from the client.

## 4. Model choice via OpenRouter

Reuses existing backend routes (no backend change):
`GET /settings/birdie`, `PUT /settings/birdie`, `DELETE /settings/birdie/openrouter-key`,
`GET /settings/birdie/models`.

- Header shows the active model (`DeepSeek (firm default)` or the OpenRouter model id); clicking opens a
  **Model** view in the panel.
- Model view: OpenRouter API key field (write-only, shows "Key saved" when set, Remove button), searchable
  model list from `/settings/birdie/models`, Save. Without a key, the list is disabled with a note that the
  firm default is used.
- Choice is per user and shared with the web app's Settings page (same row).
- Disclosure under the composer updates to name the active route: "Sent to DeepSeek" or
  "Sent to OpenRouter → <model provider>".
- API functions added in `src/lib/api.ts` (snake_case → camelCase mapped there).

## 5. Precedent

### Backend

- `app/services/precedent_service.py`:
  - `classify_clause(text) -> str` — DeepSeek flash, constrained to a fixed list
    (`option_period`, `governing_law`, `limitation_of_liability`, `termination`, `confidentiality`,
    `payment_terms`, `notice`, `other`). Input is redacted first (see below).
  - `search_precedents(db, user, text, clause_type, limit=8)` — calls existing
    `rag_service.search_documents` (permission-scoped) and `knowledge_bank_service.search_kb_for_chat`
    (scoped + already redacted); merges, de-duplicates by chunk/entry id.
  - `extract_terms(results)` — regex first (days, %, currency amounts, jurisdiction names); returns
    `{kind, value, unit}` per result. No LLM.
  - `summarise_terms(results) -> list[{value, unit, count}]` — pure function, sorted by count.
  - Redaction: results from matters the user is not a `MatterMember` of have client/party names replaced
    using the existing `_propose_redactions` fallback rules plus the matter's `client_name`; text sent to
    the LLM is the redacted form.
- `app/routers/precedent.py`: `POST /precedent/search` body `{text, url?}`; auth required
  (`get_current_user`). Response:
  `{clause_type, terms_summary: [...], results: [{id, source_type, excerpt, document_title, matter_ref,
  date, author, status, open_url|null, term}]}`. Results with no resolvable source are dropped.
- Audit: each call writes a `KnowledgeBankAccessLog` row (`action='precedent_search'`) listing returned ids.
- Migration: add nullable `Document.execution_status` (`draft`/`executed`); executed results rank first.
  Update "Current head" in `AGENTS.md`.
- Document the route in `README.md`.

### Extension

- Tabs in the panel: **Chat** | **Precedent**.
- Precedent tab runs for the current selection on a **Find precedent** button (and auto-runs when the tab is
  open and the selection changes, debounced 800 ms).
- Shows clause type, terms summary row (e.g. `14 days ×3 · 21 days ×5 · 30 days ×1`), then result cards:
  excerpt, title, matter ref, date, author, `Executed`/`Draft` badge, **Copy**, **Use in chat**
  (puts the excerpt into the chat as context), **Open** (only when `open_url` present).
- Empty state: "No firm precedent found for this clause." Never a card without a source.

## Error handling

- 401 anywhere → signed-out view (existing `UnauthorizedError`).
- Content script unavailable (no permission / chrome:// page) → chips hidden, "Ask about this page" button
  remains.
- Precedent / settings failures show inline errors; chat remains usable.

## Testing

- Extension (vitest): selection normalising/debounce, context priority (selection over page),
  settings payload mapping.
- Backend (pytest): `summarise_terms`, `extract_terms` regexes, `/precedent/search` returns only documents
  the user can access and redacts other-matter client names, audit row written.
- Manual: load unpacked build, verify chip on a normal page and Google Docs, New chat, model switch.
