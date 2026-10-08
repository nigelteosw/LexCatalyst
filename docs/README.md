# LexCatalyst — Documentation

This folder contains the product context, feature briefs, and design RFCs for LexCatalyst.

## Read this first

- [`product-requirement.md`](./product-requirement.md) — Whiteboard notes from the original brainstorm with practising lawyers. The raw "why" behind every feature in this project lives here.

## Feature briefs

Each file in `features/` answers one question: *why does this feature exist for lawyers?* They are short (one page) and reference the specific pain points from `product-requirement.md`.

| Feature | Who it's for | Pain it addresses |
|---|---|---|
| [Birdie mentor](./features/birdie-mentor.md) | Juniors | "Lack of mentorship", "Scared to ask stupid Qns", "No psychological safety" |
| [Agent chat](./features/agent-chat.md) | Everyone | Confidential, matter-aware Q&A with citations |
| [Knowledge Bank](./features/knowledge-bank.md) | Whole firm | Style standardisation, retraining costs, institutional memory leak |
| [Workboard](./features/actions-delegation.md) | Seniors → Juniors | Workload triage and visible distribution |
| [RBAC & roles](./features/rbac-roles.md) | Whole firm | Confidentiality at the right granularity |
| [Personal memory](./features/memory.md) | Each user | Style guide and instructions per individual |

## Design RFCs (engineering)

These are deeper technical design docs written before implementation. They explain *how* the systems are built; the feature briefs explain *why*.

- [`rfc-react-agent-loop.md`](./rfc-react-agent-loop.md) — ReAct agent architecture
- [`rfc-knowledge-bank.md`](./rfc-knowledge-bank.md) — KB scopes, audit, redaction
- [`rfc-llm-wiki.md`](./rfc-llm-wiki.md) — LLM-generated wiki pages
- [`rfc-semantic-document-search.md`](./rfc-semantic-document-search.md) — pgvector + chunking strategy
- [`llm-wiki.md`](./llm-wiki.md) — Wiki feature reference

## Plans (work not yet built)

Per-feature implementation plans, each tied to an open TODO. These have enough detail to start coding from — schemas, migrations, file touchpoints, and verification steps — but no code has been written yet.

- [`plans/kb-skills-rename.md`](./plans/kb-skills-rename.md) — Rename the third KB category from `action` to `skill`; introduce always-load skills.
- [`plans/pdf-viewer-comments.md`](./plans/pdf-viewer-comments.md) — Inline PDF drawer with matter-wide comments.

## Working notes

- [`todo.md`](./todo.md) — Short-lived TODO list
