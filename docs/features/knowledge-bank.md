# Knowledge Bank — The Firm's Institutional Memory

> Upload a document, click "Add to Knowledge Bank". A background job summarises it with DeepSeek Pro into a structured, scannable brief that the agent can search and that lawyers can read in under a minute.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**Senior partner pain**:
- "Retrain juniors" (over and over, every cohort)
- "Lots of review of work → additional work"

**Knowledge Bank brief**:
- "Playbooks created by firm"
- "Uploadable"
- "Style guides"
- "Formats / templates"

**Style guide brief**:
- "Trained on docs + comments"
- "Sanitised data / Anonymised confidential data"

**IHC brief** (target buyer):
- "Less external cost when work outsourced"
- "Standardisation of style w/ client"

Law firms generate enormous amounts of institutional knowledge — partner redlines, deal precedents, style preferences — that lives in three places:

1. **The partner's head** — leaves the firm when they retire.
2. **A SharePoint folder no one knows about** — there but unsearchable.
3. **A junior associate's Word doc of "things to remember"** — re-discovered every cohort.

The Knowledge Bank centralises this. But three things make a *legal* knowledge bank different from a generic document store:

- **It needs structure.** A lawyer doesn't want "here's the document, search it yourself". They want: *what is this, what are the key points, what should I watch out for, how do I use it?*
- **It needs access control.** A trainee shouldn't see a partner's negotiation preferences before they understand why.
- **It needs to be embedded in the work.** Browsing playbooks is something nobody does. The agent searches the KB during chat — that's how juniors actually encounter the firm's positions.

## What we built

### Three categories
Simplified from a 7-type taxonomy to the categories lawyers actually use:

| Category | What goes in it |
|---|---|
| `knowledge_bank` | Playbooks, precedents, templates, formats |
| `style_guide` | Writing standards, partner preferences, formatting rules |
| `action` | Soft-skill guides, wellness resources, advice content (powering Birdie's "Examples" tab) |

### Four scopes (visibility)

| Scope | Who can read | Who can write |
|---|---|---|
| `firm_wide` | Every authenticated user | Partners or admins only |
| `team` | Team members | Team members |
| `matter` | Matter members | Matter members |
| `private` | The creator only | The creator only |

### Async ingestion (the "Add to Knowledge Bank" pipeline)

A user uploads a 50-page document. They click "Add to Knowledge Bank". A typical legal doc takes 30–60 seconds to summarise comprehensively. We don't want them waiting.

```
[Sync, <100ms]
create_pending_kb_entry
  status="processing", body=""
  → return 202 Accepted with placeholder

[Async, 30–60s, BackgroundTasks]
process_kb_summary
  load up to 80 chunks (~240KB)
  DeepSeek Pro → comprehensive summary
  parse JSON → title + body_markdown
  embed → pgvector
  status="ready"

[Frontend]
poll GET /kb/entries every 3s while any status === "processing"
```

### The summary format
The prompt requires every KB summary to have:
- **What This Is** — one paragraph
- **Key Points** — 4–8 bullets, each cited inline as `[p.X]`
- **Risk Flags** — 2–4 bullets, omit if none
- **How to Use** — 1–3 bullets on practical application

350–600 words total. Designed to be readable in 60 seconds. The "narrative essay" output that LLMs produce by default is explicitly forbidden in the system prompt.

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **3 categories, not 7** | Lawyers don't sort their knowledge into "precedent vs clause vs partner_pref vs entity". They sort it into "the firm's positions" / "how we write" / "people advice". Engineering taxonomies are not lawyer taxonomies. |
| **DeepSeek Pro for summarisation** | Flash is too shallow for legal documents. Pro reads more context and produces more reliable structured output. The 30–60s cost is paid once per document, then the summary is reused forever. |
| **80-chunk limit (~240KB)** | Fits Pro's context window comfortably. A typical 50-page transaction doc fits whole. Long-form NDAs and SPAs do too. |
| **Inline `[p.X]` citations, no footnote** | Earlier prompts produced "Source Notes" sections with UUID-style references — completely unreadable. Lawyers want to know which page a claim came from at the moment they read the claim. |
| **`status="processing"` placeholder pattern** | The user gets immediate feedback that the job is queued. The KB list shows the entry with a "Summarising..." pill so they know it's coming. |
| **Retry on failure** | DeepSeek calls can fail (rate limits, transient errors). The user clicks "Retry summary" and the entry resets to `processing`. No data lost; no orphaned state. |
| **Idempotent ingestion** | Clicking "Add to KB" twice on the same doc returns the existing entry. No duplicates. |
| **`embedding_content_hash`** | When a KB entry's title or body is edited, the embedding refreshes automatically in the same transaction. No stale embeddings, no "I edited this two months ago and search still returns the old text" problem. |

## How the agent uses it

The agent has two relevant tools:
- `search_knowledge_bank(query)` — RBAC-filtered semantic search. Returns up to 6 KB entries.
- `get_kb_entry(entry_id)` — fetch a full summary. Returns `source_document_id` so the agent can chain into `read_document` if the summary isn't detailed enough.

This is the difference between a knowledge bank and a folder of PDFs: the agent uses the KB by default, and only falls back to the raw document when the summary isn't enough.

## Roles & permissions

- **Partner / admin**: create firm-wide entries, edit/delete any entry they can read.
- **Senior associate**: create team/matter/private entries.
- **Associate**: create matter/private entries.

A junior can never accidentally make a partner-preferences entry firm-visible — the route returns 403.

## Limitations

- Summaries are LLM-generated and can be wrong. Treat them as study aids, not authoritative sources. The original document is always linked.
- The 80-chunk cap means very long documents (>100 pages) lose later content from the summary. The agent can still `read_document` for the full text.
- We don't currently support OCR-quality flags. If Tesseract produced garbage from a scanned PDF, the summary will too.
- No version history on KB entries beyond a `version` counter. Edits are atomic, with no diff view.

## Where it lives in the code

| Concern | Path |
|---|---|
| Async ingestion service | `backend/app/services/kb_ingestion_service.py` |
| KB CRUD + RBAC filter | `backend/app/services/knowledge_bank_service.py` |
| API routes | `backend/app/main.py` → `/kb/*` |
| Migration (status column) | `backend/migrations/versions/f3a4b5c6d7e8_add_kb_entry_status.py` |
| Frontend panel | `frontend/src/components/KnowledgeBankPanel.tsx` |
| Frontend ingestion button | `frontend/src/components/DocumentsPanel.tsx` |

## Related RFC

See [`rfc-knowledge-bank.md`](../rfc-knowledge-bank.md) for the original scopes, audit, and redaction design.
