# RFC: Structured Review Handoff

Status: Proposed
Date: 2026-06-14
Owner: LexCatalyst product/backend
Related: [`rfc-knowledge-bank.md`](./rfc-knowledge-bank.md), [`features/actions-delegation.md`](./features/actions-delegation.md), [`plans/document-review-redlining.md`](./plans/document-review-redlining.md)

---

## 1. Problem Statement

When a senior lawyer (Sarah) delegates a contract review to a junior (Jane), the handoff back is brittle:

- Jane finishes her review, exports a PDF of marked-up clauses with her notes, and emails it across — or drops it into the matter folder with a Slack ping.
- Sarah re-opens the PDF, hunts for Jane's flags, re-reads the original clause to compare, and often re-does the analysis herself because the reasoning isn't structured enough to trust at a glance.
- When Sarah eventually arrives at the "right" answer — accept, edit, or reject Jane's suggestion — that judgment dies in the chat thread. Next quarter another trainee asks the same question on a different matter.

The pain is not redlining. The firm already has Word and the future redline path is covered by [`plans/document-review-redlining.md`](./plans/document-review-redlining.md). The pain is **the review handoff**: Sarah needs to see Jane's reasoning side-by-side with the original clause and decide quickly, and the firm needs that decision to become reusable Knowledge Bank guidance instead of vanishing.

This RFC proposes a lightweight **Structured Review Handoff**: Jane uploads her work product as a PDF, the system extracts a list of flagged clauses with proposed revisions and reasoning, Sarah reviews each one with approve/edit/comment controls, and approved guidance is promoted into the Knowledge Bank.

Full Word-style tracked changes and `.docx` redline export are **explicitly out of scope** here — they are the next phase, owned by the redlining plan.

---

## 2. Product Narrative

The 40–55s segment of the demo script captures the workflow:

> *Switch to Sarah. Open Jane's review action and cited analysis.*
> "Sarah can review Jane's reasoning and supporting clauses without repeating the entire task herself."
>
> *Sarah approves or edits a suggested Knowledge Bank entry.*
> "Her feedback becomes reusable matter knowledge, reducing repeated guidance and future back-and-forth."

End-to-end story:

1. **Sarah delegates.** Sarah creates an action on the Workboard: "Review the indemnity and limitation-of-liability clauses on the Meridian NDA." The action is assigned to Jane and tied to the Meridian matter.
2. **Jane works.** Jane reviews the contract (in LexCatalyst, in Word, on paper — doesn't matter for this RFC). She produces a PDF of her analysis: each clause she's flagged, her proposed wording, and her reasoning with citations to firm precedent or playbook sections.
3. **Jane uploads.** Jane attaches the PDF to her action item and marks it ready for review. The system extracts the structured findings.
4. **Sarah reviews.** Sarah opens the action and sees a clause-by-clause panel: original clause on the left, Jane's proposed revision on the right, Jane's reasoning + citations below. For each finding she can **Approve**, **Edit** (adjust the wording or reasoning), or **Comment** (push back, ask for rework).
5. **Sarah promotes.** When a finding represents reusable guidance — "this is how we always push back on uncapped indemnities" — Sarah promotes it to the Knowledge Bank with one click. Promotion runs through the existing PII pipeline from [`rfc-knowledge-bank.md`](./rfc-knowledge-bank.md) §7.
6. **Loop closes.** Jane sees Sarah's decisions on each finding. Approved KB entries are now in scope for future matter chats and for the next trainee who hits a similar clause.

---

## 3. Scope

**In scope**

- PDF upload of junior's review work, attached to an action item.
- LLM-driven extraction of findings from the PDF into a structured shape: `{ original_clause, proposed_revision, reasoning, citations[] }`.
- Side-by-side clause comparison UI for the senior.
- Approve / edit / comment controls per finding.
- One-click promotion of an approved finding into a `clause` or `playbook` KB entry (reusing §7 of the KB RFC).
- Tying findings back to the originating action item so the Workboard reflects review progress.

**Out of scope (explicit)**

- Word-style tracked changes, `.docx` redline ingest, or `.docx` export. Covered by [`plans/document-review-redlining.md`](./plans/document-review-redlining.md).
- A drafting surface for Jane to *produce* the review inside LexCatalyst. v1 assumes she works in Word or on paper and exports a PDF. A future iteration can replace the PDF upload with native authoring.
- Multi-round handoff. v1 supports one review round (junior → senior). A push-back becomes a new action item; we do not version findings within a single handoff.
- Counterparty-facing redlines. This is internal firm review only.
- Automatic LLM judgment on whether Jane's reasoning is correct. The system extracts and presents; Sarah judges.

---

## 4. Data Model

Additive on top of the existing schema. No drops, no destructive migrations.

### New tables

**`review_handoffs`** — one row per junior-produced review package.

```
id,
action_id           (fk → action_items.id, nullable for ad-hoc reviews),
matter_id           (fk → matters.id),
document_id         (fk → documents.id)   ← the uploaded PDF
submitted_by        (fk → users.id)       ← the junior
submitted_at,
status              (extracting | ready_for_review | in_review | completed | returned),
reviewer_id         (fk → users.id, nullable)  ← the senior assigned to review
completed_at        (nullable),
created_at, updated_at
```

`status` transitions:

```
extracting → ready_for_review → in_review → completed
                                          ↘ returned (rework requested)
```

**`review_findings`** — one row per flagged clause extracted from (or manually added to) a handoff.

```
id,
handoff_id          (fk → review_handoffs.id),
sequence            (int, 1-based, preserves the order from the PDF),
original_clause     (text)               ← quoted from the source contract
proposed_revision   (text, nullable)     ← null = "flag for discussion, no rewrite yet"
reasoning           (text)
citations           (jsonb)              ← [{kind: 'kb_entry'|'playbook'|'doc'|'external', ref, label}, …]
status              (pending | approved | edited | rejected | needs_rework),
reviewer_edit       (text, nullable)     ← senior's edited wording, if status=edited
reviewer_comment    (text, nullable)
promoted_kb_entry_id (fk → kb_entries.id, nullable),
reviewed_by         (fk → users.id, nullable),
reviewed_at         (nullable),
created_at, updated_at
```

Indexes: `(handoff_id, sequence)`, `(handoff_id, status)`.

### Modified tables

- **`action_items`** — gain `active_handoff_id` (nullable fk → `review_handoffs.id`). When the assignee uploads a review, this is set; clearing it (e.g. on rework) returns the action to the assignee.
- **`documents`** — no schema change. The uploaded PDF is a normal `Document` row with `matter_id` set. The handoff references it by id.

### Why not reuse `document_comments` or `document_suggestions`?

Both exist (or are planned) and look superficially similar. We deliberately keep `review_findings` separate because:

- A handoff is a *bounded review package*, not a free-floating comment thread. Status and lifecycle belong to the package, not to individual comments.
- Findings carry richer structure (proposed revision, reasoning, citations, promotion link) than comments need.
- The redlining plan's `document_suggestions` are anchored into a `.docx` HTML render. Findings here anchor to a PDF and don't need character-offset precision — the original clause text is quoted in full.

The two models can converge later if a unified "anything that needs a senior's accept/edit/reject" abstraction emerges.

---

## 5. Extraction Pipeline

When Jane uploads a PDF and marks the handoff ready:

1. **Ingest** — the PDF is stored as a normal Document (existing path; OCR runs if needed per recent commits).
2. **Schedule extraction** — a background job sets `review_handoffs.status = 'extracting'` and calls an extractor.
3. **Extract** — an LLM call with a structured-output schema returns an array of findings. Prompt sketch:

   > You are given a junior lawyer's review of a contract. Extract each distinct issue they have flagged. For each, return: `original_clause` (verbatim from the source contract as quoted in the review), `proposed_revision` (their suggested wording, or null if they only flagged it), `reasoning` (their explanation, in their own words), `citations` (any references they made to firm precedent, playbooks, statutes, or cases). Do not invent findings. Do not summarise away the reasoning.

4. **Persist** — findings are written to `review_findings` with `status = 'pending'`, status flips to `ready_for_review`, the assigned reviewer is notified on the Workboard.

Failure modes:

- **Extraction returns zero findings.** Handoff is marked `ready_for_review` with an empty list and a flag; the senior sees the raw PDF and can add findings manually.
- **Extraction times out** (we've already raised timeouts in `9a5d872` and `aebaa65`). Job moves to a `extraction_failed` sub-state and surfaces an "open PDF directly" fallback. The senior can still review; they just don't get the structured pane.
- **Hallucinated quotes.** The "original clause" must appear verbatim in the source contract (matched against the matter's other documents if available, or string-matched within the same PDF). Findings whose `original_clause` doesn't match are flagged "quote not verified" in the UI rather than dropped.

The extractor is **not** asked to judge correctness. It transcribes Jane's work into structured form; Sarah judges.

---

## 6. Review UI

The review experience lives in the existing action-item detail dialog and in a dedicated **Review pane** in the context panel. No new top-level navigation.

### Discovery and entry points

How Sarah actually finds out Jane has submitted something. There are no email or in-app push notifications in v1 — discovery is surfaced inside the product.

1. **Sidebar badge (primary signal).** The Workboard nav item in the sidebar gains a count badge showing "reviews waiting for you" — action items where the current user is the assigner (or explicit `reviewer_id`) and the linked handoff is in `ready_for_review`. Cheap, no notification infra, and it follows Sarah across pages so she sees the count whether she's in a chat, the KB, or another matter. Clicking the badge takes her to the Workboard filtered to that list.

2. **Workboard "Review" column.** When Jane marks her action ready for review, the card moves from "In Progress" into the existing Review column (per [`features/actions-delegation.md`](./features/actions-delegation.md)) and gets a "Handoff ready" pill driven by `active_handoff_id`. Clicking the card opens the action detail dialog, which now has a "Review handoff" tab — the entry into the clause-by-clause pane.

3. **Matter Documents tab.** The uploaded PDF is a normal `Document` scoped to the matter, so it appears in the matter's Documents list with a "Linked review handoff →" badge. Useful when Sarah is already in the matter for another reason.

4. **KB entry back-reference.** Once a finding has been promoted, the resulting KB entry carries a "Promoted from review of *Meridian NDA* by Jane on 2026-06-12" footer linking back to the handoff. Not a discovery path for *new* reviews — a way to trace context on existing KB entries.

The badge query is the load-bearing piece: `count(action_items where assigner_id = me AND active_handoff_id IS NOT NULL AND linked handoff.status = 'ready_for_review')`. Same predicate powers the filtered Workboard view.

### Layout — clause-by-clause comparison

For each finding:

```
┌─ Finding 3 of 7 — Indemnity cap ────────────────── [Approve] [Edit] [Comment] ─┐
│                                                                                  │
│  Original clause                       Jane's proposed revision                  │
│  ─────────────────────────             ──────────────────────────────            │
│  "The Indemnifying Party shall         "The Indemnifying Party shall             │
│   indemnify the Indemnified Party       indemnify the Indemnified Party          │
│   against all losses, costs,            against all direct losses, costs,        │
│   damages and expenses…"                damages and expenses, capped at          │
│                                         the aggregate fees paid…"                │
│                                                                                  │
│  Reasoning                                                                       │
│  ─────────                                                                       │
│  Uncapped indemnities expose the client to unlimited liability. Firm playbook    │
│  caps indemnities at fees paid in the preceding 12 months absent strategic       │
│  reason to vary. Counterparty has not given a reason.                            │
│                                                                                  │
│  Citations                                                                       │
│  ─────────                                                                       │
│  • KB: "M&A Indemnity Caps — standard position"  ↗                              │
│  • Playbook: NDA §4.3                            ↗                              │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Controls per finding (reviewer only):

- **Approve** — marks `status='approved'`, no edits.
- **Edit** — opens a text editor prefilled with `proposed_revision`; on save sets `status='edited'` and stores `reviewer_edit`. Jane's original wording is preserved on the row.
- **Comment** — adds a `reviewer_comment` and either keeps the finding `pending` (for back-and-forth) or marks it `needs_rework` (returns the handoff to Jane).
- **Reject** — `status='rejected'`. Used when the senior disagrees outright; not the same as "needs rework".
- **Promote to KB** — visible once status is `approved` or `edited`. Opens the existing KB promotion flow (§7 of the KB RFC) prefilled with `original_clause`, the chosen wording (edited or proposed), and the reasoning. PII pipeline runs as normal. On approval, `promoted_kb_entry_id` is set.

Header strip on the Review pane:

- Progress: "3 of 7 reviewed" with a small bar.
- Bulk actions: "Approve all remaining" (with confirmation), "Return to Jane for rework" (sets handoff status to `returned`, action moves back to assignee).
- "Mark review complete" — only enabled when no findings remain `pending`. The backend enforces the same condition, sets `status='completed'`, stamps `completed_at`, and moves the active linked Workboard action to `done`.

### Citations panel

Clicking a citation chip opens the referenced KB entry in the existing KB entry viewer (context panel), or scrolls the source document if the citation is a doc reference. Citations are inert in v1 — we don't attempt to follow external case-law links.

### Junior's view

When status is `in_review`, `completed`, or `returned`, Jane sees the same panel in read-only form with Sarah's decisions inline (approved / edited wording shown alongside her original / comments visible). `returned` findings (`needs_rework`) are highlighted; Jane addresses them and re-submits, which creates a new handoff row linked to the same action.

---

## 7. Knowledge Bank Promotion

Promotion reuses the pipeline from [`rfc-knowledge-bank.md`](./rfc-knowledge-bank.md) §7 — this RFC does not redesign it.

What's new is the *prefill*: when the reviewer clicks "Promote to KB" on a finding, the KB entry draft is pre-populated with:

| KB field | Sourced from |
|---|---|
| `entry_type` | `clause` by default; reviewer can switch to `playbook` or `partner_pref`. |
| `title` | LLM-suggested from the reasoning, editable. |
| `body_markdown` | A templated body containing: **Standard position** (the approved/edited revision), **Reasoning** (Jane's reasoning, editable), **Example** (the original clause as the counter-example), **Citations**. |
| `scope` | Defaults to `matter` (matches the source). Promoting to `team` or `firm_wide` runs through the PII gate. |
| `tags` | LLM-suggested from the matter and clause topic. |

After PII approval, `review_findings.promoted_kb_entry_id` is set. The finding card surfaces a "Promoted →" link in place of the button.

This is the load-bearing moment for the product narrative: a single click turns a one-off review decision into reusable firm knowledge.

---

## 8. RBAC

Inherits from the existing model (KB RFC §4, Workboard's `is_senior_or_above`).

| Action | Who |
|---|---|
| Upload a PDF and create a handoff | The assignee of the action item, or any matter member if no action is linked |
| Trigger extraction | System (background job) |
| Add / edit findings before submission | The submitter |
| Review (approve / edit / comment / reject) | The action's assigner OR any partner on the matter OR the explicit `reviewer_id` |
| Mark review complete | Same as review |
| Promote to KB | Reviewer; PII gate applies (KB RFC §7) |
| View a handoff | Any matter member |

In super-user mode (KB RFC §4.1) all enforcement is bypassed but `reviewer_id` is still recorded so post-mockup enforcement layers on cleanly.

---

## 9. API Plan

```
POST   /handoffs                                  ← create handoff (links PDF + action + matter)
GET    /handoffs/{handoff_id}
PATCH  /handoffs/{handoff_id}                     ← change status, assign reviewer, mark complete
POST   /handoffs/{handoff_id}/extract             ← re-run extraction if it failed or PDF was replaced

GET    /handoffs/{handoff_id}/findings
POST   /handoffs/{handoff_id}/findings            ← manual add (e.g. extraction returned nothing)
PATCH  /handoffs/{handoff_id}/findings/{id}       ← reviewer approve / edit / comment / reject
DELETE /handoffs/{handoff_id}/findings/{id}

POST   /handoffs/{handoff_id}/findings/{id}/promote   ← entry into KB promotion (returns draft kb_entry id)
```

Background job: `extract_review_handoff(handoff_id)` invoked from `POST /handoffs` and from re-run.

---

## 10. Build Order

1. Schema — `review_handoffs`, `review_findings`, `action_items.active_handoff_id`. Migration is purely additive.
2. Handoff CRUD — create from an action item, attach a PDF, list findings.
3. Extraction job — LLM call with structured output, persistence, status transitions, timeout/failure handling. Reuses the polling and timeout patterns from the recent ingest changes (`9a5d872`, `aebaa65`).
4. Review pane UI — clause-by-clause cards with approve/edit/comment/reject and progress header. Read-only mode for the submitter.
5. KB promotion prefill — reuse the existing KB promote flow; build the templated body and tag suggestions.
6. Workboard integration — surface handoff state on action items, "ready for review" highlight, return-to-rework flow.
7. Sidebar "reviews waiting for you" badge — count query + filtered Workboard view.
8. Fallbacks — empty extraction, extraction failure, "quote not verified" badges, manual finding add.
9. Audit trail — handoff and finding state changes flow into `kb_access_log` (or a parallel log) so partners can see review history.

Phases 1–4 are the demo critical path (steps that the 40–55s script narrates). 5 closes the loop on the "feedback becomes reusable matter knowledge" line. 6–8 harden the workflow.

---

## 11. Open Questions

1. **Where does the PDF originate?** For the demo, Jane exports from Word and uploads. Longer term, native authoring inside LexCatalyst removes the PDF step entirely — this RFC's data model is agnostic; findings can be created directly rather than extracted.
2. **Should findings link back to the *source contract* PDF, not just Jane's review PDF?** Useful for verifying the original clause quote. v1 just stores the quoted text; v2 could link to a character range in the matter's source contract once that's been ingested.
3. **Multi-reviewer.** A partner and a senior associate sometimes both want to weigh in. v1 has a single `reviewer_id`; if this becomes a real workflow we add a `review_handoff_reviewers` join.
4. **Notifications.** Resolved for v1 — no email or in-app push. Discovery is the sidebar badge + Workboard Review column (see §6). Email/push can layer on later if review SLA becomes a real concern.

---

## 12. Out of Scope for this RFC

- `.docx` redline export — see [`plans/document-review-redlining.md`](./plans/document-review-redlining.md).
- Native in-app authoring of the review (no PDF round-trip).
- LLM-driven judgment on whether the junior's reasoning is correct.
- Counterparty-facing review workflows.
- Multi-round versioning of findings within a single handoff.

---

## References

- [`rfc-knowledge-bank.md`](./rfc-knowledge-bank.md) — KB scopes, PII pipeline, promotion gate (§4, §7).
- [`features/actions-delegation.md`](./features/actions-delegation.md) — Workboard / action items that this RFC hangs the handoff onto.
- [`plans/document-review-redlining.md`](./plans/document-review-redlining.md) — the future redlining surface this RFC explicitly does *not* replicate.
- [`plans/pdf-viewer-comments.md`](./plans/pdf-viewer-comments.md) — existing PDF viewer + comments path the uploaded review re-uses for display.
