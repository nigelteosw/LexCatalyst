# Birdie Mentor Lessons + Personal OpenRouter Key — Design

Date: 2026-10-01
Status: Approved for planning

## Goal

Seniors should be able to teach juniors with no extra work. Feedback they already give while
redlining becomes lessons in the junior's Birdie. Users can also supply their own OpenRouter key
to power Birdie.

Demo story: the junior submits a PDF, the senior redlines it and returns or completes the round,
and the junior opens Birdie to find the senior's comments plus distilled lessons. They click
**Explain this** and Birdie talks it through.

## Non-goals

- No senior-facing "Teach" box. Lessons come only from review annotations.
- No change to the KB promotion flow. It stays available, just not required.
- The Progress tab stays a placeholder.
- No firm-wide or admin-managed key.
- Main chat stays on DeepSeek. The OpenRouter key powers Birdie only.

## Current state

- Review rounds (`ReviewHandoff`) end in a terminal status, `returned` or `completed`, and then
  never change (`ALLOWED_TRANSITIONS` in `review_handoff_service.py`).
- `ReviewAnnotation` carries `anchor_quote`, `suggested_text`, `note`, `author_user_id`, `page_no`.
- Birdie (`birdie_service.py`) streams via `DeepSeekProvider` hardwired to `deepseek-v4-flash`. Its
  Review tab shows two hardcoded starter cards.
- `field_encryption.encrypt_text` / `decrypt_text` exist for at-rest encryption.

## 1. Lessons from redlines

### Data

New table `review_lessons` (Alembic migration):

| column | type | notes |
|---|---|---|
| `id` | String(36) PK | `new_uuid` |
| `handoff_id` | FK `review_handoffs.id`, `ondelete=CASCADE`, indexed | |
| `title` | String(200) | short lesson headline |
| `body` | Text | 1–3 sentences, general principle |
| `source_annotation_ids` | JSON list[str] | annotations the lesson came from |
| `created_at` | timestamptz | `server_default=now()` |

### Which comments count as feedback

An annotation counts as feedback for the user when:

- its handoff has `submitted_by == user.id` and `status in {"returned", "completed"}`, and
- `author_user_id != handoff.submitted_by` (the junior's own marks are not lessons), and
- it has a non-empty `note` or `suggested_text`.

Only the submitter sees lessons for their round. Reviewers and unrelated users get 404, which
keeps Birdie's privacy stance (personal to the junior) and the existing matter boundary.

### Service: `app/services/lesson_service.py`

- `list_feedback_rounds(db, *, user, limit=10) -> list[FeedbackRound]`: rounds with at least one
  feedback annotation, newest `completed_at`/`updated_at` first. Each round has handoff id,
  document filename, reviewer name, status, date, feedback annotations (page order) and any stored
  lessons.
- `distill_lessons(db, *, user, handoff_id) -> list[ReviewLesson]`:
  1. Load the round and check the feedback rules above (else `LessonNotFound`).
  2. If lessons already exist, return them.
  3. Build one prompt with the feedback annotations (id, quote, suggestion, note). Ask for 1–4
     general lessons as JSON: `[{"title", "body", "source_annotation_ids"}]`. Lessons must be
     transferable principles, not restatements of a single edit, and must not invent reasons the
     senior did not give.
  4. Call the user's Birdie provider (section 3) without holding a DB transaction open.
  5. Parse and validate: drop lessons whose source ids aren't in the round and cap at 4. On
     unparseable output, raise `LessonDistillError`.
  6. Lock the handoff (`lock_handoff`) and re-check whether lessons exist. If another request won
     the race, return those and discard ours. Otherwise insert and commit.
- `format_feedback_context(db, *, user) -> str`: the latest ~10 feedback annotations as a
  "Recent feedback from your reviewers" block for the Birdie system prompt (document, reviewer,
  quote, note, suggestion; each field truncated).

### Routes (`app/routers/birdie.py`)

| method | path | auth | behaviour |
|---|---|---|---|
| GET | `/birdie/lessons` | signed-in user | `list_feedback_rounds` for the current user |
| POST | `/birdie/lessons/{handoff_id}/distill` | signed-in user, must be the round's submitter | idempotent; returns stored or newly distilled lessons. 404 if not the user's round or no feedback; 502 with detail on provider/parse failure |

### Birdie prompt

`build_birdie_messages` appends `format_feedback_context` after the workboard block, so Ask can
answer "why did my reviewer change the indemnity?"

## 2. Birdie Review tab (frontend)

- `shared/api/api.ts`: `listBirdieLessons()` and `distillBirdieLessons(handoffId)`, with
  snake→camel mapping. Types go in `shared/types/workspace.ts`.
- `ReviewTab` replaces `STARTER_CARDS`:
  - Empty state: "Feedback from your reviewers will appear here after a review is returned."
  - One group per round: header with document name · reviewer · status · date.
    - **Lessons**: distilled cards (`tip` tone). If the round has none, fire `distill` once
      (TanStack `useMutation`, triggered when the group renders) and show "Distilling lessons…".
      On error, show an inline message with **Retry**; raw comments stay visible.
    - **Comments**: one card per annotation with quote (italic), suggested wording, note, page
      number, and an **Explain this** button.
- **Explain this** switches to the Ask tab and sends: `Explain this feedback from my reviewer on
  "<document>" (p.<n>): quoted "<quote>", suggested "<suggestion>", note "<note>". Why does it
  matter and what should I do next time?` Lift `activeTab` and a `pendingPrompt` in
  `BirdiePanelBody` (which already owns `activeTab`), so `AskTab` sends the prompt once and clears it.
- Update `BIRDIE_HELP` text for the Review tab.

## 3. Personal OpenRouter key

### Data

New table `user_settings` (same migration):

| column | type | notes |
|---|---|---|
| `user_id` | FK `users.id` PK, `ondelete=CASCADE` | one row per user |
| `openrouter_api_key` | Text, nullable | stored via `encrypt_text` |
| `openrouter_model` | String(200), nullable | null = default |
| `updated_at` | timestamptz | |

### Provider

- `app/providers/openrouter.py`: `OpenRouterProvider(api_key, model)` using `AsyncOpenAI` with
  `base_url="https://openrouter.ai/api/v1"`. Exposes `stream_chat(messages)` and `chat(messages)`,
  the same shapes Birdie uses from `DeepSeekProvider`. Errors raise `OpenRouterError`.
- Default model constant: `anthropic/claude-sonnet-4.5`.
- `app/services/birdie_provider.py` (or a function in `birdie_service.py`):
  `get_birdie_provider(db, user)` returns an object with `stream_chat` / `chat`:
  - user has a key → `OpenRouterProvider(decrypted_key, model or default)`
  - otherwise → DeepSeek with `deepseek-v4-flash` (today's behaviour).
- No silent fallback: if the user's key fails, the error surfaces. The Birdie stream route
  catches `OpenRouterError` and emits `error` with "Your OpenRouter key was rejected or ran out of
  credit — check Settings." (auth/402/429) or the provider message otherwise.

### Service and routes

`app/services/user_settings_service.py`: `get_birdie_settings`, `update_birdie_settings`,
`clear_openrouter_key`.

| method | path | auth | behaviour |
|---|---|---|---|
| GET | `/settings/birdie` | signed-in user | `{has_openrouter_key, key_last4, openrouter_model, effective_model}`; never returns the key |
| PUT | `/settings/birdie` | signed-in user | body `{openrouter_api_key?, openrouter_model?}`; blank model → null; key trimmed, 10–500 chars |
| DELETE | `/settings/birdie/openrouter-key` | signed-in user | clears the key; Birdie returns to DeepSeek |

Each route only reads or writes the current user's row.

### Settings UI

New "Birdie model" section in `SettingsPanel.tsx`:

- Status line: "Using your OpenRouter key (…abcd) · anthropic/claude-sonnet-4.5" or "Using the
  firm default (DeepSeek)".
- Password input for the key (never pre-filled), text input for the model with the default as
  placeholder, **Save**, and **Remove key** when one exists.
- Short note: Birdie prompts, including document context and reviewer feedback, are sent to
  OpenRouter and the chosen model provider when a key is set (AGENTS.md external-LLM rule).

## Error handling summary

| case | behaviour |
|---|---|
| distill on someone else's round | 404 |
| provider failure during distill | 502; tab shows retry, raw comments still shown |
| model returns bad JSON | 502 `LessonDistillError`; nothing stored |
| concurrent distill | first commit wins; loser returns stored lessons |
| bad/expired OpenRouter key | Birdie error event pointing to Settings; no fallback |
| no key | DeepSeek, as today |

## Testing

Backend (pytest, alongside existing service tests):

- Feedback filtering: the submitter sees reviewer annotations from returned/completed rounds;
  active rounds, the junior's own annotations and empty notes are excluded.
- Access: reviewer and unrelated user get 404 on distill and see nothing in list.
- Distill: stores lessons once; second call makes no provider call (stub provider); invalid
  source ids dropped; bad JSON raises and stores nothing.
- Provider selection: with key → OpenRouter with decrypted key and model; without → DeepSeek.
- Settings API: key is stored encrypted, never returned; `key_last4` correct; delete clears it.

Manual demo pass: junior submits → senior redlines and returns → junior's Birdie Review tab shows
comments, lessons distil, **Explain this** answers in Ask. Repeat with an OpenRouter key set,
and with a bad key to see the Settings pointer.

## Docs

- README: new routes and auth, OpenRouter per-user key, data sent to OpenRouter.
- AGENTS.md: OpenRouter provider for Birdie, new services, new migration head.
