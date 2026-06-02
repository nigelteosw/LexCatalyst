# LLM Wiki

A pattern for building personal knowledge bases using LLMs.

This is an idea file, it is designed to be copy pasted to your own LLM Agent (e.g. OpenAI Codex, Claude Code, OpenCode / Pi, or etc.). Its goal is to communicate the high level idea, but your agent will build out the specifics in collaboration with you.

## The core idea

Most people's experience with LLMs and documents looks like RAG: you upload a collection of files, the LLM retrieves relevant chunks at query time, and generates an answer. This works, but the LLM is rediscovering knowledge from scratch on every question. There's no accumulation. Ask a subtle question that requires synthesizing five documents, and the LLM has to find and piece together the relevant fragments every time. Nothing is built up. NotebookLM, ChatGPT file uploads, and most RAG systems work this way.

The idea here is different. Instead of just retrieving from raw documents at query time, the LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening or challenging the evolving synthesis. The knowledge is compiled once and then *kept current*, not re-derived on every query.

This is the key difference: **the wiki is a persistent, compounding artifact.** The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read. The wiki keeps getting richer with every source you add and every question you ask.

You never (or rarely) write the wiki yourself — the LLM writes and maintains all of it. You're in charge of sourcing, exploration, and asking the right questions. The LLM does all the grunt work — the summarizing, cross-referencing, filing, and bookkeeping that makes a knowledge base actually useful over time. In practice, I have the LLM agent open on one side and Obsidian open on the other. The LLM makes edits based on our conversation, and I browse the results in real time — following links, checking the graph view, reading the updated pages. Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase.

This can apply to a lot of different contexts. A few examples:

- **Personal**: tracking your own goals, health, psychology, self-improvement — filing journal entries, articles, podcast notes, and building up a structured picture of yourself over time.
- **Research**: going deep on a topic over weeks or months — reading papers, articles, reports, and incrementally building a comprehensive wiki with an evolving thesis.
- **Reading a book**: filing each chapter as you go, building out pages for characters, themes, plot threads, and how they connect. By the end you have a rich companion wiki. Think of fan wikis like [Tolkien Gateway](https://tolkiengateway.net/wiki/Main_Page) — thousands of interlinked pages covering characters, places, events, languages, built by a community of volunteers over years. You could build something like that personally as you read, with the LLM doing all the cross-referencing and maintenance.
- **Business/team**: an internal wiki maintained by LLMs, fed by Slack threads, meeting transcripts, project documents, customer calls. Possibly with humans in the loop reviewing updates. The wiki stays current because the LLM does the maintenance that no one on the team wants to do.
- **Competitive analysis, due diligence, trip planning, course notes, hobby deep-dives** — anything where you're accumulating knowledge over time and want it organized rather than scattered.

## Architecture

There are three layers:

**Raw sources** — your curated collection of source documents. Articles, papers, images, data files. These are immutable — the LLM reads from them but never modifies them. This is your source of truth.

**The wiki** — a directory of LLM-generated markdown files. Summaries, entity pages, concept pages, comparisons, an overview, a synthesis. The LLM owns this layer entirely. It creates pages, updates them when new sources arrive, maintains cross-references, and keeps everything consistent. You read it; the LLM writes it.

**The schema** — a document (e.g. CLAUDE.md for Claude Code or AGENTS.md for Codex) that tells the LLM how the wiki is structured, what the conventions are, and what workflows to follow when ingesting sources, answering questions, or maintaining the wiki. This is the key configuration file — it's what makes the LLM a disciplined wiki maintainer rather than a generic chatbot. You and the LLM co-evolve this over time as you figure out what works for your domain.

## LexCatalyst implementation plan

For LexCatalyst, the LLM Wiki should be a matter-aware legal workspace feature, not a separate publishing system. The goal is to reduce junior-lawyer cognitive load by turning uploaded documents, chat answers, and reviewed memories into a small living matter wiki:

```txt
upload document -> extract/chunk/embed -> generate wiki draft -> edit -> publish to team -> chat uses wiki + citations
```

This should build on the existing document ingestion path. Do not re-read or display the entire uploaded file in the wiki UI. The wiki should show LLM-written pages with citations back to specific source chunks. Users can open a source drawer for quoted snippets, but the primary page is the synthesized Markdown page.

### Product fit

The hackathon story is strong if the wiki is framed as cognitive-load reduction for junior lawyers:

- Junior lawyers should not have to remember every fact, clause, issue, and prior answer from a matter.
- The system should convert repeated reading into reusable pages: issue maps, clause summaries, key dates, risk registers, party profiles, authorities, playbooks, and open questions.
- Draft pages let each lawyer review generated wiki content before sharing it.
- Published pages create a shared matter wiki so the same context does not need to be re-explained across the team.
- Admin insight can later show which wiki pages, gaps, or repeated questions are creating the most friction.

Use "public" to mean team-visible inside the authenticated LexCatalyst system for an authorized workspace or matter. Do not make legal wiki pages publicly reachable on the internet.

### Page model

Add wiki pages as editable Markdown records, not generated static files:

```txt
wiki_pages
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
  created_at
  updated_at
```

Every wiki page should display author, date added, and latest edit date/time. For LLM-generated pages, the author is the user who requested generation; `created_by` still records that the initial body came from the LLM.

Suggested `page_type` values:

```txt
source_summary
issue
entity
timeline
clause
authority
playbook
question_answer
memory_note
```

Keep revision history so human edits are recoverable:

```txt
wiki_page_revisions
  id
  page_id
  body_markdown
  edited_by_user_id nullable
  edit_source user | llm_ingestion | llm_merge
  change_summary
  created_at
```

Track evidence separately from page text:

```txt
wiki_page_sources
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

Track graph edges explicitly:

```txt
wiki_links
  id
  source_page_id
  target_page_id
  link_text
  link_type wikilink | citation | related | contradicts | depends_on
  created_at
```

For the MVP, use one authenticated demo team. Add workspace and matter/case tables later when LexCatalyst needs separate teams or legal matters.

### Permissions

Every wiki read and write must go through the same security boundary as documents and memories:

```txt
draft page: current_user.id == owner_user_id
published page: current_user is authenticated and belongs to the single demo team
source citation: current_user can access the cited document, memory, or chat thread
graph edge: current_user can access both endpoint pages
```

Generated pages should start as drafts. Team publishing should be an explicit user action, but it does not need a separate reviewer approval step for the MVP:

```txt
draft -> user edits -> user publishes to team
```

There is no private wiki page feature in the MVP. If needed, long-lived private wiki pages can be added later as a separate visibility model.

### Backend services

Keep the backend boring and service-based:

```txt
app/services/wiki_service.py
app/services/wiki_ingestion_service.py
app/services/wiki_graph_service.py
```

Expected service functions:

```py
list_wiki_pages(...)
get_wiki_page(...)
create_wiki_page(...)
update_wiki_page(...)
archive_wiki_page(...)
ingest_document_to_wiki(...)
merge_wiki_draft(...)
search_wiki_pages(...)
build_wiki_graph(...)
```

Expected API shape:

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

Route handlers should only authenticate, validate input, and call services.

### Ingestion pipeline

The LLM ingestion pipeline should create or update wiki pages from already-ingested chunks:

```txt
1. User uploads PDF/DOCX.
2. Existing document pipeline stores original file, extracts text, chunks, embeds, and marks document ready.
3. The Documents page shows a "Generate wiki page" button for ready documents.
4. User clicks the button to create a user-owned wiki draft from that document.
5. Backend selects document chunks plus relevant existing wiki pages and memories in the same scope.
6. LLM returns structured page drafts, links, and source citations.
7. Backend validates the output, stores draft pages, stores source mappings, and stores graph links.
8. User reviews and edits the pages.
9. User publishes the edited page to the team wiki.
```

Do not automatically ingest every upload into the wiki for the MVP. A document can be uploaded for chat/search without becoming an LLM-written wiki page.

For the MVP, generate one `source_summary` page per document. Then add richer pages only when there is clear value:

```txt
source_summary first
issue pages second
entity/timeline/clause pages third
```

The LLM should write a page, not a file dump. A good generated source summary page should look like:

```md
---
title: "Acme MSA - Source Summary"
page_type: source_summary
source_count: 1
---

## What This Is

Short plain-English description of the document.

## Key Points

- ...

## Issues To Watch

- ...

## Open Questions

- ...

## Source Notes

- [Acme MSA p. 3 chunk 2] ...
```

The LLM output should be JSON so the backend can validate it before writing:

```json
{
  "pages": [
    {
      "title": "Acme MSA - Source Summary",
      "slug": "acme-msa-source-summary",
      "page_type": "source_summary",
      "body_markdown": "...",
      "links": [
        {"target_title": "Termination Rights", "link_text": "termination rights", "link_type": "related"}
      ],
      "sources": [
        {"chunk_id": "...", "citation_label": "Acme MSA p. 3 chunk 2", "relevance_note": "..."}
      ]
    }
  ]
}
```

Important LLM rules:

- Use only provided document chunks, wiki pages, and memories.
- Preserve uncertainty and call out missing evidence.
- Cite claims that come from source documents.
- Do not overwrite a human-edited published page directly. Create a proposed revision.
- Do not include confidential raw file text beyond short cited snippets.
- Prefer stable legal work products: issue maps, clause summaries, fact timelines, risk registers, and playbooks.

### Wiki search and chat integration

Chat should eventually retrieve wiki pages before raw document chunks:

```txt
query -> search wiki pages -> search document chunks -> retrieve memories -> generate answer with citations
```

Why this matters: the wiki is the compiled layer. If a junior lawyer asks "what are the main assignment risks in this matter?", the assistant should use the already-maintained issue page before rediscovering the issue from raw chunks.

Store embeddings for wiki pages or page sections:

```txt
wiki_page_embeddings
  id
  page_id
  section_heading
  text
  embedding
  created_at
```

For the first pass, full-text search plus title matching is acceptable. Add embeddings once the page CRUD and ingestion loop works.

### Memory integration

Personal memories and the wiki should stay related but distinct:

- Personal memory: small row-level fact or preference scoped to one user.
- Team memory: user-published memory or repeated lesson promoted into a shared page.
- Wiki page: editable synthesized artifact that can cite documents, memories, and chat messages.

Do not automatically publish private memories into the team wiki. Use an explicit promotion flow:

```txt
memory candidate -> user approves -> private memory
memory -> user creates or updates a wiki draft
wiki draft -> user publishes to team
```

This keeps the demo credible for legal data handling and prevents accidental sharing of sensitive personal context.

### Frontend

Add a `Lex-Wiki` workspace page. It should feel like a restrained Quartz-style legal wiki, not a marketing page:

```txt
top/header: Lex-Wiki title, Back to workspace, optional Back to documents
left: page explorer and filters
center: rendered Markdown page with edit mode
right: graph view, backlinks, and source citations
```

Users should be able to enter Lex-Wiki from the main workspace navigation or from a document action:

```txt
Workspace navigation -> Lex-Wiki
Documents page -> Generate wiki page/Open wiki page -> Lex-Wiki page
```

Users should be able to leave Lex-Wiki without losing orientation:

```txt
Back to workspace
Back to documents, when the page came from a document action
```

Core UI states:

- Workspace navigation item labeled "Lex-Wiki."
- Empty wiki: prompt to generate the first page from a ready document.
- Documents page: each ready document has a "Generate wiki page" or "Open wiki page" action.
- Page view: title, author, date added, latest edit date/time, rendered Markdown, citations, edit button.
- Edit view: Markdown editor or textarea, save/cancel controls, revision note.
- Source drawer: cited chunks only, not the full uploaded file.
- Graph view: local graph by default, global graph toggle.
- Draft/published status badge.

The graph should copy the useful Quartz behavior:

- local graph shows the current page and one-hop neighbors
- global graph shows all accessible pages and their links
- node size reflects inbound/outbound link count
- draft and published pages use different colors
- document and memory source nodes can be shown as secondary node types

Do not use Quartz itself for the authenticated app MVP. Quartz is useful inspiration for wiki layout, backlinks, search, and graph behavior, but LexCatalyst needs API-backed permissions, editable pages, and matter-level access control. A future export can generate a static Quartz-compatible Markdown vault for a single matter if needed.

Suggested frontend dependencies:

```txt
react-markdown
remark-gfm
react-force-graph-2d or d3-force
lucide-react
```

Start with a simple textarea editor before adding a full Markdown editor.

### Suggested build order

1. Add wiki page CRUD with draft/published status.
2. Add the Lex-Wiki navigation shell with back links.
3. Add rendered Markdown page view and edit mode.
4. Add one-document-to-one-source-summary ingestion.
5. Add citations/source drawer for generated pages.
6. Add local graph from explicit `wiki_links`.
7. Add user-controlled publish from draft to team-visible page using the single authenticated demo team.
8. Add wiki search and include wiki pages in chat context.
9. Add richer ingestion that creates issue, entity, clause, timeline, and playbook pages.
10. Add admin insight: repeated questions without a wiki page, stale pages, orphan pages, and high-friction topics.

### Later decisions

- Add real workspace and matter/case tables when the app needs separate teams or legal matters.

### Quartz references

Quartz is not the runtime dependency for the MVP, but it is a useful reference for the experience:

- https://quartz.jzhao.xyz/
- https://quartz.jzhao.xyz/features/graph-view

## Operations

**Ingest.** You drop a new source into the raw collection and tell the LLM to process it. An example flow: the LLM reads the source, discusses key takeaways with you, writes a summary page in the wiki, updates the index, updates relevant entity and concept pages across the wiki, and appends an entry to the log. A single source might touch 10-15 wiki pages. Personally I prefer to ingest sources one at a time and stay involved — I read the summaries, check the updates, and guide the LLM on what to emphasize. But you could also batch-ingest many sources at once with less supervision. It's up to you to develop the workflow that fits your style and document it in the schema for future sessions.

**Query.** You ask questions against the wiki. The LLM searches for relevant pages, reads them, and synthesizes an answer with citations. Answers can take different forms depending on the question — a markdown page, a comparison table, a slide deck (Marp), a chart (matplotlib), a canvas. The important insight: **good answers can be filed back into the wiki as new pages.** A comparison you asked for, an analysis, a connection you discovered — these are valuable and shouldn't disappear into chat history. This way your explorations compound in the knowledge base just like ingested sources do.

**Lint.** Periodically, ask the LLM to health-check the wiki. Look for: contradictions between pages, stale claims that newer sources have superseded, orphan pages with no inbound links, important concepts mentioned but lacking their own page, missing cross-references, data gaps that could be filled with a web search. The LLM is good at suggesting new questions to investigate and new sources to look for. This keeps the wiki healthy as it grows.

## Indexing and logging

Two special files help the LLM (and you) navigate the wiki as it grows. They serve different purposes:

**index.md** is content-oriented. It's a catalog of everything in the wiki — each page listed with a link, a one-line summary, and optionally metadata like date or source count. Organized by category (entities, concepts, sources, etc.). The LLM updates it on every ingest. When answering a query, the LLM reads the index first to find relevant pages, then drills into them. This works surprisingly well at moderate scale (~100 sources, ~hundreds of pages) and avoids the need for embedding-based RAG infrastructure.

**log.md** is chronological. It's an append-only record of what happened and when — ingests, queries, lint passes. A useful tip: if each entry starts with a consistent prefix (e.g. `## [2026-04-02] ingest | Article Title`), the log becomes parseable with simple unix tools — `grep "^## \[" log.md | tail -5` gives you the last 5 entries. The log gives you a timeline of the wiki's evolution and helps the LLM understand what's been done recently.

## Optional: CLI tools

At some point you may want to build small tools that help the LLM operate on the wiki more efficiently. A search engine over the wiki pages is the most obvious one — at small scale the index file is enough, but as the wiki grows you want proper search. [qmd](https://github.com/tobi/qmd) is a good option: it's a local search engine for markdown files with hybrid BM25/vector search and LLM re-ranking, all on-device. It has both a CLI (so the LLM can shell out to it) and an MCP server (so the LLM can use it as a native tool). You could also build something simpler yourself — the LLM can help you vibe-code a naive search script as the need arises.

## Tips and tricks

- **Obsidian Web Clipper** is a browser extension that converts web articles to markdown. Very useful for quickly getting sources into your raw collection.
- **Download images locally.** In Obsidian Settings → Files and links, set "Attachment folder path" to a fixed directory (e.g. `raw/assets/`). Then in Settings → Hotkeys, search for "Download" to find "Download attachments for current file" and bind it to a hotkey (e.g. Ctrl+Shift+D). After clipping an article, hit the hotkey and all images get downloaded to local disk. This is optional but useful — it lets the LLM view and reference images directly instead of relying on URLs that may break. Note that LLMs can't natively read markdown with inline images in one pass — the workaround is to have the LLM read the text first, then view some or all of the referenced images separately to gain additional context. It's a bit clunky but works well enough.
- **Obsidian's graph view** is the best way to see the shape of your wiki — what's connected to what, which pages are hubs, which are orphans.
- **Marp** is a markdown-based slide deck format. Obsidian has a plugin for it. Useful for generating presentations directly from wiki content.
- **Dataview** is an Obsidian plugin that runs queries over page frontmatter. If your LLM adds YAML frontmatter to wiki pages (tags, dates, source counts), Dataview can generate dynamic tables and lists.
- The wiki is just a git repo of markdown files. You get version history, branching, and collaboration for free.

## Why this works

The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping. Updating cross-references, keeping summaries current, noting when new data contradicts old claims, maintaining consistency across dozens of pages. Humans abandon wikis because the maintenance burden grows faster than the value. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass. The wiki stays maintained because the cost of maintenance is near zero.

The human's job is to curate sources, direct the analysis, ask good questions, and think about what it all means. The LLM's job is everything else.

The idea is related in spirit to Vannevar Bush's Memex (1945) — a personal, curated knowledge store with associative trails between documents. Bush's vision was closer to this than to what the web became: private, actively curated, with the connections between documents as valuable as the documents themselves. The part he couldn't solve was who does the maintenance. The LLM handles that.


## Note

This document is intentionally abstract. It describes the idea, not a specific implementation. The exact directory structure, the schema conventions, the page formats, the tooling — all of that will depend on your domain, your preferences, and your LLM of choice. Everything mentioned above is optional and modular — pick what's useful, ignore what isn't. For example: your sources might be text-only, so you don't need image handling at all. Your wiki might be small enough that the index file is all you need, no search engine required. You might not care about slide decks and just want markdown pages. You might want a completely different set of output formats. The right way to use this is to share it with your LLM agent and work together to instantiate a version that fits your needs. The document's only job is to communicate the pattern. Your LLM can figure out the rest.
