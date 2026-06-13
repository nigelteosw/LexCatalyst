# LexCatalyst

LexCatalyst is an AI-powered legal workspace designed to reduce cognitive load for junior lawyers and improve efficiency for legal teams. It transforms raw legal documents into structured, searchable knowledge, provides matter-aware AI assistance, and tracks team wellbeing — anonymously.

## Core Features

### Knowledge & Documents
- **Async Knowledge Bank ingestion**: Upload a PDF/DOCX and click "Add to Knowledge Bank". A dedicated Railway worker claims the durable Postgres job and uses **DeepSeek Pro** to generate a structured summary with inline page citations. The UI polls only lightweight status rows while `status="processing"`.
- **3-category Knowledge Bank**: `knowledge_bank` (playbooks, precedents, templates), `style_guide` (writing standards, partner prefs), `action` (soft-skill / wellness guides).
- **Drag-and-drop uploads**: Drop PDF/DOCX directly onto the Documents panel. OCR fallback via Tesseract for scanned PDFs.
- **Semantic search**: pgvector cosine similarity over document chunks AND KB entries. Embeddings fingerprinted by content hash so they auto-refresh when content changes.
- **Source citations**: Inline `[p.X]` references in KB summaries; full source-chunk attribution available via the Wiki feature.

### Agentic Chat
- **ReAct agent loop** with cycle detection and forced-final-answer on max rounds. Tools:
  - `search_documents` — semantic search over uploaded files
  - `search_knowledge_bank` — search KB entries the user has access to
  - `search_memories` — keyword search over personal memory
  - `get_kb_entry` — fetch the full KB summary; returns `source_document_id` for chaining
  - `read_document` — fetch the **full extracted text** of a document (up to 100KB) when the summary is insufficient
- **Streaming SSE** with token-by-token output and per-tool step visualisation.
- **Audit trail**: every KB read/write through the agent is logged in `kb_access_log`.

### Birdie — Floating AI Mentor
- A **draggable picture-in-picture widget** (320×480, fixed position, drag anywhere). Open via the "Birdie" pill in the chat header.
- Tabs: **Ask** (live chat), **Review** (mentor cards), **Examples** (KB-backed), **Progress** (skills map).
- Uses a dedicated `/birdie/stream` endpoint with a mentor-specific system prompt — separate agent from the main legal chat. Always runs on `deepseek-v4-flash` for snappy conversational replies.
- Pulls firm KB context (RBAC-respecting) for grounded answers.

### Wellbeing — Truly Anonymous Surveys
- The `survey_responses` table **has no `user_id` column**. Anonymity is structural — not enforced by code that could be forgotten.
- Partners/admins can create questions, view weekly aggregates, and toggle questions on/off.
- All authenticated users can submit; results are weekly aggregates per question.

### Actions — Task Delegation
- Kanban-style board (To Do / In Progress / Review / Done) with priority pills.
- **Partners and senior associates** can create and assign actions; assignee or assigner can update.
- Filter by matter, edit through a detail dialog.

### Role-Based Access Control
- Three lawyer roles: **partner**, **senior_associate**, **associate**. Plus an `is_admin` flag for firm IT/ops (super-user bypass).
- KB read/write enforced per-scope: `firm_wide` (partners only write), `team` (team members), `matter` (matter members), `private` (creator).
- Settings panel lets the current user change their role for demo purposes.

### Matters & Teams
- Matter-scoped chat with encrypted `client_name` fields.
- Team and matter memberships drive KB visibility.

---

## Tech Stack

### Frontend
- **React 19** + **TypeScript** + **Vite**
- **Zustand** for view state, **TanStack Query v5** for paginated server state and lightweight job-status polling
- **Tailwind CSS**
- **react-markdown** + **remark-gfm** for KB summary rendering
- **Server-Sent Events** for the streaming chat and Birdie agent

### Backend
- **FastAPI** (Python 3.12) plus a database-backed KB worker process
- **SQLAlchemy 2.0** + **Alembic** migrations
- **PostgreSQL** + **pgvector** (1536-dim cosine similarity)
- **Tesseract** (via `pytesseract`) for OCR fallback on scanned PDFs
- **Google OAuth2** + **JWT** auth; field-level Fernet encryption for `client_name`

### AI & Search
- **DeepSeek V4 Pro** for KB summarisation (hardcoded — comprehensive, long-context)
- **DeepSeek V4 Flash** for Birdie mentor chat (fast, conversational)
- **DeepSeek V4 Flash/Pro** user-selectable for the main agent chat
- **OpenAI `text-embedding-3-small`** (1536 dim) for both document chunks and KB entry summaries
- **Cloudflare R2** for original document storage (optional — local disk fallback)

---

## Repository Structure

```txt
.
├── backend/
│   ├── app/
│   │   ├── main.py                            # API routes & SSE streaming
│   │   ├── kb_worker.py                       # Durable KB ingestion worker
│   │   ├── models.py                          # SQLAlchemy ORM
│   │   ├── schemas.py                         # Pydantic request/response
│   │   ├── dependencies.py                    # Auth + RBAC helpers
│   │   ├── auth.py                            # Google OAuth + JWT
│   │   ├── providers/                         # DeepSeek + OpenAI integrations
│   │   └── services/
│   │       ├── agent_service.py               # ReAct loop with cycle detection
│   │       ├── birdie_service.py              # Mentor agent (separate prompt + endpoint)
│   │       ├── chat_service.py                # Thread mgmt, history, summary
│   │       ├── kb_ingestion_service.py        # Worker claim + Pro summarisation
│   │       ├── knowledge_bank_service.py      # KB CRUD + RBAC scope filter
│   │       ├── document_service.py            # Upload + full-text reader
│   │       ├── ingestion_service.py           # PDF/DOCX extraction (OCR fallback)
│   │       ├── action_service.py              # Task items with RBAC
│   │       ├── survey_service.py              # Anonymous surveys + weekly aggregation
│   │       ├── user_service.py                # Role updates
│   │       ├── memory_service.py              # Personal memory store
│   │       ├── organization_service.py        # Teams + matters
│   │       ├── rag_service.py                 # Vector search over docs
│   │       ├── wiki_service.py                # Wiki page generation
│   │       ├── storage_service.py             # R2 / local file storage
│   │       └── field_encryption.py            # Fernet encryption
│   ├── migrations/versions/                   # 14 Alembic migrations
│   ├── railway.toml                           # Auto-runs `alembic upgrade head`
│   ├── railway.worker.toml                    # Dedicated KB worker service
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx                  # Main agent chat with tool steps
│   │   │   ├── BirdiePanel.tsx                # Floating PiP mentor
│   │   │   ├── KnowledgeBankPanel.tsx         # KB browser + reader (polls during processing)
│   │   │   ├── DocumentsPanel.tsx             # Drag-and-drop upload + "Add to KB"
│   │   │   ├── ActionsPanel.tsx               # Kanban task board
│   │   │   ├── WellbeingPanel.tsx             # Survey + partner aggregates
│   │   │   ├── SettingsPanel.tsx              # Role management
│   │   │   ├── WikiPanel.tsx, MemoriesPanel.tsx, Sidebar.tsx, ...
│   │   │   └── MarkdownContent.tsx            # react-markdown renderer
│   │   ├── store/viewStore.ts                 # Zustand routing
│   │   ├── lib/api.ts                         # API client + SSE handling
│   │   └── types/workspace.ts
│   └── package.json
└── docs/
    ├── product-requirement.md                 # Whiteboard notes
    └── rfc-react-agent-loop.md
```

---

## Local Setup

### 1. Database (Postgres + pgvector)
```bash
docker compose up -d
```

### 2. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Configure .env (see below)
alembic upgrade head
python -m uvicorn app.main:app --reload
```

You also need **Tesseract** and **Poppler** on the system PATH for OCR / PDF→image conversion (already installed in the Railway image via `nixpacks.toml`):
```bash
# macOS
brew install tesseract poppler
# Debian/Ubuntu
apt-get install tesseract-ocr poppler-utils
```

### 3. Frontend
```bash
cd frontend
bun install
bun run dev
```

---

## Environment Variables

`backend/.env`:

```ini
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst
DEEPSEEK_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_CLIENT_ID=your_google_oauth_client_id

# Optional — R2 falls back to local disk if unset
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_ENDPOINT_URL=...
CLOUDFLARE_R2_BUCKET=...

# Must be at least 32 chars; rotating this invalidates encrypted client_name fields
JWT_SECRET_KEY=at_least_32_characters_long
```

---

## Roles & Permissions

| Role | KB firm-wide write | Create matters | Create actions | Manage surveys | View survey results |
|---|---|---|---|---|---|
| `admin` (firm IT/ops) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `partner` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `senior_associate` | — | ✅ | ✅ | — | — |
| `associate` | — | ✅ | — | — | — |

KB scope visibility (read access):
- `firm_wide` — every authenticated user
- `team` — team members only
- `matter` — matter members only
- `private` — creator only

Optimized KB read routes, all requiring Bearer authentication:

- `GET /kb/entries?limit=30&offset=0` returns paginated summaries without vectors or full Markdown bodies.
- `GET /kb/entries/status?ids=...` returns polling state only and does not write audit rows.
- `GET /kb/entries/{id}` returns one full entry and records the user-visible read.
- `GET /kb/graph` returns a scope-filtered graph projection.

---

## System Architecture

### Async KB Ingestion Pipeline

```
[Upload PDF/DOCX]                          (sync, ~5s)
       │
       ▼
[Extract text + chunk + embed chunks]
       │
       ▼
[User clicks "Add to Knowledge Bank"]
       │
       ▼
[create_pending_kb_entry]                  (sync, <100ms)
       │   status="processing"
       │   body=""
       │   embedding=NULL
       │
       ├──► Return 202 Accepted to client
       │
       ▼
[Dedicated Railway KB worker]             (async)
       │   Claims queued rows from Postgres
       │   Reclaims stale jobs after restarts
       │   Samples up to 32 chunks (~58KB)
       │   Calls DeepSeek Pro
       │   Parses JSON → title + body
       │   Computes embedding
       │
       ▼
[status="ready"] or [status="failed"]
       │
       ▼
Frontend polls `/kb/entries/status` for processing IDs only, then refreshes
the affected page or detail after a terminal state.
```

Retry: clicking "Retry summary" resets a failed entry to `processing`; the
worker claims it without relying on the web process.

### ReAct Agent Loop
1. **Build context** — `prepare_agent_context` injects memories + thread summary into the system prompt (NOT KB/docs — those come via tools).
2. **Stream** — `provider.stream_with_tools` yields `token` and `tool_calls` events.
3. **Execute** — each tool returns `(result_text, summary)`. RBAC and audit logging applied at the tool layer.
4. **Cycle guard** — if a round's tool calls repeat a previous fingerprint, inject a "stop repeating" system message and short-circuit to the final answer.
5. **Max rounds** — round MAX+1 disables tools entirely to force a text answer.

### Birdie — Stateless Mentor Agent
- `/birdie/stream` is an endpoint distinct from `/chat/stream`. Client manages history.
- System prompt: brief (3–5 sentences), legal hard skills + soft skills equally weighted, cites firm KB inline.
- Reuses `search_kb_for_chat` so KB scope filtering still applies.

---

## Post-Deploy Checklist

After pushing this branch:

Cloudflare Pages frontend settings:

```txt
Root directory: frontend
Build command: bun run build
Build output: dist
BUN_VERSION: 1.3.11
```

The frontend uses `bun.lock` exclusively. Do not commit `package-lock.json`;
Cloudflare treats it as an npm project and runs `npm ci` before the build command.

| What | Where | Required? |
|---|---|---|
| Run migrations | Auto (Railway runs `alembic upgrade head && uvicorn ...`) | Auto |
| KB worker | Create a second Railway service using `/backend/railway.worker.toml`; the web service owns migrations | Required |
| Frontend deps install | `bun install` adds `react-markdown` + `remark-gfm` | Yes — happens at build |
| Backend deps install | No new Python packages | n/a |
| New env vars | `BUN_VERSION=1.3.11` in Cloudflare Pages | Recommended |
| Existing KB entries | Get `status="ready"` automatically via the `server_default` | Auto |
| Existing KB embeddings | `embedding_content_hash` is NULL until first refresh | Optional |
| Repair search index | `POST /kb/backfill-embeddings` (or the "Repair search index" button) backfills missing hashes idempotently | Recommended once |

### What the migrations actually change

| Migration | Change | Destructive? |
|---|---|---|
| `d1e2f3a4b5c6` | Adds `users.is_admin`, creates `survey_questions`, `survey_responses`, `action_items` | No |
| `e2f3a4b5c6d7` | Adds `kb_entries.embedding_content_hash` (nullable) | No |
| `f3a4b5c6d7e8` | Adds `kb_entries.status` (default `ready`) and `kb_entries.error_message` | No |
| `a4b5c6d7e8f9` | Adds worker claim fields and KB read-path indexes | No |

All four are **purely additive** — existing rows are populated via column defaults, and downgrades drop only what was added. Safe to deploy without destructive data changes.

### What to verify after deploy
1. `/me` returns `firm_role` and `is_admin` for the logged-in user.
2. Existing KB entries appear with no "processing" badge (they default to `status="ready"`).
3. The Railway KB worker logs `Knowledge Bank worker started`.
4. Uploading a new PDF and clicking "Add to Knowledge Bank" shows a "Summarising..." badge that flips to "Ready".
5. The Birdie button in the chat header opens the floating PiP — drag it around to confirm position state.
6. Settings panel lets you switch roles; KB write buttons should hide/show accordingly.

---

## License
Proprietary — Internal hackathon project.
