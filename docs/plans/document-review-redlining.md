# Plan: Document review + redlining

> Builds on [`pdf-viewer-comments.md`](./pdf-viewer-comments.md). That plan stays as-is — it ships a read-only PDF drawer with matter-wide comments so people can see their own documents. This plan layers the *review* workflow on top: DOCX rendering, text-anchored comments, suggested edits, versions, and a counterparty accept/reject pass.

## Why

The PDF drawer is the right thing for "open a file I uploaded and skim it." It is the wrong thing for the actual legal job-to-be-done: **contract redlining**.

Redlining is the back-and-forth where one side proposes changes (insert / delete / amend), the counterparty reviews and accepts or rejects each, and the doc converges to a final version that everyone signs. It has properties that an iframe + flat comment thread can't express:

- Revisions live *inside* the document text, not beside it. A flat thread can't show "delete clause 7.2, insert clause 7.2'."
- Comments anchor to specific text ("this indemnity is too broad"), not to the whole file. "Check clause 7.2" pinned to clause 7.2 is the entire point.
- Documents have *versions*. v1 is the counterparty's draft, v2 has our redlines, v3 has their response. Losing track of which is current is the single most common redlining failure mode.
- Contracts that get redlined are `.docx`, not `.pdf`. PDFs are the *output* — what gets signed at the end.

We are punting all of this in the existing plan. Building it correctly now means we don't have to throw away the comments table the moment a real lawyer tries to use this for review.

## What we're building

A second mode in the document drawer — **Review mode** — that activates for `.docx` files (and, optionally later, for PDFs via `react-pdf`). Read-only PDF viewing from the existing plan remains the default for everything else.

### DOCX rendering — server-side mammoth → semantic HTML

Three candidate architectures, with the tradeoffs that matter:

| Approach | Fidelity | Anchored comments | Track changes | Cost |
|---|---|---|---|---|
| **mammoth → HTML, render in drawer** | medium (some layout loss) | yes — stable DOM ranges | yes, with a custom transform | low; pure backend work |
| LibreOffice headless → PDF | high | no (PDF is opaque) | flattened to visuals only | medium; LibreOffice in container |
| OnlyOffice / Collabora editor | native Word parity | yes, native | yes, native + accept/reject | high; separate service |

**Pick mammoth.** It is the only path that gives us a substrate for anchored comments *and* preserves track-changes structure without buying into a heavyweight editor. OnlyOffice stays on the table as a future swap if we ever need true Word parity.

The non-obvious gotcha: mammoth by default *drops* `w:ins` / `w:del` (Word's track-changes XML elements). We write a small custom transform that emits `<ins data-author=… data-ts=… data-rev-id=…>` and `<del …>` so revisions render visibly and remain queryable. This transform is the load-bearing piece of the entire feature — it's what turns a viewer into a redliner.

Output: a JSON payload containing the rendered HTML plus a `revisions[]` array (id, author, timestamp, kind, text, anchor) extracted from the same pass. The frontend hydrates revisions as React-controlled overlays so accept/reject can mutate them.

Render route:

```python
@router.get("/documents/{document_id}/render")
def document_render(...) -> DocumentRenderResponse:
    # Returns: { html, revisions, anchors, version_id, fallback_kind? }
    # fallback_kind is set when mammoth can't handle the doc — frontend
    # falls back to the iframe PDF viewer (or download).
```

Cache the render output keyed on `(document_version_id, transform_version)` so we don't re-mammoth on every drawer open.

### Comments — anchored, with a matter-wide fallback

Extend the `document_comments` table from the existing plan rather than create a parallel one:

```python
op.add_column("document_comments", sa.Column("anchor_start", sa.Integer(), nullable=True))
op.add_column("document_comments", sa.Column("anchor_end",   sa.Integer(), nullable=True))
op.add_column("document_comments", sa.Column("anchor_quote", sa.Text(),    nullable=True))
op.add_column("document_comments", sa.Column("document_version_id", sa.String(36),
              sa.ForeignKey("document_versions.id", ondelete="CASCADE"), nullable=True))
op.add_column("document_comments", sa.Column("resolved_at",  sa.DateTime(timezone=True), nullable=True))
op.add_column("document_comments", sa.Column("resolved_by",  sa.String(36),
              sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
```

Semantics:

- `anchor_start` / `anchor_end` are character offsets into the rendered HTML's flat text. Null ⇒ matter-wide (the existing-plan case still works).
- `anchor_quote` stores the actual quoted text. When the document changes (new version), we use the quote to *re-locate* the anchor on the new version — offsets alone don't survive edits. Best-effort: if the quote no longer matches, the comment surfaces as "orphaned, originally on:" with the snippet.
- `document_version_id` pins the comment to a version. Comments carry forward to new versions when their anchor can be re-located.
- `resolved_at` / `resolved_by` let you mark a comment "addressed" without deleting it. Audit trail matters in legal.

### Suggested edits — separate concept, same anchor model

A comment is a discussion ("this clause is too broad"). A suggested edit is a proposed text change ("delete X, insert Y") that can be accepted or rejected. Same anchor mechanics, different payload:

```python
class DocumentSuggestion(Base):
    __tablename__ = "document_suggestions"
    id:                  Mapped[str]
    document_version_id: Mapped[str]            # version this was proposed against
    user_id:             Mapped[str]            # proposer
    kind:                Mapped[str]            # "insert" | "delete" | "replace"
    anchor_start:        Mapped[int]
    anchor_end:          Mapped[int]
    anchor_quote:        Mapped[str]            # for re-location robustness
    proposed_text:       Mapped[str | None]     # null for pure deletes
    rationale:           Mapped[str | None]     # short note from proposer
    status:              Mapped[str]            # "pending" | "accepted" | "rejected"
    resolved_by:         Mapped[str | None]
    resolved_at:         Mapped[datetime | None]
    created_at, updated_at: ...
```

The "track changes from the source DOCX" revisions and the "suggested edits made inside our app" suggestions converge into the same UI affordance — a pending revision the reviewer accepts or rejects. They differ only in provenance (an imported revision has an `imported_from_revision_id`, an app-native one does not).

### Versions

```python
class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id:               Mapped[str]
    document_id:      Mapped[str]               # parent doc; .name etc. stay on Document
    version_no:       Mapped[int]               # monotonic per document
    storage_key:      Mapped[str]               # R2 key for THIS version's bytes
    parent_version_id: Mapped[str | None]       # for tree-style branches; usually linear
    created_by:       Mapped[str]
    created_at:       Mapped[datetime]
    label:            Mapped[str | None]        # "Counterparty draft", "Our redlines", etc.
```

When does a new version exist?

1. Upload — v1.
2. "Accept all pending suggestions and finalize" — creates v(n+1) with edits applied to the underlying `.docx` via `python-docx`.
3. Re-upload (counterparty sent a new draft) — v(n+1), parent set to whatever we last finalized.

The drawer always shows a specific version. A small version picker in the header lets you switch. A "compare against vN" mode (diff between two versions' rendered HTML) is **out of scope** for this plan but the data model supports it.

### Editing lock — turn-of-the-pen

Concurrent editing is hard *and* legal practice is turn-based anyway ("you redline first, then I respond"). v1 uses a simple lock:

```python
class DocumentLock(Base):
    __tablename__ = "document_locks"
    document_id:  Mapped[str]   # primary key
    held_by:      Mapped[str]   # user_id
    acquired_at:  Mapped[datetime]
    expires_at:   Mapped[datetime]  # auto-release after N minutes idle
```

Holding the lock = the only one who can create suggestions or accept/reject. Everyone else sees a read-only review view. UI shows "Sarah has the pen — request it?" Pen-passing is explicit; no auto-grab.

### Export — applying accepted edits back to .docx

The dead-end the existing plan would have walked into: once you've accepted a stack of suggestions, you need a real `.docx` to send back to the counterparty.

Approach: keep the *original* `.docx` immutable; on finalize, use `python-docx` to walk the original document and apply each accepted suggestion's mutation (insert / delete / replace), then save the result as the new version's `storage_key`. Rejected suggestions are dropped. The applied edits are recorded as Word `w:ins` / `w:del` so the counterparty's Word client sees them as native track changes.

The risk to call out: re-locating an offset-based suggestion onto the original DOCX's XML is non-trivial. Mitigation: store enough context per suggestion (the surrounding paragraph index, the quoted run text) to anchor robustly. If anchoring fails, the suggestion is flagged "needs manual application" rather than silently dropped.

This is the most technically uncertain part of the plan. Worth a 1-day spike before committing to the full design.

## Backend changes — summary

- New tables: `document_versions`, `document_suggestions`, `document_locks`.
- Extend `document_comments` with anchor + version columns (migration alongside the one in the existing plan, not a replacement).
- New service: `app/services/document_render_service.py` — mammoth wrapper with the `w:ins`/`w:del` transform; caching by `(version_id, transform_version)`.
- New service: `app/services/document_redline_service.py` — suggestion CRUD, accept/reject, finalize-and-apply via `python-docx`.
- New routes under `/documents/{id}/`:
  - `GET /render?version=…` — returns rendered HTML + revisions + anchors.
  - `GET /versions`, `POST /versions/finalize`.
  - `GET /suggestions`, `POST /suggestions`, `PATCH /suggestions/{id}` (accept/reject), `DELETE /suggestions/{id}`.
  - `POST /lock`, `DELETE /lock`, `POST /lock/request`.
- Reuse the existing-plan access predicate (`can_access_document`) everywhere. Suggestions/finalize additionally require holding the lock.

Python deps to add: `mammoth`, `python-docx`. Both pure-Python, no system libs.

## Frontend changes — summary

- New types in `frontend/src/types/workspace.ts`: `DocumentVersion`, `DocumentSuggestion`, `DocumentRevision`, `DocumentLock`, anchor fields on `DocumentComment`.
- `frontend/src/lib/api.ts` — render fetch, versions, suggestions, lock endpoints.
- The existing `DocumentDrawer` (from `pdf-viewer-comments.md`) gains a *mode*:
  - **View mode** (PDFs, and DOCX when mammoth fallback fires) — unchanged from the existing plan.
  - **Review mode** (DOCX with successful render) — three panes inside the drawer:
    1. Rendered HTML with overlays for pending revisions/suggestions, anchored comment markers in the gutter.
    2. Right rail listing all comments + suggestions for the current version, grouped by anchor, clickable to scroll.
    3. Header strip with version picker, "Sarah has the pen / Take the pen" lock control, and a "Finalize…" button (lock-holder only).
- Selection-to-anchor: when the user selects text inside the rendered HTML, show a small floating menu — "Comment" / "Suggest edit". Suggest-edit opens a tiny diff input prefilled with the selected text.
- Accept/reject UI: each pending revision/suggestion gets inline ✓ / ✗ controls (lock-holder only); resolved items collapse but stay in the right rail.
- Reuse `MarkdownContent` for comment bodies and suggestion rationale.

## Verification

1. Upload a `.docx` with Word track-changes already present → drawer opens in Review mode, the insertions/deletions render as styled overlays, the right rail lists each revision with author + timestamp.
2. As lock-holder: select a phrase → "Suggest edit" → propose a replacement → it appears as a pending suggestion in the rail and as an overlay in the doc.
3. As another matter member: see the same suggestion in read-only review view; cannot accept/reject; can leave an anchored comment.
4. Take the pen → accept one suggestion, reject another, click "Finalize" → v2 is created, downloads as a `.docx` whose Word track-changes match what was accepted.
5. Open v2 in Word desktop → accepted changes appear as native `w:ins`/`w:del`, "Accept All" in Word produces clean text.
6. Re-upload a counterparty response as v3 → comments from v2 whose `anchor_quote` still matches re-attach; orphaned ones surface in an "Unanchored" group.
7. Existing-plan PDF flow: open a PDF → still the iframe view, still the matter-wide comments thread. No regression.
8. Mammoth render fails on a pathological DOCX → drawer falls back to the View-mode iframe (rendered via LibreOffice-to-PDF in a later phase, or download for now).

## Phasing

This is a big plan. Suggested order:

1. **Versions + render** (mammoth, no track-changes transform yet, no anchors). Drawer shows DOCX as HTML, versions exist behind the scenes. Existing PDF + comments behavior unchanged.
2. **Anchored comments** on top of versions. Extend `document_comments`. Selection → comment.
3. **Lock + suggestions** (app-native suggested edits, no DOCX import of track changes yet). Accept/reject mutates an in-memory revision set.
4. **Track-changes import** (the `w:ins`/`w:del` mammoth transform). Imported revisions unify with app-native suggestions in the UI.
5. **Finalize → .docx export** via `python-docx`. This is the spike-first item; if export proves too fragile, fall back to "download the HTML render as a `.docx` via pandoc" with reduced fidelity.

Phase 1 is shippable on its own (lawyers can finally *see* their DOCX files in-app). Phase 2 is where this becomes meaningfully different from the existing plan. Phases 3–5 are where it becomes a redlining product.

## Out of scope (later)

- Real-time collaborative cursors (Google-Docs style). The lock model deliberately sidesteps this.
- @mentions and notifications. Worth a separate plan once Phase 2 ships.
- Side-by-side version diff view (vN vs vM rendered together).
- AI-suggested redlines / playbook checks (e.g. "this indemnity exceeds our standard cap"). Separate epic.
- True Word parity (numbered list edge cases, complex tables, embedded objects). If we hit a fidelity ceiling with mammoth, that's the OnlyOffice trigger.
- Signature workflow. Out of scope here entirely.
