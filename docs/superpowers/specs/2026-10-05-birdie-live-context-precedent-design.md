# Birdie extension: live context, Precedent, conversations, model choice

Date: 2026-10-05 · Source brief: `LexCatalyst — Developer Brief.md` (build order phase 2)

## Goal

Make the Birdie Chrome extension aware of what the lawyer is reading and highlighting, surface the firm's
past drafting of the highlighted clause (Precedent), let the lawyer start a clean conversation, and let them
choose the model Birdie uses through OpenRouter.

Out of scope for this spec: the full Research feature (beyond eLitigation case lookup), Review, Word/Outlook add-ins, direct tracked-change
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

## 6. Case law: eLitigation only

Rule: **any case or judgment Birdie names must come from eLitigation (https://www.elitigation.sg)**, with a
link to the judgment. Birdie must not cite a case from model memory. (This overrides the brief's
"no external case law in v1" for this one public source.)

### Backend

- `app/services/elitigation_service.py`:
  - `search_judgments(query, limit=5)` — GET
    `https://www.elitigation.sg/gd/Home/Index?Filter=SUPCT&YearOfDecision=All&SortBy=Score&SearchPhrase=<q>&CurrentPage=1&SortAscending=False&PageSize=0&Verbose=False&SearchQueryTime=0&SearchTotalHits=0&SearchMode=True&SpanMultiplePage=False`
    with httpx (10 s timeout), parse result cards with BeautifulSoup. Returns
    `[{citation, title, court, decision_date, url, catchwords}]`, where `url` is
    `https://www.elitigation.sg/gd/s/<YYYY_COURT_N>` and `citation` is taken verbatim from the card
    (e.g. `[2011] SGCA 1`).
  - `fetch_judgment_excerpt(url, query)` — fetch the judgment page, return the paragraphs that best match
    the query (keyword overlap, ≤ 4,000 chars) with paragraph numbers for pinpoint citation.
  - In-memory TTL cache (1 h) keyed by query/url; a polite `User-Agent` naming LexCatalyst.
- Birdie gets a tool step: before answering, `birdie_service` asks the model (JSON mode) whether the
  question needs case law and, if so, for a search phrase. It runs `search_judgments`, fetches excerpts for
  the top 3, and injects them into the system prompt as an `eLitigation sources` block. The system prompt
  instructs: cite only cases in that block, use the citation verbatim, link the URL, and say
  "I couldn't find this on eLitigation" rather than citing anything else.
- Post-check: `validate_case_citations(answer, sources)` scans the final answer for neutral-citation
  patterns (`[YYYY] SGXX N`) and appends a warning line for any not in `sources`.
- Streaming: a new SSE event `sources` carries the eLitigation results before tokens, so the panel can show
  them.
- Outbound text: only the search phrase leaves for eLitigation (a public court site); no document or
  client text is sent there. Document this in README.
- Before shipping: confirm that eLitigation's terms of use permit automated search queries at this rate;
  if not, fall back to opening the search URL in a new tab for the user.

### Extension

- A **Cases** list under each Birdie answer that used eLitigation: citation, title, decision date, and a link
  that opens the judgment in a new tab.
- A "Search eLitigation" quick action uses the current selection as the query.

## Error handling

- 401 anywhere → signed-out view (existing `UnauthorizedError`).
- Content script unavailable (no permission / chrome:// page) → chips hidden, "Ask about this page" button
  remains.
- Precedent / settings failures show inline errors; chat remains usable.

## Testing

- Extension (vitest): selection normalising/debounce, context priority (selection over page),
  settings payload mapping.
- Backend (pytest): `summarise_terms`, `extract_terms` regexes, `/precedent/search` returns only documents
  the user can access and redacts other-matter client names, audit row written; eLitigation result parsing against a saved HTML fixture; `validate_case_citations` flags citations not in sources.
- Manual: load unpacked build, verify chip on a normal page and Google Docs, New chat, model switch.
