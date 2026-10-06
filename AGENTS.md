# AGENTS.md

Guidance for coding agents working in this repository.

## Project Direction

LexCatalyst is a hackathon legal assistant. Optimize for a working demo over architectural novelty.

The target workflow is:

```txt
login -> upload PDF/DOCX -> extract text -> chunk/embed -> chat with citations -> save/retrieve memory -> show admin insight
```

Use the plan in `plan.md` as the product and architecture source of truth.

## Stack Decisions

Keep the stack boring and Python-first:

- Frontend: React + Vite + TypeScript + Tailwind, bundled with Bun
- Backend: FastAPI + Python
- Local database: Postgres through Docker Compose (with pgvector and pg_trgm extensions)
- Auth: Google OAuth via `@react-oauth/google` on the frontend; JWT issued by the backend
- Deployment targets: frontend on Railway (static), backend on Railway

Do not introduce Better Auth into the FastAPI backend.

Do not start with MCP, LangGraph, Celery, or a complex agent runtime. Build direct Python services first. Add orchestration only after the upload, retrieval, chat, and memory loop works.

## Current Repo Shape

```txt
backend/
  app/
    main.py
    models.py
    schemas.py
    database.py
    config.py
    routers/          # thin HTTP handlers — one file per domain
    services/         # business logic — keep route handlers thin
    providers/        # LLM and embedding adapters (openrouter, embeddings)
  migrations/         # Alembic; current head: z3e4f5a6b7c8
  Makefile
  requirements.txt

frontend/
  src/
    main.tsx
    app/              # App shell: App.tsx + route mapping/navigation in routes.ts
    features/         # One directory per product area
      actions/        # Action board (kanban)
      auth/           # LoginPage
      birdie/         # Birdie AI mentor panel
      chat/           # ChatPanel, header, matter chip, footnote source panel
      documents/      # MatterDocuments (folders, upload, rename, delete; used on each matter page); DocumentsPanel is the single-document review page at /knowledge/documents/:id
      knowledge-bank/ # KB panel + filters + dialogs; per-matter page (MatterPage)
      home/           # Home: matters list (CRUD), needs-attention, recent documents
      memories/       # Memories panel + async Dream consolidation
      navigation/     # Collapsible sidebar; chats grouped by matter (chat page only)
      settings/       # Settings panel
      wellbeing/      # Wellbeing survey panel
      wiki/           # Wiki panel + graph canvas
    shared/
      api/api.ts      # All fetch calls; snake_case↔camelCase mapping here
      lib/            # errors.ts, async.ts
      types/workspace.ts
      ui/             # Button, Dialog, ErrorBanner, MarkdownContent, MatterSelect, StatusBadge

extension/            # Birdie Chrome extension (MV3 side panel); bun run build -> extension/dist
  public/manifest.json
  src/background.ts   # context menu + side panel behaviour
  src/sidepanel/      # Birdie side panel UI
  src/lib/            # auth, api, SSE parsing, web context
  package.json
  bun.lock
```

## Local Commands

Backend:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
make install
make migrate
make dev
```

Frontend:

```sh
cd frontend
bun install
bun run dev
```

Backend dev server:

```txt
http://127.0.0.1:8000
```

Local Docker database:

```sh
cp backend/.env.example backend/.env
docker compose up -d
```

Docker services:

```txt
postgres: 127.0.0.1:5432
```

The backend is not part of Docker Compose. Run it locally from `backend/.venv` with `make dev`.

The frontend is not part of Docker Compose. Run it separately with `bun run dev` from `frontend/`.

If port `8000` is already in use, inspect it before killing anything:

```sh
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

## Backend Structure

Routers are thin — one file per domain under `app/routers/`. Business logic lives in services:

```txt
app/services/
  agent_service.py        # Tool dispatch inside streamed chat (search, KB, memory)
  elitigation_service.py  # Public Singapore judgments search, decision-year filter and date sorting
  case_law_service.py     # Shared audited judgment/excerpt lookup for LexChat and Birdie
  action_service.py       # Action board items
  birdie_service.py       # Birdie AI mentor
  birdie_review_service.py # Draft review: anchored replace/insert/comment suggestions (extension)
  llm_service.py          # Per-user OpenRouter key + High/Mid tier model resolution; FEATURES list
  lesson_service.py       # Reviewer feedback → Birdie lessons (submitter-only)
  user_settings_service.py # Per-user settings (OpenRouter key/model, encrypted)
  demo_seed_service.py    # Demo firm seed + reset (DEMO_MODE only); demo_pdfs.py builds the PDFs
  chat_service.py         # Thread + message CRUD, streaming, thread summarisation
  document_service.py     # Upload, worker claim, processing lifecycle
  dream_service.py        # Memory consolidation agent (DB-backed async jobs)
  field_encryption.py     # AES encryption for PII fields (client_name etc.)
  ingestion_service.py    # Text extraction (PDF/DOCX) and chunking
  kb_ingestion_service.py # KB entry generation from documents
  knowledge_bank_service.py
  memory_service.py
  organization_service.py
  rag_service.py          # Vector search over document chunks
  review_annotation_service.py  # Annotations, replies, history, KB promotion
  review_handoff_service.py     # Review rounds: access, capabilities, lifecycle, locks
  review_pdf_export_service.py  # Pure PDF overlay + notes appendix rendering
  storage_service.py      # Cloudflare R2 upload/download
  survey_service.py
  user_service.py
  wiki_service.py
```

Design service functions so they could become tools later:

```py
search_documents(...)
search_memories(...)
save_memory(...)
suggest_shared_memory(...)
generate_insights(...)
```

Do not add a tool registry unless it removes real duplication.

## Database Migrations

All schema changes go through Alembic (`backend/migrations/`). Never add new tables or indexes only to `create_db_tables()` — that path runs only when `AUTO_CREATE_TABLES=true`, which is not the case in production.

Current head: `z3e4f5a6b7c8`

```sh
cd backend && source .venv/bin/activate
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

## Frontend Tooling

A Claude Code hook runs `tsc --noEmit` after every `Edit`/`Write` to a file under `frontend/src/`. Type errors surface immediately in the session rather than at deploy time. The hook is in `.claude/settings.json`.

When adding or moving components, always verify no imports are broken — the TypeScript hook is your safety net, but only triggers after a save.

## Implementation Status

The following items from the original plan are complete:

- Database connection and models
- Chat endpoint with persisted chat threads (OpenRouter, per-user key)
- Google OAuth auth routes and JWT session
- Document upload (Cloudflare R2)
- Text extraction for PDF and DOCX
- Chunking and embeddings (OpenAI text-embedding-3-small)
- RAG search with vector similarity
- Memory CRUD and retrieval
- Knowledge Bank (scoped RBAC, PII redaction, audit log, promotion flow)
- Wiki (markdown pages, graph view, document ingestion)
- Wellbeing surveys
- Action board (kanban)
- Birdie AI mentor (streaming)
- Dream memory consolidation (DB-backed async jobs, durable across restarts)
- Thread summarisation for long chats
- Deployment wiring (Railway)

## Legal Data Rules

Treat document and memory access as a security boundary.

Every retrieval path must check:

- current user
- workspace membership
- matter access
- document ownership or matter association

Never retrieve across matters or workspaces by default.

For demos, use synthetic or non-confidential documents. If external LLM providers receive document text, make that explicit in code comments, docs, or demo setup notes.

## LLM Provider Guidance

Use a provider abstraction instead of scattering SDK calls through routes.

Expected backend env vars:

```txt
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst
AUTO_CREATE_TABLES=false
# Demo only (read when DEMO_MODE=true): OpenRouter key for users without their own
DEMO_OPENROUTER_KEY=...
# Optional tier defaults: OPENROUTER_DEFAULT_HIGH, OPENROUTER_DEFAULT_MID
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
CLOUDFLARE_R2_BUCKET_NAME=lexcatalyst
CLOUDFLARE_R2_ENDPOINT_URL=https://aa1656cdf4783d312f507847447334cb.r2.cloudflarestorage.com
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
GOOGLE_CLIENT_ID=...
```

Every LLM call uses the acting user's own OpenRouter key (no firm key). Users pick any model for two tiers, **High** and **Mid**, and choose a tier per feature in Settings → Models; the feature list lives in `llm_service.FEATURES`. LexChat and Birdie show a High/Mid pill in the composer to switch per prompt. Background jobs run on the key of the user who started them. Embeddings stay on OpenAI.

Keep the provider interface minimal:

```py
generate_chat_response(messages, *, temperature=0.2)
embed_texts(texts)
```

## Matters

Everything is grouped by matter: documents, Knowledge Bank entries, LexChats and Workboard items each carry an optional `matter_id`; no matter means "General". Matters are listed and managed on Home (create, edit, delete), and each has a page at `/matters/:id` (documents with one-level folders, cases, LexChats, pending). `/matters/general` is the same page for items with no matter. There is no standalone Documents list. `DELETE /matters/{id}` is a hard delete (partner/admin): linked records fall back to General, and matter-scoped KB entries become private. Chats and documents are reassigned with `PATCH` and `matter_id` (`null` = General).

## Frontend Guidance

This is an operational legal workspace, not a marketing site.

Keep the look consistent: every page sits on `bg-surface` (#fafaf8), the brand colour is `bg-accent` / `text-accent` (#1e3a8a), page titles are serif (`font-serif`, 4xl for full pages, 2xl in `PanelHeader`), and body text is the default sans. These are theme tokens in `frontend/src/index.css`; use them instead of hard-coded hex values.

Use dense, readable UI for repeated work:

- chat as the primary workflow
- document status visible
- citations and source references visible
- memory review explicit
- admin insights secondary

Do not overbuild custom interaction patterns. Use standard controls and accessible forms.

All API calls go through `shared/api/api.ts`. Map snake_case backend fields to camelCase there, not in components. Never call `fetch` directly from a component.

## Documentation Rules

Keep README setup commands current whenever dependencies, ports, env vars, or run commands change.

If a new backend route is added, document the route and expected authentication behavior.

If the LLM or embedding provider changes, update both `README.md` and this file.

All AI features run through OpenRouter on the user's own key. Prompts (including document excerpts) leave for OpenRouter and the chosen model provider; keep that disclosure in the UI and README.

LexChat's streamed tool loop includes `search_elitigation` for public Singapore judgments (short legal-topic query only; no client facts or document excerpts sent to eLitigation). Recent-case requests use newest-first decision-date sorting; an optional year filters the decision year. Numbered sources include judgment links, dates and available excerpts. Search errors must remain distinct from empty results. The non-streaming `/chat` route retains internal retrieval only.

The Chrome extension (`extension/`) runs its selection content script only on origins the user turns on, and sends user-shared webpage text to Birdie as `web_context` on `POST /birdie/stream` and highlighted clauses to `POST /precedent/search`; keep the side-panel disclosure in sync with the provider line above. Birdie cites case law only from eLitigation (`case_law_service.py`); only a search phrase is sent there.

`DEMO_MODE=true` enables `/demo/*` (admin-only, 404 otherwise) for user switching and seeding, makes every Google sign-in an admin, and lets users mimic any role via `PUT /demo/role` (Settings → View as). Never enable it in a deployment with real client data.

If a new Alembic migration is added, update the "Current head" reference above.
