# Birdie inline suggestions

**Goal:** Birdie reviews a draft and turns every point into an anchored suggestion of one of three types: **replace**, **insert** or **comment**. Nothing changes the draft until a lawyer clicks accept. Every accept and reject is logged.

**Trigger:** a "Review this draft" button in the Chrome extension. It sends the page text (Google Docs export) to the backend. Birdie's review is stored on the backend and everything (reading, accepting, rejecting, replying) happens in the extension side panel. There is no web app screen.

**Rule for Birdie:** draft what the style guide and precedent can answer, fix what is mechanical, and ask only about what needs facts or judgement.

## 1. Data model (new table `birdie_suggestions`, migration after `y0b1c2d3e4f5`)

| column | notes |
|---|---|
| `id`, `review_id` | FK to the new `birdie_reviews` table |
| `clause_ref` | e.g. `3.2`, `7`, `4.1(b)`; nullable |
| `anchor_text` | exact span from the draft. Must be found verbatim in the stored text, or the suggestion is dropped |
| `anchor_start`, `anchor_end` | character offsets into `birdie_reviews.source_text`, resolved on the server |
| `type` | `replace` \| `insert` \| `comment` |
| `suggested_text` | null for `comment` |
| `reason` | one line |
| `category` | `style` \| `substance` \| `question` |
| `source` | JSON: `{kind: "kb"\|"elitigation"\|"document"\|"style_guide", id?, url?, title, section?, status?, side?, date?}` |
| `status` | `pending` \| `accepted` \| `rejected` |
| `decided_by`, `decided_at` | |

`birdie_reviews` holds:
- `id`, `user_id`, `matter_id`
- `source_url`, `title`, `source_text` (the snapshot that offsets refer to), `current_text` (with accepted changes applied)
- `model`, `status` (`processing`/`ready`/`failed`), `error`, `created_at`

Replies reuse a small `birdie_suggestion_replies` table (author, body, created_at).

## 2. Backend

- **`POST /birdie/reviews`** takes `{url, title, text, matter_id?}` and returns `{id, status}`. It runs as a DB-backed job, like the KB jobs, on the caller's key with feature `birdie_review` (default tier High).
- **`services/birdie_review_service.py`**:
  1. **Gather sources the user may see:**
     - `search_kb_for_chat` for style-guide and precedent entries (it already applies scope, matter and PII filters).
     - `search_precedents` for the firm's past clauses.
     - `find_case_sources`, which only returns eLitigation results.
  2. **Prompt:** the Birdie drafting prompt, plus a review instruction and the numbered sources. The model must return JSON `{suggestions: [...]}` with `source_ref` pointing to one of the numbered sources (or `null` for pure mechanics backed by a style guide section).
  3. **Validate:**
     - Drop any suggestion whose `anchor_text` isn't in the draft.
     - Drop any `source_ref` that isn't one of the provided sources. Unsourced substance becomes a `question` instead.
     - Run the existing eLitigation citation check on `suggested_text`.
     - For a `replace`, reject a `suggested_text` that introduces a capitalised term that is neither defined in the draft nor added by another suggestion. This catches the "Material Contract" failure.
  4. **Resolve offsets.** When an anchor appears more than once, use the occurrence inside the stated clause.
- **Decisions:**
  - `PATCH /birdie/suggestions/{id}` takes `{status: accepted|rejected}`. Accept applies the edit to `current_text` and shifts the offsets of later suggestions.
  - `POST /birdie/reviews/{id}/accept-style` accepts all pending `category=style` suggestions of type `replace`, and nothing else.
  - Each decision writes to the existing retrieval/audit log (`record_retrieval`, kind `suggestion_decision`).
- **Reads:**
  - `GET /birdie/reviews/{id}` returns the review and its suggestions.
  - `GET /birdie/reviews?url=` returns the latest review for that page, so reopening the panel restores it.
  - `POST /birdie/suggestions/{id}/replies` adds a reply.
- **Access:** owner only. If the request includes `matter_id`, it is checked with the existing matter-access helper.

## 3. Extension side panel (new **Review** tab, next to Chat and Precedent)

- **Start:** a "Review this draft" button reads the page (Google Docs text export), posts it, shows progress, and polls `GET /birdie/reviews/{id}` until it is ready.
- **Draft view:** the draft text with inline marks. Google Docs can't be edited from the extension, so the panel shows the draft itself:
  - **replace:** the original struck through, with the suggestion beside it.
  - **insert:** the suggested text shown in a block at the anchor, for example over `[JUNIOR TO DRAFT]`.
  - **comment:** a margin marker.
  - Accepted changes are applied to the displayed text.
- **Card** (opens from a mark or from the list):
  - the change
  - a one-line reason
  - the source, with status and side, linked: KB entries and documents open in the web app (`/knowledge-bank/:id`, `/documents/:id`), eLitigation judgments open on eLitigation
  - Accept, Reject and Reply
- **Groups:** **Drafted** (substance inserts), **Fixed** (style), **Needs your decision** (questions and judgement calls).
- **Bulk:** "Accept all style fixes" applies only to mechanical `style` replacements. Substance cards have no bulk action.
- **Output:** Copy accepted text, and Copy on each suggestion so the lawyer can paste it into the doc. Download `.docx` with tracked changes is optional and later.
- **Disclosure:** "The page text is sent to OpenRouter and the model provider you choose."

## 4. (merged into section 3)

## 5. Benchmark

`backend/tests/fixtures/lumen/` will hold the junior's original draft and the partner's 13 comments as `{clause_ref, anchor_text, expectation}`. A script, `scripts/benchmark_birdie_review.py`, runs a review and matches suggestions to comments by overlapping anchor spans. It then reports matched, missed and extra.

Expected outcomes for the test cases:
- Clause 7 opens at the style guide's positions and cites Meranti as the likely pushback (test case 1 updated as the reviewer asked).
- Clause 3.2 and Clause 10.1 mechanics are found.
- Percentages become figures on S$9,800,000.

## 6. Prompt changes

The drafting prompt already covers most of this. Add a review addendum:
- Return JSON only.
- Use one suggestion per point.
- Use amounts, not percentages, when the consideration is known.
- Never introduce an undefined term.
- Don't suggest anything the draft already does correctly.
- Ask for missing facts instead of giving generic checklists.
- Hedge at most once.

## Order

1. Migration, models and service, with unit tests for validation and offset maths.
2. Endpoints and audit logging.
3. Extension Review tab (button, draft view, cards, decisions).
4. (merged into 3)
5. Benchmark fixture and script. This needs the Lumen draft and the 13 comments from you.
6. Optional: `.docx` tracked-changes export.
