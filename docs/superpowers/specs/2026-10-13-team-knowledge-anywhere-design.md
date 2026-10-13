# Team Knowledge From Anywhere — Design

**Sub-project 2 of 4.** It depends on nothing from sub-project 1, but ships after it.
Siblings: `2026-10-13-mentorship-core-design.md`, `2026-10-13-birdie-everywhere-design.md`, `2026-10-13-cut-and-simplify-design.md`.

## Intent

Firm documents live in Word and Google Drive, and connecting to those systems is out of scope. So LexCatalyst stops being where documents live and becomes **where the team's know-how lives**. The unit of team knowledge is a **knowledge item** (a precedent clause, practice note, checklist, useful case extract or good answer), saved deliberately from wherever the user is, with a link back to the source.

Upload stays as a fallback for one-off source material, but it is no longer the main way in.

### Assumptions (correct if wrong)

- Saving is always an explicit user action. Nothing is captured in the background.
- Birdie *suggests* a title, type, tags and summary, and the user confirms before saving. There is no draft state on the server.
- The default audience is the whole team. Private and matter are available.
- Until sub-project 4 folds practice groups away, "Team" in the save UI maps to the existing class-wide scope `firm_wide`. Sub-project 4 renames it.

## Data model changes (`kb_entries`)

| change | notes |
|---|---|
| add `source_url` (Text, nullable) | http(s) only, validated server-side |
| add `source_title` (String 300, nullable) | page or document title |
| add `saved_via` (String 20, nullable) | `extension`, `lexchat`, `birdie`, `web`, `upload` |
| extend `KnowledgeBankEntryType` | add `clause`, `practice_note`, `checklist`, `case_extract`. Keep the existing `knowledge_bank`, `style_guide`, `action` and `document` |

There is no new table. Embedding, PII status, audit log and the scope rules all carry over unchanged.

## Save flow

```txt
user selects text / clicks "Save to team"
  -> POST /kb/captures/preview {text, source_url?, source_title?, context?}
       Birdie (Mid tier, acting user's key) returns
       {title, entry_type, tags[], summary, body_markdown, pii_findings[]}
  -> user edits fields, picks audience (Team / Matter / Private) and optional matter
  -> POST /kb/entries {..., source_url, source_title, saved_via}
```

- `preview` stores nothing. Text is capped at 20k chars, with a 413 and a clear message above that.
- **PII:** preview runs the existing PII detector. If it finds anything, the UI shows the findings and the Team audience is disabled until the user edits them out or picks Private or Matter. The server enforces the same rule on `POST /kb/entries` (it rejects `firm_wide` when the detector flags the body), so the extension can't bypass it.
- **LLM disclosure:** the selected text goes to OpenRouter for the preview. The save dialog says so in one line, and the README provider line is updated.

## Entry points

| Where | What |
|---|---|
| **Extension: context menu** | "Save to team" on a selection. Opens the side panel on a Save view pre-filled with the selection, page URL and title |
| **Extension: side panel** | "Save page" button. Sends the readable page text (existing `pageText.ts`) trimmed to the main content |
| **LexChat** | "Save to team" on any assistant message. The body is the message, and the cited sources are appended as a "Sources" list with their links. `saved_via = lexchat` |
| **Birdie (web panel + extension)** | Same button on Birdie messages. `saved_via = birdie` |
| **Knowledge Bank page** | "New item" with a paste box and an optional URL (`saved_via = web`). It replaces the manual note form |

There is no agent tool for saving in this sub-project. Saving stays a button so it is always deliberate (YAGNI; revisit if users ask Birdie to "save that").

## Retrieval

`search_knowledge_bank` (shared tool in `agent_tools.py`) already searches KB entries. Changes:

- Return `source_url` and `source_title` with each hit. LexChat and Birdie number them as citations, with the link.
- Weight `clause`, `practice_note` and `checklist` slightly above `document` entries when the scores tie. This is a simple ordering tweak, not a new ranker.

## Frontend

- The Knowledge Bank panel is renamed **Team Knowledge** and moved up the sidebar under LexChat.
- It gains filters by `entry_type` and `saved_via`. Each item shows a source chip (favicon-free host name + title) that opens `source_url` in a new tab.
- A shared `SaveToTeamDialog` in `shared/ui/` is used by LexChat, the Birdie panel and Team Knowledge. The extension has its own copy in `extension/src/sidepanel/SaveView.tsx` (the extension is a separate bundle).
- Matter documents remain on the matter page. Upload copy changes to "Add source document" to reflect the fallback role.

## API

```txt
POST /kb/captures/preview   auth + active class; no write; LLM call on the user's key
POST /kb/entries            (existing) accepts source_url, source_title, saved_via and the new entry types
GET  /kb/entries            (existing) new filters: entry_type (new values), saved_via
```

## Errors

- No OpenRouter key or an LLM failure on preview → the dialog still opens with the raw text as the body and empty fields, plus a notice. Saving still works without the suggestion.
- An invalid `source_url` scheme → 422.
- Team audience with PII → 422 `pii_blocks_team_scope`.

## Testing

- Preview returns suggestions and writes nothing (row count unchanged).
- Server rejects `firm_wide` on a PII-flagged body. Private is accepted.
- `source_url` validation (rejects `javascript:` and `file:`).
- `search_knowledge_bank` returns the source fields, and the class boundary still holds (an item in class A is never returned to class B).
- Extension: unit test for the context-menu → Save view pre-fill; `api.test.ts` for preview mapping.

## Out of scope

Google Drive or SharePoint connectors, bulk import, automatic capture, and a Birdie save tool.
