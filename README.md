# LexCatalyst

LexCatalyst is an AI-powered legal workspace designed to reduce cognitive load for junior lawyers and improve efficiency for legal teams. It transforms raw legal documents into structured, searchable knowledge, provides matter-aware AI assistance, and tracks team wellbeing through weekly check-ins.

## Core Features

### Knowledge & Documents
- **Async document, Knowledge Bank, and Dream jobs**: The FastAPI service runs an embedded worker thread that claims durable Postgres jobs for extraction, OCR, embeddings, optional **DeepSeek Pro** Knowledge Bank summaries, and automatic memory consolidation.
- **Auditable memory consolidation**: Dream applies conservative memory additions, merges, updates, and drops without a manual approval step. Automated memories retain the agent's justification.
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
- **Audit trail**: Knowledge Bank edits are logged in `kb_access_log`; reads are not recorded.

### Birdie — Floating AI Mentor
- A **draggable picture-in-picture widget** (320×480, fixed position, drag anywhere). Open via the "Birdie" pill in the chat header.
- Tabs: **Ask** (live chat), **Review** (mentor cards), **Examples** (KB-backed), **Progress** (skills map).
- Uses a dedicated `/birdie/stream` endpoint with a mentor-specific system prompt — separate agent from the main legal chat. Always runs on `deepseek-v4-flash` for snappy conversational replies.
- Pulls firm KB context (RBAC-respecting) for grounded answers.

### Wellbeing — Weekly Team Check-ins
- Survey responses are linked to the submitting user and upserted per user, question, and week.
- Partners/admins can view every user’s completion state and average score, create questions, and toggle questions on/off.
- All authenticated users can submit. Existing responses from before migration `n1c2d3e4f5a6` remain aggregate-only.

### Workboard — Task Delegation
- Kanban-style board (To Do / In Progress / Review / Done) with priority pills.
- **Partners and senior associates** can create and assign actions; assignee or assigner can update.
- Completing a linked review handoff moves its ticket to Done. Any authenticated user can delete a ticket.
- Filter by matter, edit through a detail dialog.
- Admin demo tools can idempotently add Sarah Chen (senior associate) and Jane Pereira (associate) to the firm roster.

### Documents — In-App Review
- Clicking a document opens a right-side review drawer. PDFs render inline; DOCX files provide an authenticated download.
- Matter members can view documents and share flat Markdown comments. Comment authors and partners/admins on the matter can delete comments.
- Uploaders can rename documents without moving the stored R2 object; citation labels are updated to use the new filename.

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
- **React 19** + **TypeScript 6** + **Vite 8**, installed and built with **Bun 1.3**
- **React Router 7** for URL-backed workspace navigation and **TanStack Query v5** for paginated server state and job-status polling
- **Tailwind CSS 4** through the Vite plugin
- **react-markdown** + **remark-gfm** for KB summary rendering
- **Server-Sent Events** for the streaming chat and Birdie agent

### Backend
- **FastAPI** on **Python 3.12**, served by Uvicorn, plus a database-backed background worker
- **SQLAlchemy 2.0** + **Alembic** migrations
- **PostgreSQL 17** + **pgvector** (1536-dimension cosine similarity) and `pg_trgm`
- **Pydantic 2** request/response validation
- **pypdf**, **python-docx**, **Tesseract**, and **Poppler** for document extraction and OCR fallback
- **Google OAuth2** + **JWT** auth; field-level Fernet encryption for `client_name`

### AI & Search
- **DeepSeek V4 Pro** for KB summaries and Dream memory consolidation
- **DeepSeek V4 Flash** for Birdie mentor chat and thread summarisation
- **DeepSeek V4 Flash/Pro** user-selectable for the main agent chat
- **OpenAI `text-embedding-3-small`** (1536 dim) for both document chunks and KB entry summaries
- **Cloudflare R2** for original document storage

### Infrastructure
- **Docker Compose** for local PostgreSQL
- **Railway** for the static frontend, FastAPI web service with its embedded worker, and managed PostgreSQL
- **Cloudflare R2** as the S3-compatible object store
- **Alembic head:** `s4b5c6d7e8f9`

Editable high-level architecture diagrams:

- [`docs/architecture-system-context.drawio`](docs/architecture-system-context.drawio)
- [`docs/architecture-chat-retrieval.drawio`](docs/architecture-chat-retrieval.drawio)
- [`docs/architecture-async-processing.drawio`](docs/architecture-async-processing.drawio)
- [`docs/architecture-authorization-boundaries.drawio`](docs/architecture-authorization-boundaries.drawio)

---

## Repository Structure

```txt
.
├── backend/
│   ├── app/
│   │   ├── main.py                            # FastAPI app, lifespan, embedded worker
│   │   ├── worker.py                          # Durable combined queue runner
│   │   ├── worker_types.py                    # Claim ownership token
│   │   ├── models.py                          # SQLAlchemy ORM
│   │   ├── schemas.py                         # Pydantic request/response
│   │   ├── dependencies.py                    # Auth + RBAC helpers
│   │   ├── auth.py                            # Google OAuth + JWT
│   │   ├── routers/                           # Thin HTTP/SSE handlers by domain
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
│   │       ├── survey_service.py              # User-linked weekly surveys + aggregation
│   │       ├── user_service.py                # Role updates
│   │       ├── memory_service.py              # Personal memory store
│   │       ├── organization_service.py        # Teams + matters
│   │       ├── rag_service.py                 # Vector search over docs
│   │       ├── wiki_service.py                # Wiki page generation
│   │       ├── storage_service.py             # R2 / local file storage
│   │       └── field_encryption.py            # Fernet encryption
│   ├── migrations/versions/                   # Alembic migrations
│   ├── railway.toml                           # Migrations + API + embedded worker
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/                               # App shell and URL route state
│   │   ├── features/                          # Domain-owned screens and components
│   │   │   ├── chat/                          # Main agent chat with tool steps
│   │   │   ├── knowledge-bank/                # KB browser, filters, reader, forms
│   │   │   ├── documents/                     # Upload and ingestion status
│   │   │   ├── actions/                       # Kanban task board
│   │   │   ├── memories/                      # Memory CRUD and async Dream results
│   │   │   ├── wiki/                          # Wiki editor and graph
│   │   │   └── ...                            # Auth, Birdie, settings, wellbeing
│   │   └── shared/
│   │       ├── api/api.ts                     # API client and SSE handling
│   │       ├── lib/                           # Shared async/error helpers
│   │       ├── types/workspace.ts             # Cross-feature domain types
│   │       └── ui/                            # Button, Dialog, badges, Markdown
│   └── package.json
└── docs/
    ├── architecture-system-context.drawio     # Services and external dependencies
    ├── architecture-chat-retrieval.drawio     # ReAct chat and scoped retrieval
    ├── architecture-async-processing.drawio   # Durable document, KB, and Dream jobs
    ├── architecture-authorization-boundaries.drawio
    │                                          # Legal data access boundaries
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
make install
# Configure .env (see below)
make migrate
make dev
```

`make dev` starts both FastAPI and the embedded durable worker. Do not start
`make worker` in a second terminal because that would add duplicate worker
capacity.

Authenticated Dream endpoints:

- `POST /memories/dream` queues consolidation and returns immediately with a job ID.
- `GET /memories/dream/{job_id}` returns `processing`, `completed`, or `failed`; completed responses include the updated memories and applied justifications.

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

# Required for document upload, review, and worker processing
CLOUDFLARE_R2_BUCKET_NAME=lexcatalyst
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_ENDPOINT_URL=...

# Must be at least 32 chars; rotating this invalidates encrypted client_name fields
JWT_SECRET_KEY=at_least_32_characters_long
```

---

## Roles & Permissions

| Role | Manage any firm-wide entry | Create matters | Create actions | Manage surveys | View survey results |
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

The creator remains the entry owner and can change its classification between all four scopes.
The backend validates team and matter membership before applying the change, and every agent KB
search uses the same scope predicate as the direct KB API.

Optimized KB read routes, all requiring Bearer authentication:

- `GET /kb/entries?limit=30&offset=0` returns paginated summaries without vectors or full Markdown bodies.
- `GET /kb/entries/status?ids=...` returns polling state only and does not write audit rows.
- `GET /kb/entries/{id}` returns one full entry without creating an audit event.
- `GET /kb/graph` returns a scope-filtered graph projection.

---

## System Architecture

### Async Document and KB Ingestion Pipeline

```
[Upload PDF/DOCX]                          (request)
       │
       ▼
[Validate + store original in R2]
       │   document.status="processing"
       │
       ├──► Return 202 Accepted to client
       │
       ▼
[Embedded FastAPI worker]                 (async)
       │   Claims document rows with SKIP LOCKED
       │   Reclaims stale jobs after restarts
       │   Downloads original from R2
       │   Extracts text; OCRs scanned PDFs
       │   Chunks + embeds extracted text
       │
       ▼
[document.status="ready" or "failed"]
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
[Embedded FastAPI worker]                 (async)
       │   Claims queued rows from Postgres
       │   Reclaims stale jobs after restarts
       │   Samples up to 80 chunks (~240KB)
       │   Calls DeepSeek Pro
       │   Parses JSON → title + body
       │   Computes embedding
       │
       ▼
[status="ready"] or [status="failed"]
       │
       ▼
Frontend polls `GET /documents` while a document is processing. It polls
`/kb/entries/status` for processing KB IDs only, then refreshes the affected
page or detail after a terminal state.
```

Retry: clicking "Retry summary" resets a failed entry to `processing`; the
embedded worker claims it from the durable Postgres queue.

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

Railway frontend service settings:

```txt
Root directory: frontend
Build command: bun run build
Static output directory: dist
BUN_VERSION: 1.3.11
VITE_API_URL: https://<backend-service>.up.railway.app
```

The frontend uses `bun.lock` exclusively. Do not commit `package-lock.json`.

| What | Where | Required? |
|---|---|---|
| Run migrations | Auto (Railway runs `alembic upgrade head && uvicorn ...`) | Auto |
| Background worker | Runs inside the FastAPI service through its lifespan; do not create a second Railway service | Auto |
| Frontend deps install | `bun install` adds `react-markdown` + `remark-gfm` | Yes — happens at build |
| Backend deps install | No new Python packages | n/a |
| Frontend env vars | `BUN_VERSION=1.3.11` and `VITE_API_URL` in Railway | Required |
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
| `g4b5c6d7e8f9` | Adds tags to action items | No |
| `h5c6d7e8f9a0` | Keeps only KB edit audit rows and enforces the edit-only constraint | Yes, removes non-edit audit history |
| `i6d7e8f9a0b1` | Adds durable document-worker claim fields and queue index | No |
| `n1c2d3e4f5a6` | Links new survey responses to users and prevents duplicate weekly answers | No |
| `o1d2e3f4a5b6` | Adds durable Dream claim fields and stores automated memory justifications | No |
| `p1e2f3a4b5c6` | Adds document comments | No |
| `q2f3a4b5c6d7` | Adds review handoffs, structured findings, and active handoff links on actions | No |
| `r3a4b5c6d7e8` | Adds durable review-handoff worker claim fields | No |

`h5c6d7e8f9a0` intentionally removes historical read/share/redaction audit rows.
Knowledge and document records are unaffected.

Authenticated document review routes:

- `PATCH /documents/{id}` renames an uploaded document; uploader only.
- `GET /documents/{id}/file` serves the original file inline. It accepts the normal Bearer header or the JWT `token` query parameter used by the PDF iframe.
- `GET|POST /documents/{id}/comments` lists or creates comments for the uploader or a member of the document's matter.
- `DELETE /documents/comments/{comment_id}` is restricted to the author or a partner/admin who can access the matter document.

Authenticated Workboard and review-handoff routes:

- `DELETE /actions/{id}` allows any authenticated user to delete a ticket at any workflow stage.
- `POST|GET /handoffs` creates or lists structured review handoffs linked to Workboard tickets.
- `GET|PATCH /handoffs/{id}` reads or updates a handoff. Completing it requires every finding to be reviewed and moves the active linked ticket to Done.
- `POST /handoffs/{id}/findings` creates a structured review finding.
- `PATCH|DELETE /handoffs/{id}/findings/{finding_id}` updates or deletes a finding.

### What to verify after deploy
1. `/me` returns `firm_role` and `is_admin` for the logged-in user.
2. Existing KB entries appear with no "processing" badge (they default to `status="ready"`).
3. The backend service logs `LexCatalyst worker started`.
4. Uploading a new PDF returns with `processing`, then flips to `ready` after extraction and embedding.
5. Clicking "Add to Knowledge Bank" shows a "Summarising..." badge that flips to "Ready".
6. Clicking "Dream" returns immediately; the worker applies changes and the Memories panel shows the justifications.
7. The Birdie button in the chat header opens the floating PiP — drag it around to confirm position state.
8. Settings panel lets you switch roles; KB write buttons should hide/show accordingly.

---

## License
Proprietary — Internal hackathon project.
