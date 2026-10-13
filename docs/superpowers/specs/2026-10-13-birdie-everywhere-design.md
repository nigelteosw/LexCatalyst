# Birdie Everywhere — Design

**Sub-project 3 of 4.** Depends on **sub-project 1** (the `mentor_feedback` and `lessons` tables, pairings and `format_mentorship_context`).
Siblings: `2026-10-13-mentorship-core-design.md`, `2026-10-13-team-knowledge-anywhere-design.md`, `2026-10-13-cut-and-simplify-design.md`.

## Intent

Lawyers draft in Google Docs, Word Online and Outlook, and research on LawNet, eLitigation and the wider web. Birdie should be available on any of those pages and bring the mentee's lessons and the team's guidance with it. Seniors keep commenting where they already do, and those comments become mentorship feedback.

The goal is A + B:

- **A. On demand, anywhere.** Birdie opens on any site and reads the page or the selection only when asked.
- **B. Proactive nudges.** On drafting surfaces, Birdie points out when the current paragraph repeats something the user's mentor corrected before.

Plus **comment capture**: Google Docs comments become `mentor_feedback`.

### Assumptions (correct if wrong)

- Proactive nudges are **off by default** and switched on per drafting surface by the user, because they send typed text to OpenRouter without an explicit request.
- Microsoft Word desktop is out of scope. Word Online gets on-demand help and manual capture only.
- We do not use the Google Drive API (it needs a restricted OAuth scope and app verification). Comment capture reads the open Docs page.

## 1. "Allow on all sites"

Today `extension/src/lib/sites.ts` grants one origin at a time, and `enabledOrigins()` filters out `<all_urls>`.

- Add `enableAllSites()`, which calls `chrome.permissions.request({ origins: ['<all_urls>'] })` from a click (the user gesture must be the first await).
- `syncContentScripts()` registers with `matches: ['<all_urls>']` when that permission is held, and otherwise with the per-site list (existing behaviour).
- Add an **excluded sites** list (stored in `chrome.storage.sync`) for sites where Birdie must never inject, such as banking or personal email. It is passed as `excludeMatches`.
- The side panel shows the current mode with a toggle: "This site only" or "All sites".
- **Reading stays on demand.** Injection only adds the selection bubble. Page text is read only when the user asks Birdie, saves, or captures.

## 2. Mentor-aware coaching (on demand)

- `POST /birdie/stream` already accepts `web_context` and `page_context`. Its system prompt now uses `format_mentorship_context` (sub-project 1) instead of `format_feedback_context`.
- **"Check my draft"** button in the side panel (on any page): sends the selection, or the visible document text from `pageText.ts` capped at 20k chars, to a new endpoint:

```txt
POST /birdie/check {text, source_url, source_title}
  -> {findings: [{quote, lesson_id | feedback_id | null, message, suggested_text?}]}
```

  The server builds the prompt from the user's lessons, undistilled feedback and team guidance, plus `search_knowledge_bank` hits for `style_guide` and `practice_note` entries. It uses the Mid tier on the user's key. Each finding cites the lesson or guidance that triggered it. A finding with no source is labelled "General suggestion".

## 3. Proactive nudges (B)

**Surfaces:** allow-listed drafting hosts only: `docs.google.com/document/*`, `outlook.office.com/*`, `outlook.live.com/*` and `*.officeapps.live.com/*` (Word Online). Each needs its own opt-in toggle in the side panel, and the toggle shows the disclosure line.

**Trigger (content script, `extension/src/content/nudge.ts`, new):**

- Watch the focused paragraph. When the user pauses typing for **4 s**, the paragraph has **≥ 120 chars** and its hash differs from the last check, send it.
- At most **one request per 30 s per tab** and **60 per day per user**, both enforced server-side too.
- Send only the paragraph, not the whole document.

**Server:**

```txt
POST /birdie/nudge {paragraph, source_url}
  -> {nudge: null} | {nudge: {quote, message, lesson_id | feedback_id, suggested_text?}}
```

- The prompt contains only the user's lessons and team guidance, and is instructed to return a nudge **only** when the paragraph matches one of them. No general style advice. It returns at most one nudge.
- With no lessons and no guidance, the server returns `null` without calling the LLM.
- Rate-limited per user (in-process token bucket plus a daily counter stored in `user_settings`).

**UI:** a small card next to the existing bubble: the message, "From: <lesson title>", and the buttons **Apply** (copies the suggested text to the clipboard; we don't edit the doc), **Dismiss** and **Not helpful**. "Not helpful" records `(user, lesson_id)` in a new `nudge_suppressions` table, and that lesson is left out of nudges for 30 days.

## 4. Comment capture → feedback

**Google Docs (best effort):**

- `extension/src/lib/docsComments.ts` (new) parses the open comment threads from the Docs DOM: author display name, the quoted (anchored) text, the comment body, and any suggestion text. All selectors live in this one module, with fixture tests built from saved HTML, so breakage is contained and visible.
- Side panel → **Capture feedback**: lists the parsed comments as checkboxes and has a **"For"** picker. A mentee defaults to themselves. A mentor picks one of their active mentees, and the picker lists only those.
- Submit → `POST /mentorship/feedback/capture`:

```txt
{mentee_user_id, source_url, source_title,
 items: [{author_name, anchor_quote, note, suggested_text?}]}
```

  The server checks that the caller is the mentee or an active mentor of the mentee. It matches `author_name` to an active class member by exact display name (case-insensitive). If there's a match it sets `author_user_id`; otherwise it keeps only `author_name`. Rows are created with `source = captured_comment`. Duplicates are skipped by a hash of `(mentee, source_url, anchor_quote, note)`.

**Fallback (any site, including Word Online and when the parser fails):** select the comment text → context menu **"Capture as feedback"** → the same panel with one item, which the user can edit.

**Privacy:** only the comments the user ticks are sent, and the quoted anchor text is clipped to 500 chars.

## Backend summary

```txt
POST /birdie/check                 auth + class; LLM (Mid tier, user key)
POST /birdie/nudge                 auth + class; LLM only if lessons/guidance exist; rate-limited
POST /mentorship/feedback/capture  auth + class; mentee or active mentor of mentee
```

New table `nudge_suppressions (id, class_id, user_id, lesson_id, created_at)`.
New `llm_service.FEATURES` entries: `birdie_check`, `birdie_nudge`, both defaulting to Mid.

## Disclosure

The side panel's provider line is extended as follows. On-demand reading sends the selected text to OpenRouter only when the user asks. With nudges switched on for a site, paragraphs the user types there go to OpenRouter after a pause. README and AGENTS.md get the same wording.

## Testing

- `sites.ts`: all-sites registration uses `<all_urls>` and the excludes; per-site mode is unchanged.
- `docsComments.ts`: fixture tests against two or more saved Docs HTML snapshots, plus an empty-sidebar case.
- Nudge trigger: debounce, minimum length, hash dedupe and the per-tab rate limit (fake timers).
- Server: `/birdie/nudge` returns null without lessons and makes no LLM call (mocked); rate limit returns 429; suppression excludes the lesson.
- `/mentorship/feedback/capture`: a mentor can't capture for a non-mentee; author matching; dedupe.
- `/birdie/check` cites only the caller's own lessons (no cross-mentee leakage).

## Out of scope

Word desktop add-in, Google Drive API, writing changes back into documents, and nudges on non-drafting sites.
