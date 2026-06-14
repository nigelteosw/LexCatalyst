# Plan: PDF redlining for senior review

Status: In progress — Phase 1
Date: 2026-06-14
Owner: LexCatalyst product/frontend + backend
Supersedes: the **extraction pipeline** and **review UI** in [`../rfc-review-handoff.md`](../rfc-review-handoff.md) §5–§6. The handoff envelope it defines (Workboard integration, status machine, KB promotion gate) is reused unchanged.

Progress overview (see §15 for the full checklist):

- [x] Phase 1 — Schema + read-only render
- [x] Phase 2 — Highlight + strike creation
- [x] Phase 3 — Suggestion editor + notes
- [x] Phase 4 — Status machine + Workboard plumbing
- [x] Phase 5 — Reply thread + whole-draft reject
- [x] Phase 6 — Promote to skill
- [x] Phase 7 — Flattened PDF export
- [x] Phase 8 — Junior read-only view + carry-forward

> Sibling docs: [`pdf-viewer-comments.md`](./pdf-viewer-comments.md) ships the read-only PDF drawer + matter-wide comments (implemented). [`document-review-redlining.md`](./document-review-redlining.md) covers `.docx` redlining for counterparty-facing negotiation. This plan covers **internal** PDF redlining for the junior→senior review loop on the Workboard.

---

## 1. Why

The handoff RFC routes Jane → Sarah by asking an LLM to extract a structured list of findings from Jane's uploaded review PDF. That has three problems:

1. **Hallucinated or mis-quoted clauses.** The extractor has no ground truth; verbatim matching is best-effort and surfaces "quote not verified" badges that erode trust.
2. **Loss of fidelity.** A junior's careful clause-and-margin-note nuance flattens into `{original, proposed, reasoning}` triples. The reviewer can't see *where on the page* Jane was looking, or what she chose not to flag.
3. **Wrong muscle memory.** Lawyers redline PDFs and DOCXs visually — highlight, strike, propose new wording. Asking them to consume a side-by-side findings table is friction in the demo and friction in real use.

The fix is to drop the extraction step entirely and let the senior **redline the PDF directly**. The senior's marks *are* the findings. Promotion into Knowledge Bank skills still happens per-annotation, preserving the RFC's "feedback becomes reusable matter knowledge" loop.

This also unifies the model: every senior comment on a junior's work is a text-anchored annotation with optional suggested wording — the same primitive whether the senior is reviewing a draft contract, a research memo, or an analysis summary.

---

## 2. Product narrative

1. Sarah delegates an action on the Workboard tied to the Meridian matter (unchanged from the handoff RFC).
2. Jane works and uploads her output as a PDF on the action — could be a draft NDA, a marked-up clause review, or an analysis memo. She marks the action ready for review.
3. The Workboard card moves into the **Review** column. Sarah sees a "Review ready" pill and the sidebar badge increments. (All unchanged.)
4. Sarah clicks the card → action detail dialog opens to the **Review** tab → PDF renders inline with an annotation toolbar.
5. Sarah selects a clause:
   - **Highlight** to flag it as needing attention.
   - **Strike** to mark it for removal.
   - **Suggest replacement** to strike + propose new wording. A small inline editor takes the proposed text and an optional rationale note ("Uncapped indemnities exceed our standard cap — see M&A playbook §4.3").
6. Each annotation appears in the right-hand rail, grouped by page, and stays anchored to the selected text on the PDF.
7. For any annotation that captures reusable guidance, Sarah clicks **Promote to skill**. The KB entry editor opens prefilled with the original clause, the suggested wording, and her rationale. PII gate (KB RFC §7) runs as normal.
8. Sarah clicks **Mark review complete**. The handoff status flips to `completed`; the linked action moves to `done`. Sarah can optionally export a **flattened PDF** with the marks burned in (for emailing the counterparty or filing).
9. Jane sees the marks rendered in read-only mode. Annotations the reviewer flagged as `needs_rework` highlight in amber; addressing them creates a new handoff round on the same action.

---

## 3. Scope

**In scope**

- Text-anchored highlight and strike annotations on PDFs.
- Suggested replacement: strike + proposed text + optional rationale note, as one annotation primitive.
- Per-annotation promotion into a KB `skill` entry, reusing the existing PII gate.
- A live in-app rendering of annotations layered over the PDF (no destructive write to the original file).
- An on-demand flattened-PDF export with annotations baked in.
- Workboard integration: status, sidebar badge, Review column, return-to-rework — inherited from the handoff RFC §6.
- Junior's read-only view of the senior's marks.

**Out of scope (explicit)**

- Free-form drawing, shapes, or sticky-note-anywhere annotations. Every annotation in this plan is anchored to selected text. (Notes attach to a *suggestion*, not to a free point on the page.)
- LLM extraction of findings from Jane's PDF — replaced by direct redlining.
- `.docx` redline — covered by [`document-review-redlining.md`](./document-review-redlining.md).
- Counterparty-facing redlines. This is internal review.
- Multi-reviewer concurrent redlining. v1 is single reviewer per handoff round (matches the existing lock pattern in the DOCX redlining plan).
- Real-time collaborative cursors.

---

## 4. Technology choice — PDF renderer + annotation layer

Three candidate stacks, with the tradeoffs that matter:

| Approach | Text anchoring | Annotation tools | Flattened export | Cost |
|---|---|---|---|---|
| **`react-pdf` (pdf.js) + custom overlay** | Yes — pdf.js exposes a text layer with selection events | Build our own (highlight, strike, suggestion popover) | Server-side via `pdf-lib` | Free; ~200KB bundle |
| `@react-pdf-viewer/core` + plugins | Yes; the `highlight` plugin already gives anchored highlights | Highlight, strike, comment built in; suggestion needs extending | Plugin or `pdf-lib` | Free MIT; heavier bundle |
| PSPDFKit / Apryse / Nutrient (commercial) | Native | All native | Native | $$$; vendor lock-in |

**Pick `@react-pdf-viewer/core` + the `highlight` plugin.** It is the only path that gives us anchored highlights, selection popovers, and a stable text layer *without writing the text-selection-to-rect logic ourselves*. We extend the highlight plugin's annotation kind to add `strike` and `suggestion`. PSPDFKit stays on the table as a future swap if fidelity becomes a constraint.

Non-obvious gotchas:

- **pdf.js text layer is approximate.** Some PDFs (scanned, OCR'd) have a noisy or misaligned text layer; selection works but the anchored rects can drift. We store both the text quote *and* the visual rects so the rail can re-locate annotations even if pdf.js re-renders at a different zoom or with a different text-layer pass.
- **OCR'd PDFs** (the recent ingest path added OCR for image-only PDFs) emit a text layer whose runs may not align with the visual baseline. We accept this for v1; the annotation still anchors to the quote even if the highlight rectangle is a few px off.
- **Page coordinates are PDF-space, not screen-space.** Persist normalised `(page_no, x, y, w, h)` in PDF user-space units so the same annotation renders consistently at any zoom.

---

## 5. Data model

The handoff envelope from the RFC (`review_handoffs`, `action_items.active_handoff_id`) is **kept as-is**. The `review_findings` table from the RFC is **replaced** with `review_annotations` — same role (a reviewable unit attached to a handoff) but anchored on the PDF rather than extracted from it.

### Replaced table

**`review_annotations`** — one row per senior mark on a junior's PDF.

```
id
handoff_id              (fk → review_handoffs.id)
document_id             (fk → documents.id)    ← the PDF being reviewed
page_no                 (int, 1-based)
kind                    (highlight | strike | suggestion)
anchor_quote            (text, verbatim selected text from the PDF text layer)
anchor_rects            (jsonb, [{page, x, y, w, h}, …] in PDF user-space units)
suggested_text          (text, nullable — only for kind='suggestion')
note                    (text, nullable, markdown — rationale on a suggestion)
status                  (open | needs_rework | resolved | rejected)
author_user_id          (fk → users.id)        ← the senior reviewer
promoted_kb_entry_id    (fk → kb_entries.id, nullable)
previous_annotation_id  (fk → review_annotations.id, nullable)  ← carry-forward link across handoff rounds
created_at, updated_at
```

Indexes: `(handoff_id, page_no, status)`, `(document_id, page_no)`, `(promoted_kb_entry_id)`, `(previous_annotation_id)`.

`status` semantics:

- `open` — created, junior hasn't acted on it.
- `needs_rework` — reviewer explicitly flagged this annotation as blocking; surfaces in amber on Jane's side. Distinct from `open` so we can compute "ready to mark complete".
- `resolved` — junior addressed it in a re-submission, or reviewer cleared it.
- `rejected` — reviewer reconsidered and withdrew the annotation.

### New table — annotation reply thread

**`review_annotation_replies`** — back-and-forth between junior and reviewer scoped to a single annotation. This is the channel for *"I considered this, here's why I left it"* — Q2 from the original open questions.

```
id
annotation_id    (fk → review_annotations.id)
author_user_id   (fk → users.id)
body_markdown    (text)
created_at, updated_at
```

Index: `(annotation_id, created_at)`.

Replies are chronological, flat (no nested threading), markdown-formatted, and visible to anyone who can view the annotation. Either party can post; deletion is author-only. The presence of an unread junior reply is what pulls the annotation back into the reviewer's attention without flipping a status.

### Modified table — handoff-level reject reason

`review_handoffs` gains a `return_reason TEXT NULLABLE` column. When the reviewer rejects the entire draft (rather than returning specific annotations), the reason text is required and surfaces at the top of the junior's view of the returned handoff. See §7 for the UX.

### Reused, unchanged

- `review_handoffs` status machine itself (`extracting` becomes vestigial; we keep the column for forward compatibility but new handoffs skip straight to `ready_for_review`).
- `action_items.active_handoff_id`.
- `kb_entries` and the PII pipeline (KB RFC §7) — promotion target is unchanged.
- `document_comments` — matter-wide thread on the PDF stays as-is and runs *alongside* the per-annotation thread. Q1 confirmed: comments are the conversational channel (matter-wide chat about the file), annotations + replies are the structured-review channel. The drawer shows both — comments in the footer, annotations in the rail, replies inside each annotation card.

### Why not extend `document_comments`?

`document_comments` from the existing PDF viewer plan is matter-wide, flat, and unanchored. Annotations carry richer structure (anchor rects, suggested text, status lifecycle, promotion link) and a different lifecycle (bounded to a handoff round, not free-floating). The two coexist: a matter-wide comment thread on the PDF, plus reviewer annotations within the active handoff. The drawer surfaces both: comments in the footer thread, annotations in the side rail.

---

## 6. Backend changes

### Migration `m9n0o1p2q3r4` — `add_review_annotations`

```python
op.create_table(
    "review_annotations",
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("handoff_id", sa.String(36), sa.ForeignKey("review_handoffs.id", ondelete="CASCADE"), nullable=False, index=True),
    sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True),
    sa.Column("page_no", sa.Integer(), nullable=False),
    sa.Column("kind", sa.String(20), nullable=False),
    sa.Column("anchor_quote", sa.Text(), nullable=False),
    sa.Column("anchor_rects", sa.JSON(), nullable=False),
    sa.Column("suggested_text", sa.Text(), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    sa.Column("status", sa.String(20), nullable=False, server_default="open"),
    sa.Column("author_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    sa.Column("promoted_kb_entry_id", sa.String(36), sa.ForeignKey("kb_entries.id", ondelete="SET NULL"), nullable=True),
    sa.Column("previous_annotation_id", sa.String(36), sa.ForeignKey("review_annotations.id", ondelete="SET NULL"), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
)
op.create_index("ix_review_annotations_handoff_page_status", "review_annotations", ["handoff_id", "page_no", "status"])
op.create_index("ix_review_annotations_previous", "review_annotations", ["previous_annotation_id"])

op.create_table(
    "review_annotation_replies",
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("annotation_id", sa.String(36), sa.ForeignKey("review_annotations.id", ondelete="CASCADE"), nullable=False, index=True),
    sa.Column("author_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    sa.Column("body_markdown", sa.Text(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
)
op.create_index("ix_review_annotation_replies_thread", "review_annotation_replies", ["annotation_id", "created_at"])

op.add_column("review_handoffs", sa.Column("return_reason", sa.Text(), nullable=True))
```

### Cutover from the existing extraction-based flow

The handoff RFC's extraction pipeline is already implemented (`review_findings` table, `extract_review_handoff` worker job, `extracting` / `extraction_failed` states, `ReviewHandoffPane.tsx` rendering finding cards). We hard-replace it in the same migration:

```python
op.drop_table("review_findings")
# review_handoffs keeps its row shape; new handoffs skip the extracting state
# and transition straight to ready_for_review. The 'extracting' /
# 'extraction_failed' status literals stay legal for backward compat on any
# in-flight rows, but no new code path produces them.
```

Code to delete in the same change:

- `backend/app/services/review_handoff_service.py` — the `extract_*` / `restart_extraction` / claim-and-recover functions and the `status="extracting"` initialisation in `create_handoff`.
- `backend/app/worker.py` — the extraction job registration.
- `backend/app/models.py` — `ReviewFinding` model.
- `backend/app/schemas.py` — finding schemas.
- `frontend/src/features/actions/components/ReviewHandoffPane.tsx` — replaced wholesale by `ReviewPane.tsx` + `PdfRedliner.tsx` + `AnnotationRail.tsx` (see §7).
- Seeded demo `ReviewFinding` rows (if any) re-seeded as `ReviewAnnotation` rows on the same handoff so the Sarah/Jane fixtures keep working.

No feature flag; the new pane is the only consumer of the handoff envelope after cutover.

### New service — `app/services/review_annotation_service.py`

```python
def list_annotations(db, *, handoff_id, user) -> list[ReviewAnnotation]
def create_annotation(db, *, handoff_id, user, payload) -> ReviewAnnotation
def update_annotation(db, *, annotation_id, user, patch) -> ReviewAnnotation
def delete_annotation(db, *, annotation_id, user) -> None
def promote_to_skill(db, *, annotation_id, user) -> KBEntry        # returns draft entry
def export_flattened_pdf(db, *, handoff_id, user) -> bytes         # see §8

def list_replies(db, *, annotation_id, user) -> list[ReviewAnnotationReply]
def post_reply(db, *, annotation_id, user, body) -> ReviewAnnotationReply
def delete_reply(db, *, reply_id, user) -> None

def reject_handoff(db, *, handoff_id, user, reason) -> ReviewHandoff   # whole-draft reject
```

Access control: viewing annotations and replies is matter-wide. Creating/editing annotations is reviewer-only (action's assigner OR partner on the matter OR explicit `reviewer_id`). Replies are open to both the submitter and the reviewer — that's the whole point of the thread. Whole-draft reject is reviewer-only.

### Routes — `app/routers/review_handoffs.py`

```
GET    /handoffs/{handoff_id}/annotations
POST   /handoffs/{handoff_id}/annotations
PATCH  /handoffs/{handoff_id}/annotations/{annotation_id}
DELETE /handoffs/{handoff_id}/annotations/{annotation_id}
POST   /handoffs/{handoff_id}/annotations/{annotation_id}/promote
POST   /handoffs/{handoff_id}/export                                ← flattened PDF

GET    /handoffs/{handoff_id}/annotations/{annotation_id}/replies
POST   /handoffs/{handoff_id}/annotations/{annotation_id}/replies
DELETE /handoffs/{handoff_id}/annotations/{annotation_id}/replies/{reply_id}

POST   /handoffs/{handoff_id}/reject                                ← whole-draft reject; body: { reason }
```

`POST /handoffs/{handoff_id}/extract` from the RFC is removed.

### Carry-forward on re-submission

When the junior re-uploads on the same action, a new `review_handoffs` row is created and any annotation from the previous round whose `status = needs_rework` is cloned into the new round with:

- `previous_annotation_id` set to the old row's id
- `status = open`
- replies thread **carried over by re-pointing the replies** (we do not duplicate replies — the thread continues across rounds, anchored to the *new* annotation row; the old row keeps its terminal status)

`status = resolved` and `status = rejected` annotations from the previous round stay on the old handoff and are not carried forward. The reviewer sees them as historical when scrolling the previous round.

### Background job removal

The `extract_review_handoff` job (RFC §5) is **deleted**. Handoff creation transitions straight to `ready_for_review` without an `extracting` phase.

---

## 7. Frontend changes

### Files touched

- `frontend/src/types/workspace.ts` — `ReviewAnnotation`, `ReviewAnnotationKind`.
- `frontend/src/lib/api.ts` — annotation CRUD, promote, export endpoints.
- `frontend/src/features/actions/` — the action detail dialog gains a **Review** tab when `active_handoff_id` is set.
- `frontend/src/features/review/` (new):
  - `ReviewPane.tsx` — three-column layout: PDF viewer (left/main), annotation rail (right), header strip (top).
  - `PdfRedliner.tsx` — wraps `@react-pdf-viewer/core` + the highlight plugin; renders the toolbar and the selection popover.
  - `AnnotationRail.tsx` — page-grouped list of annotations with status pills, promote button, and click-to-scroll.
  - `SuggestionEditor.tsx` — inline editor that takes proposed wording + a markdown rationale note.

### Selection-to-annotation flow

1. User selects text inside the PDF viewer. The highlight plugin emits a selection event with the quoted text and per-page rects in PDF user-space units.
2. A floating popover anchors to the selection: **Highlight** · **Strike** · **Suggest…**.
3. **Highlight** / **Strike** are one-click — they POST an annotation immediately.
4. **Suggest…** opens the inline `SuggestionEditor` prefilled with the selected text. On save, POST an annotation with `kind='suggestion'`, `suggested_text`, and an optional `note`.

### Rail behaviour

- Annotations sort by `(page_no, anchor.y)` — visual reading order.
- Each card shows: kind icon, anchored quote excerpt, suggested wording (if any), note (rendered with the existing `MarkdownContent`), author, timestamp, status pill, **reply count** with an unread dot when the other party has posted since the viewer last opened the card.
- Reviewer-only controls per card: edit note, change status to `needs_rework`/`resolved`/`rejected`, **Promote to skill**, delete.
- Click a card → PDF viewer scrolls to the page and flashes the rect, and the card expands inline to show the reply thread.

### Per-annotation reply thread

Inside each expanded card sits a small chronological thread (the `review_annotation_replies` rows) rendered with `MarkdownContent`, ending in a textarea + post button. Either party can post. Cmd/Ctrl+Enter submits.

Semantics:

- **Junior** uses the thread to push back without re-uploading — *"I considered this; here's why I left it"*.
- **Reviewer** uses the thread to follow up on a junior reply or to clarify rationale without changing the annotation's status.
- A reply does **not** change `status`. The reviewer changes status explicitly via the card controls. This keeps "addressed" countable for the header progress.
- Posting a reply is the lightweight alternative to a full re-upload round. If the disagreement converges, the reviewer flips status to `resolved`; if not, the reviewer keeps it `needs_rework` and the junior re-uploads.

### Header strip

- Progress: "5 of 8 addressed" — `addressed = status != 'open' && status != 'needs_rework'`.
- "Mark review complete" — enabled when no annotation is in `open` or `needs_rework`. Confirms with a soft modal.
- "Return for rework" — flips handoff status to `returned`, moves the action card back to the assignee. Requires at least one `needs_rework` annotation; intent is "fix these specific items".
- **"Reject draft"** — flips handoff status to `returned` *without* requiring annotations. Opens a modal with a required `return_reason` textarea ("This isn't the right scope — please redo against the M&A indemnity playbook, not the NDA template."). The reason is persisted on `review_handoffs.return_reason` and rendered at the top of the junior's view of the returned handoff. Intent is "this draft is fundamentally wrong — start over".
- "Export marked PDF" — downloads the flattened PDF (§8).

The two return paths converge on the same `returned` status but signal different intent. The Workboard card surfaces a "Rejected" pill on the action when `return_reason` is set, distinct from the normal "Returned for rework" pill.

### Junior's view

Same `ReviewPane`, mostly read-only:

- Annotation toolbar is hidden.
- Rail shows cards without status-change or promote controls.
- `needs_rework` annotations get an amber accent; clicking scrolls to the page.
- **Reply input is enabled** on every annotation card — this is the junior's channel to push back on individual marks without re-uploading.
- When the handoff is in `returned` state and `return_reason` is set, a prominent banner above the rail renders the reviewer's rejection reason. The junior addresses it by re-uploading, which creates a new handoff round on the same action.

---

## 8. Flattened PDF export

Approach: keep the *original* uploaded PDF immutable in storage. On export, server-side `pdf-lib` (Node) or `pypdf` + `reportlab` (Python) walks the page tree and stamps:

- **Highlight** — a translucent yellow rect for each anchor rect.
- **Strike** — a red horizontal line through each anchor rect's vertical midline.
- **Suggestion** — strike on the original rect + a margin callout box on the same page containing the suggested text and the note. Callouts stack vertically by `y` order; if they collide they continue onto a fresh "Reviewer notes" appendix page.

The flattened PDF is stored as a new `Document` row tagged `kind='reviewed_export'` linked to the handoff. It is downloadable and visible in the matter's Documents list. Subsequent re-exports overwrite the file in place.

**Stack pick**: `pypdf` (read structure) + `reportlab` (draw overlays on a transparent layer, then merge onto each page). Both pure-Python, no system libs. Mirrors the language of the rest of the backend; avoids adding Node to the deploy.

Risk to call out: rect coordinates from pdf.js are in PDF user-space but Y-axis-inverted relative to reportlab's. The mapping is one line of code, but worth a 30-minute spike to verify the test fixture renders correctly on a rotated page.

---

## 9. Knowledge Bank promotion

Promotion reuses [`../rfc-knowledge-bank.md`](../rfc-knowledge-bank.md) §7 PII pipeline unchanged. Prefill from an annotation:

| KB field | Sourced from |
|---|---|
| `entry_type` | `skill` (the renamed `action` type from [`kb-skills-rename.md`](./kb-skills-rename.md)). Reviewer can switch to `clause` or `playbook`. |
| `title` | LLM-suggested from the note text, editable. |
| `body_markdown` | Templated: **Standard position** (suggested wording, or "flag and discuss" for highlights), **Reasoning** (the note), **Example** (the original clause as a counter-example). |
| `scope` | Defaults to `matter`. Promoting to `team` or `firm_wide` triggers the PII gate. |
| `tags` | LLM-suggested from matter and clause topic. |

On PII approval, `review_annotations.promoted_kb_entry_id` is set. The rail card swaps the **Promote** button for a **Promoted →** link to the new entry.

The promotion path is the load-bearing moment for the product story: a single click turns one mark on a PDF into reusable firm guidance.

---

## 10. RBAC

Reuses the predicates from the handoff RFC §8 and the KB RFC §4.

| Action | Who |
|---|---|
| View the PDF and annotations | Any matter member |
| Create / edit / delete annotations | Action's assigner OR a partner on the matter OR the explicit `reviewer_id` |
| Change annotation status | Same as create |
| Promote to skill | Same as create; PII gate applies |
| Mark review complete | Same as create |
| Export flattened PDF | Any matter member |

Super-user mode (KB RFC §4.1) bypasses enforcement but still records `author_user_id`.

---

## 11. Verification

1. Sarah opens an action with `active_handoff_id` set → Review tab is present and selected → PDF renders.
2. Sarah selects a clause → popover appears → click **Highlight** → annotation appears in the rail and a yellow rect renders on the PDF. Refresh: persists.
3. Sarah selects another clause → **Suggest…** → enters proposed text and a rationale note → annotation appears with suggested wording and the note rendered as markdown.
4. Sarah clicks **Promote to skill** → KB entry editor opens with prefilled body → submits → on approval, the rail card flips to **Promoted →** with a link to the new entry.
5. Sarah cannot mark complete while one annotation is `open` → button is disabled and tooltip explains why.
6. Sarah flags one annotation as `needs_rework` and clicks **Return for rework** → handoff status flips to `returned`, action returns to Jane.
7. Jane re-opens the action → sees Sarah's annotations read-only with amber pills on `needs_rework`. Jane expands one card and **posts a reply** pushing back ("This is the standard wording for this counterparty — see prior matter X."). Sarah's view shows the reply with an unread dot.
8. Sarah reads Jane's reply → posts a follow-up reply *or* flips the annotation to `resolved` if convinced. Status change is independent of replies.
9. Sarah re-opens a different submission, decides it's fundamentally wrong, clicks **Reject draft** → modal forces a `return_reason` → on submit, handoff status is `returned`, action returns to Jane with no annotations created, and the Workboard card shows a "Rejected" pill.
10. Jane re-opens the rejected handoff → sees the rejection banner with Sarah's reason at the top of the pane → re-uploads, creating a new handoff round.
11. On the new round, a previously `needs_rework` annotation from the prior round is carried forward as a fresh `open` annotation with `previous_annotation_id` set. The reply thread is continuous — Jane and Sarah's earlier back-and-forth is visible in the carried-forward card.
12. Sarah clicks **Export marked PDF** → file downloads → opens in Acrobat showing highlight rects, strike lines, and margin callouts with the suggested text.
13. As a user who is not on the matter: 403 on `GET /annotations`, the replies endpoints, and the export endpoint.
14. OCR'd PDF (image-only with extracted text layer): selection still produces an `anchor_quote`; the annotation rect may be slightly misaligned but the rail entry and the flattened export both anchor to the quote.
15. The matter-wide `document_comments` thread (from `pdf-viewer-comments.md`) renders in the drawer footer simultaneously with the annotation rail and is unaffected by handoff status — confirming the two channels coexist without conflict.

---

## 12. Phasing

Suggested order; phase 1 alone meaningfully ships the demo path.

1. **Schema + read-only render** — `review_annotations`, `review_annotation_replies`, `review_handoffs.return_reason` migration; GET endpoints; PDF viewer wired into the action detail dialog without any creation tools. Validates the renderer choice end-to-end.
2. **Highlight + strike creation** — toolbar, selection popover, POST endpoint. No suggestion editor yet.
3. **Suggestion editor + notes** — `SuggestionEditor.tsx`, kind='suggestion' on the backend.
4. **Status machine + Workboard plumbing** — needs_rework / resolved / rejected, "Mark review complete", "Return for rework".
5. **Reply thread + whole-draft reject** — per-annotation reply UI (junior + reviewer both post), "Reject draft" with required reason, rejection banner on the junior side.
6. **Promote to skill** — prefill builder, reuse existing KB promote flow.
7. **Flattened PDF export** — `pypdf` + `reportlab` stamping, new `Document` row.
8. **Junior read-only view + new-round handoff chain** — carry-forward of `needs_rework` annotations via `previous_annotation_id`; replies thread continuity across rounds.

Phases 1–6 are the 40–55s demo path (Sarah marks, replies once, promotes a skill, completes). 7–8 harden the loop for real reviewer↔junior back-and-forth.

---

## 13. Resolved decisions

1. **Matter-wide comments coexist with annotations.** The `document_comments` thread from `pdf-viewer-comments.md` stays as the conversational channel on the PDF (matter-wide chat about the file). Annotations + per-annotation replies are the structured-review channel. Both render in the drawer at once — comments in the footer, annotations in the right rail, replies inside each card.

2. **Per-annotation reply threads are first-class.** Either party (junior or reviewer) can post markdown replies on any annotation. Replies do not change the annotation's `status` — the reviewer changes status explicitly. This gives the junior a way to push back without a full re-upload, and the reviewer a way to clarify without churning state. The whole-draft **Reject draft** affordance lets the reviewer return a submission without going annotation-by-annotation when it is fundamentally wrong; the reason is required and rendered to the junior as a banner.

3. **Carry-forward across handoff rounds.** On re-submission, `needs_rework` annotations from the prior round are cloned into the new round with `previous_annotation_id` set and `status = open`. The reply thread is continuous — replies anchor to the carried-forward annotation so the conversation survives the round boundary. `resolved` and `rejected` annotations stay on the old round as history.

4. **Single reviewer per round.** Concurrent reviewers (two seniors marking the same PDF at the same time) is a real failure mode for visual redlining — two near-simultaneous "Highlight" clicks race, and there's no clean merge. v1 sidesteps this by binding the round to one `reviewer_id`. Other seniors who want to weigh in use the matter-wide `document_comments` thread, not the annotation rail. If multi-reviewer becomes a real workflow we add the lock model from [`document-review-redlining.md`](./document-review-redlining.md) (turn-of-the-pen — only the lock holder creates/modifies marks, everyone else is read-only). Out of scope here.

---

## 14. Out of scope

- Free-form drawing, shapes, stamps, signatures.
- Standalone sticky notes anywhere on the page (notes only attach to suggestions).
- `.docx` redline ingest or export.
- LLM judgment on whether the junior's reasoning is correct.
- Multi-reviewer concurrent redlining and presence indicators.
- Counterparty-facing redlines and signature workflow.

---

## 15. Implementation checklist

Tick as work lands. Each phase is independently shippable.

### Phase 1 — Schema + read-only render ✅

Backend
- [x] Alembic migration: add `review_annotations`, `review_annotation_replies`, `review_handoffs.return_reason`; drop `review_findings`
- [x] Add `ReviewAnnotation` + `ReviewAnnotationReply` models in `backend/app/models.py`
- [x] Delete `ReviewFinding` model
- [x] Add annotation/reply read schemas in `backend/app/schemas.py`; remove `ReviewFinding*` schemas
- [x] Strip extraction pipeline from `backend/app/services/review_handoff_service.py`
- [x] Strip extraction job registration from `backend/app/worker.py`
- [x] `create_handoff`: skip `extracting`, set `status='ready_for_review'` directly
- [x] Refactor `backend/app/routers/review_handoffs.py`: remove `/extract` + findings endpoints; add annotations + replies routes
- [x] New service `backend/app/services/review_annotation_service.py` with `list_annotations` + `list_replies`
- [x] Backend imports verified clean

Frontend
- [x] Install `@react-pdf-viewer/core`, `@react-pdf-viewer/default-layout`, `pdfjs-dist` (bun)
- [x] pdf.js worker configured via `new URL()` import in `ReviewPane.tsx`
- [x] Types in `frontend/src/shared/types/workspace.ts`: add `ReviewAnnotation*` types; remove `ReviewFinding*`
- [x] API client in `frontend/src/shared/api/api.ts`: add annotation/reply CRUD + reject; remove finding functions
- [x] New `frontend/src/features/actions/components/ReviewPane.tsx` — PDF renders read-only via `@react-pdf-viewer`
- [x] Deleted `frontend/src/features/actions/components/ReviewHandoffPane.tsx`
- [x] `ReviewPane` wired into `ActionDetailDialog`

Verification
- [x] No backend test suite (no tests exist)
- [x] Frontend TypeScript build: zero errors
- [ ] Manual: open an action with `activeHandoffId` set → Review tab renders the PDF inline

### Phase 2 — Highlight + strike creation ✅

- [x] POST `/handoffs/{id}/annotations` endpoint (kinds `highlight`, `strike`)
- [x] `create_annotation` in `review_annotation_service.py`
- [x] `@react-pdf-viewer/highlight` installed; selection popover (Highlight · Strike)
- [x] Annotations re-render as colored overlays via `renderHighlights`
- [x] `AnnotationRail.tsx` — grouped by page, jump-to, delete
- [x] Dialog widened to `max-w-6xl` on Review tab; two-column PDF + rail layout
- [x] TypeScript build: zero errors
- [ ] Manual: select text → highlight → refresh → highlight persists

### Phase 3 — Suggestion editor + notes

- [ ] `SuggestionEditor.tsx` inline editor with proposed text + markdown rationale
- [ ] POST accepts `kind='suggestion'`, `suggested_text`, `note`
- [ ] Rail card renders suggested wording + note via `MarkdownContent`
- [ ] Manual: suggest replacement, refresh, render matches input

### Phase 4 — Status machine + Workboard plumbing

- [ ] PATCH `/handoffs/{id}/annotations/{aid}` for status changes + edits
- [ ] Rail status pills + reviewer-only status controls
- [ ] Header progress counter
- [ ] "Mark review complete" button (disabled while any `open`/`needs_rework`)
- [ ] "Return for rework" button → handoff status `returned`, action back to assignee
- [ ] Workboard card pill reflects handoff state
- [ ] Manual: full status round-trip

### Phase 5 — Reply thread + whole-draft reject

- [ ] POST/DELETE replies endpoints; `post_reply`, `delete_reply` in service
- [ ] Expanded card shows reply thread + textarea (Cmd/Ctrl+Enter submits)
- [ ] Unread dot based on client-side last-seen timestamp
- [ ] POST `/handoffs/{id}/reject` with required `reason`; persists `return_reason`
- [ ] "Reject draft" button on senior header with reason modal
- [ ] Rejection banner on junior view when `return_reason` is set
- [ ] Manual: reply round-trip + reject flow + banner rendering

### Phase 6 — Promote to skill

- [ ] Prefill builder in `review_annotation_service.promote_to_skill`
- [ ] POST `/handoffs/{id}/annotations/{aid}/promote` (reuses `/kb/entries/promote` downstream)
- [ ] Promote button on rail cards (reviewer-only)
- [ ] Card swaps to **Promoted →** link when `promoted_kb_entry_id` is set
- [ ] Manual: promote → KB entry created → PII gate runs → link back

### Phase 7 — Flattened PDF export

- [ ] Coordinate-roundtrip spike (rotated page fixture)
- [ ] Add `pypdf` + `reportlab` to backend deps
- [ ] `export_flattened_pdf` service stamping highlights, strikes, callouts
- [ ] POST `/handoffs/{id}/export` returning `Document` row
- [ ] "Export marked PDF" header button → download
- [ ] Manual: open exported PDF in Acrobat → marks render

### Phase 8 — Junior read-only view + new-round handoff chain

- [ ] Junior view of `ReviewPane`: hide toolbar, hide status controls, keep reply input
- [ ] `create_handoff` clones prior round's `needs_rework` annotations with `previous_annotation_id` and `status='open'`
- [ ] Reply thread continuity (re-point replies to carried-forward annotation)
- [ ] `resolved`/`rejected` annotations stay on prior round as history
- [ ] Manual: re-upload chain → carry-forward annotations visible with prior reply thread

---

## References

- [`../rfc-review-handoff.md`](../rfc-review-handoff.md) — handoff envelope reused; §5 extraction pipeline and §6 review UI superseded.
- [`../rfc-knowledge-bank.md`](../rfc-knowledge-bank.md) — KB scopes, PII pipeline, promotion gate.
- [`./pdf-viewer-comments.md`](./pdf-viewer-comments.md) — base PDF viewer + matter-wide comments this plan layers onto.
- [`./document-review-redlining.md`](./document-review-redlining.md) — DOCX redlining for counterparty-facing negotiation; complementary, not superseded.
- [`./kb-skills-rename.md`](./kb-skills-rename.md) — the `skill` entry type promoted annotations land in.
- [`../features/actions-delegation.md`](../features/actions-delegation.md) — Workboard and action items.
