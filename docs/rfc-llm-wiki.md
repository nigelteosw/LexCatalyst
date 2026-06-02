# RFC: LLM Wiki for Matter Knowledge

Status: Proposed  
Date: 2026-06-02  
Owner: LexCatalyst product/backend

## Summary

LexCatalyst should add an LLM-maintained wiki that turns uploaded legal documents, chat answers, and reviewed memories into editable matter knowledge pages.

The point is not to create a public website. In this RFC, "public" means visible inside the authenticated LexCatalyst system to authorized users in the relevant workspace or matter. For implementation clarity, published wiki pages are team-visible, not internet-public.

The feature should stay aligned with the hackathon goal: reduce cognitive load for junior lawyers. Instead of forcing a junior lawyer to repeatedly rediscover facts, risks, definitions, clause positions, and prior analysis from raw files, the system should maintain a small living wiki that answers:

```txt
What do we know?
Where did it come from?
What changed?
What still needs review?
```

## Goals

- Create editable Markdown wiki pages from uploaded documents.
- Support user-owned draft pages and team-visible published pages.
- Keep every wiki page grounded in source citations.
- Show only generated wiki pages by default, not full raw source files.
- Let users inspect cited chunks through a source drawer.
- Add a Quartz-inspired page view with backlinks and a graph view.
- Let chat retrieve from wiki pages before falling back to raw document chunks.
- Preserve human edits through page revisions.
- Keep the implementation in normal FastAPI services, not MCP or agent orchestration.

## Non-Goals

- No public internet publishing of legal wiki pages.
- No standalone Quartz runtime in the MVP.
- No Obsidian vault syncing in the MVP.
- No MCP integration.
- No LangGraph or complex agent runtime.
- No private wiki page feature in the MVP.
- No automatic publishing of user memories into team pages.
- No full-document viewer as the primary wiki experience.
- No cross-workspace or cross-matter retrieval by default.

## Current State

The backend already has:

- FastAPI app setup.
- Authenticated users.
- Document upload routes.
- Document models and chunks.
- PDF and DOCX text extraction.
- Chunk embedding with OpenAI.
- pgvector-backed document search.
- DeepSeek-backed chat.
- Chat thread and message persistence.
- Memory CRUD and automatic memory extraction.

The frontend already has:

- Authenticated workspace shell.
- Chat as the primary workflow.
- Document upload/list UI.
- Memory review UI.
- Model selection in the chat navbar.

The missing layer is the compiled wiki:

```txt
raw document chunks -> generated wiki page -> editable team knowledge -> chat context
```

## Product Narrative

Junior lawyers lose time and attention because matter knowledge is scattered across documents, chat history, and individual memory. A normal RAG flow can answer a question, but it does not preserve the synthesis. The next lawyer asks a similar question and the system has to rediscover the same answer.

The LLM Wiki turns repeated reading into reusable work product:

- source summaries for uploaded documents
- issue maps for legal and factual risks
- clause summaries for contracts
- party and entity pages
- date and obligation timelines
- open-question lists
- playbooks for repeated review patterns

This creates a strong demo story:

```txt
Upload a document.
Generate a wiki page.
Ask a question.
See the answer use the wiki plus citations.
Publish useful draft pages into team knowledge.
Show a graph of what the matter now knows.
```

## Proposed Architecture

```txt
FastAPI
  |
  |-- existing document pipeline
  |     `-- documents + document_chunks
  |
  |-- wiki ingestion
  |     |-- read ready document chunks
  |     |-- retrieve relevant pages and memories
  |     |-- ask LLM for structured page drafts
  |     |-- validate output
  |     |-- persist pages, revisions, sources, and links
  |     `-- return draft pages for editing
  |
  |-- wiki CRUD
  |     `-- editable Markdown pages with draft/published status
  |
  `-- chat
        |-- search wiki pages
        |-- search document chunks
        |-- retrieve memories
        `-- answer with citations
```

Backend services:

```txt
app/services/wiki_service.py
app/services/wiki_ingestion_service.py
app/services/wiki_graph_service.py
```

Do not add a tool registry unless these functions are later exposed to other clients.

## Data Model

### `wiki_pages`

```txt
id
owner_user_id
author_user_id
latest_editor_user_id nullable
workspace_id nullable for later workspace support
matter_id nullable for later matter/case support
title
slug
body_markdown
excerpt
page_type
status draft | published | archived
created_by user | llm
source_document_id nullable
version
published_at nullable
created_at
updated_at
```

Use `status`, not a `visibility` field, for the MVP. Draft pages are user-owned work-in-progress. Published pages are visible to the single authenticated demo team. Add workspace/matter scoping later when the app needs real team and case access control.

Every wiki page should display:

```txt
author: user who originally created or generated the page
date added: wiki_pages.created_at
latest edit: wiki_pages.updated_at with date and time
```

For LLM-generated pages, `author_user_id` should be the user who requested generation, while `created_by` remains `llm`. `latest_editor_user_id` should update on user edits and can remain null for untouched LLM drafts.

Initial page types means the first set of page categories/templates users can choose from and filter by in Lex-Wiki. It does not block the backend from storing other valid page types later.

Initial visible page types:

```txt
source_summary
issue
timeline
playbook
memory_note
```

Later page types:

```txt
entity
clause
authority
question_answer
```

### `wiki_page_revisions`

```txt
id
page_id
body_markdown
edited_by_user_id nullable
edit_source user | llm_ingestion | llm_merge
change_summary
created_at
```

Create a revision for every user save and every LLM-generated update.

### `wiki_page_sources`

```txt
id
page_id
document_id nullable
chunk_id nullable
memory_id nullable
chat_message_id nullable
citation_label
relevance_note
created_at
```

This table lets the UI show cited snippets without dumping the entire source document into the wiki page.

### `wiki_links`

```txt
id
source_page_id
target_page_id
link_text
link_type wikilink | citation | related | contradicts | depends_on
created_at
```

Store explicit links for graph rendering and backlinks. The service can also parse `[[wikilinks]]` from Markdown, but persisted links should be the source of truth for the graph API.

### `wiki_page_embeddings`

Add after CRUD and ingestion work:

```txt
id
page_id
section_heading
text
embedding
created_at
```

For the first pass, use title search, page type filters, and Postgres full-text search. Add embeddings when wiki pages are included in chat context.

## Permissions

Every wiki path must enforce ownership and matter access.

```txt
draft page:
  current_user.id == wiki_pages.owner_user_id

published page:
  current_user is authenticated and belongs to the single demo team

source citation:
  current_user can access the cited document, memory, or chat message

graph edge:
  current_user can access both endpoint pages
```

There is no long-lived private wiki page feature in the MVP. A generated page can be an unpublished draft while the user edits it, then publishing opens it to the single authenticated demo team. Workspace, matter, and case tables can be added later.

Do not allow:

- anonymous page reads
- cross-user draft reads
- graph responses that reveal inaccessible page titles
- citations pointing to inaccessible documents
- automatic publishing of memories into team pages

Team publishing does not require a separate reviewer approval step for the MVP. Each user is responsible for what they publish to the team-visible wiki. The app should still make publishing explicit.

## API Plan

```txt
GET    /wiki/pages
POST   /wiki/pages
GET    /wiki/pages/{page_id}
PATCH  /wiki/pages/{page_id}
DELETE /wiki/pages/{page_id}

POST   /wiki/ingest/document/{document_id}
GET    /wiki/ingestion-jobs/{job_id}
GET    /wiki/graph
GET    /wiki/pages/{page_id}/sources
POST   /wiki/pages/{page_id}/publish
```

MVP request fields for `POST /wiki/pages`:

```json
{
  "title": "Assignment Risk Map",
  "body_markdown": "...",
  "page_type": "issue",
  "status": "draft"
}
```

MVP request fields for `POST /wiki/ingest/document/{document_id}`:

```json
{
  "page_types": ["source_summary"],
  "model": "deepseek-v4-pro"
}
```

## Documents Page Action

The Documents page should include a per-document action:

```txt
Generate wiki page
```

Show this button only when the document is ready for search:

```txt
document.status == ready
```

Button behavior:

```txt
click -> POST /wiki/ingest/document/{document_id}
      -> create user-owned source_summary draft
      -> navigate to the new Lex-Wiki page
      -> show citations/source drawer
```

Do not automatically ingest every upload into the wiki for the MVP. Uploading and wiki generation are separate user actions because a legal document may be irrelevant, duplicative, privileged in a way the user does not want summarized, or not ready for team knowledge.

Recommended button states:

```txt
uploaded/processing: disabled, "Ingestion pending"
ready: enabled, "Generate wiki page"
failed: disabled, "Fix document first"
wiki draft exists: "Open wiki draft"
wiki page published: "Open wiki page"
```

## Navigation Model

Lex-Wiki should be a first-class authenticated page inside LexCatalyst, not an external public site.

Add a primary workspace navigation item:

```txt
Lex-Wiki
```

The user should be able to enter Lex-Wiki in two ways:

```txt
Workspace sidebar/topbar -> Lex-Wiki -> wiki home
Documents page -> Generate wiki page/Open wiki page -> specific wiki page
```

The user should be able to leave Lex-Wiki clearly:

```txt
Lex-Wiki header -> Back to workspace
Lex-Wiki page created from a document -> Back to documents
```

Recommended route shape if the frontend has routing:

```txt
/workspace
/documents
/wiki
/wiki/pages/{page_id}
```

If the current frontend stays as a single workspace shell for the MVP, implement the same behavior as a workspace panel first:

```txt
active panel: chat | documents | memories | lex-wiki
```

Do not make Lex-Wiki feel like a separate logged-out website. It should keep the authenticated LexCatalyst frame, user session, matter context, and model controls where relevant.

## Ingestion Pipeline

For the first implementation, generate one user-owned draft `source_summary` page from one ready document.

```txt
1. Verify current_user can access document_id.
2. Verify document.status == ready.
3. Load citation-friendly document chunks.
4. Load relevant existing wiki pages and user memories in the same scope.
5. Ask DeepSeek for structured JSON output.
6. Validate generated pages, links, and source references.
7. Store wiki_pages as draft.
8. Store wiki_page_revisions.
9. Store wiki_page_sources.
10. Store wiki_links.
11. Return created draft pages.
```

LLM output should be structured:

```json
{
  "pages": [
    {
      "title": "Acme MSA - Source Summary",
      "slug": "acme-msa-source-summary",
      "page_type": "source_summary",
      "excerpt": "Short summary of the document.",
      "body_markdown": "## What This Is\n\n...",
      "links": [
        {
          "target_title": "Termination Rights",
          "link_text": "termination rights",
          "link_type": "related"
        }
      ],
      "sources": [
        {
          "chunk_id": "...",
          "citation_label": "Acme MSA p. 3 chunk 2",
          "relevance_note": "Supports the termination summary."
        }
      ]
    }
  ]
}
```

The backend must reject or repair output that:

- references nonexistent chunks
- uses unsupported page types
- creates empty pages
- creates unsafe slugs
- attempts to publish without authorization
- includes long raw source excerpts in the page body

## Page Template

Generated source-summary pages should use this structure:

```md
---
title: "Acme MSA - Source Summary"
page_type: source_summary
source_count: 1
---

## What This Is

Plain-English description of the document.

## Key Points

- Main facts, obligations, and legal terms.

## Issues To Watch

- Risks, ambiguity, unusual provisions, or missing information.

## Open Questions

- Items the junior lawyer should verify.

## Source Notes

- [Acme MSA p. 3 chunk 2] Short citation note.
```

The page should be a synthesized work product. It should not show the whole uploaded file.

## Chat Integration

Chat context should eventually be ordered like this:

```txt
1. Relevant wiki pages
2. Relevant document chunks
3. Relevant memories
4. Recent thread messages
```

The wiki should come first because it is the compiled layer. Raw document chunks remain available as source evidence.

Initial search order:

```txt
query -> title/page-type search -> document RAG -> memories
```

Later search order:

```txt
query -> wiki embedding search -> document RAG -> memory search
```

Prompt rule:

```txt
Use wiki pages as synthesized matter context.
Use document chunks as primary evidence.
When the wiki and source chunks disagree, say so and cite the source chunks.
```

## Memory Integration

Keep memories and wiki pages separate:

- Memory is a small user-scoped row.
- Wiki page is an editable artifact.
- Published wiki pages are user-published shared knowledge.

Promotion flow:

```txt
memory candidate -> user approves private memory
memory -> user creates or updates a wiki draft
wiki draft -> user publishes to team
```

This is important for legal trust. A memory should not become team-visible just because the LLM extracted it.

## Frontend Plan

Add a `Lex-Wiki` workspace page:

```txt
top/header: Lex-Wiki title, Back to workspace, optional Back to documents
left: page explorer and filters
center: Markdown page view and edit mode
right: graph, backlinks, and source citations
```

Core states:

- Workspace navigation item labeled "Lex-Wiki."
- Empty wiki with "Generate from document" action.
- Documents-page action opens the generated page in Lex-Wiki.
- Page list filtered by type, draft/published status, and search text.
- Page reader with title, author, date added, latest edit date/time, and rendered Markdown.
- Edit mode with textarea first.
- Citation drawer showing cited chunks only.
- Local graph for the active page.
- Global graph toggle for all accessible pages.
- Draft/published status badge.

Use Quartz as experience inspiration, not as the app runtime:

- local graph: current page plus one-hop neighbors
- global graph: all accessible pages and links
- node size: incoming plus outgoing links
- node color: draft, published, document source, memory source
- backlinks: pages that link to the current page

Suggested frontend dependencies:

```txt
react-markdown
remark-gfm
react-force-graph-2d
lucide-react
```

Start with a plain textarea editor. Add a richer Markdown editor only if editing becomes painful.

## Admin Insight

The wiki can support a more useful admin insight than raw usage analytics:

- repeated questions with no corresponding wiki page
- pages that are cited often
- orphan pages with no backlinks
- stale pages not updated after new document uploads
- topics where juniors keep asking for clarification
- draft pages that users repeatedly publish to the team

For the demo, one strong insight is enough:

```txt
"Assignment risk has been asked about 6 times, but there is no team wiki page yet."
```

## Build Order

1. Add wiki page CRUD with draft/published status.
2. Add page revisions.
3. Add the Lex-Wiki navigation shell with Back to workspace and Back to documents.
4. Add Markdown page reader and textarea edit mode.
5. Add one-document-to-one-source-summary ingestion from the Documents page button.
6. Add source citations and cited-chunk drawer.
7. Add explicit wiki links and local graph API.
8. Add graph UI.
9. Add wiki search.
10. Include wiki search results in chat context.
11. Add publish-to-team action using the single authenticated demo team scope.
12. Add memory-to-wiki-draft action.
13. Add admin insight for repeated questions and missing pages.

## Rollout Recommendation

For the hackathon, implement the smallest impressive path:

```txt
upload document
click Generate wiki page on the Documents page
land in Lex-Wiki
generate source summary draft
edit page
view citations
see local graph
go back to Documents or workspace
ask chat question that uses the wiki page
```

Publishing uses the single authenticated demo team for the MVP. Do not expose pages to anonymous users or the public internet.

## Risks

- LLM pages may over-summarize legal nuance.
- Generated pages can drift from source documents.
- Graph data can leak inaccessible page titles if filtering is wrong.
- Team publishing can expose sensitive notes if the promotion flow is too automatic.
- Wiki search can become stale if page embeddings are not refreshed after edits.

Mitigations:

- Keep source citations visible.
- Store revisions.
- Default to user-owned drafts.
- Use service-layer access checks on every query.
- Prefer explicit publish actions.
- Re-embed page sections after every save once wiki embeddings exist.

## Later Access-Control Expansion

Add real workspace, matter, or case tables after the MVP when LexCatalyst needs separate teams or legal matters:

```txt
workspaces
workspace_members
matters or cases
matter_members or case_members
```

Until then:

- Use one authenticated demo team.
- Use `source_summary`, `issue`, `timeline`, and `playbook` as the first visible page types.
- Let authenticated users publish drafts to the demo team immediately.

## References

- `docs/llm-wiki.md`
- `docs/rfc-semantic-document-search.md`
- Quartz graph view: https://quartz.jzhao.xyz/features/graph-view
