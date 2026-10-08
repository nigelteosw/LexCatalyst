# LexCatalyst

LexCatalyst is an AI-powered legal workspace designed to reduce cognitive load for junior lawyers and improve efficiency for legal teams. It transforms raw legal documents into structured, searchable knowledge, provides matter-aware AI assistance.

## Core Features

### Home & Workspace

- **Daily overview:** active matters, tasks due in the next seven days, reviews waiting, and open tickets related to the signed-in user.
- **Pick up work:** attention items, searchable matters, the three most recent LexChats, and three recent documents.
- **Matter-first navigation:** Home manages matters; each matter page holds its documents, chats, and pending work. Unfiled items appear under General. There is no standalone document library.
- **Responsive interface:** Geist for UI text and Newsreader for headings, with shared type tokens that scale modestly with screen width. The sidebar uses smaller labels, evenly spaced icon slots, and reduced-motion support. Collapse it with the header control; click the logo in the collapsed rail to expand it. The account menu includes profile settings, sign-out, and demo user switching when enabled.

### Knowledge & Documents
- **Async document, Knowledge Bank, and Dream jobs**: The FastAPI service runs an embedded worker thread that claims durable Postgres jobs for extraction, OCR, embeddings, OpenRouter-based KB formatting, and automatic memory consolidation.
- **Auditable memory consolidation**: Dream applies conservative memory additions, merges, updates, and drops without a manual approval step. Automated memories retain the agent's justification.
- **3-category Knowledge Bank**: `knowledge_bank` (playbooks, precedents, templates), `style_guide` (writing standards, partner prefs), `action` (soft-skill / wellness guides).
- **Drag-and-drop uploads**: Upload PDF/DOCX from a matter’s documents section or attach a document in LexChat. OCR fallback via Tesseract for scanned PDFs.
- **Document and note metadata**: every uploaded document and every manual Knowledge Bank note gets LLM-generated tags and a short summary (documents also get a type, status and execution date). People can edit all of it, and edited fields are kept when metadata is regenerated. The metadata is searchable, shown on matter document rows, and lets Birdie find documents. Notes flagged for PII are never sent for tagging. Existing documents and notes are tagged with `POST /kb/backfill-document-metadata` and `POST /kb/backfill-note-metadata` (admin, batches of up to 25; repeat until `remaining` stops falling).
- **Semantic search**: pgvector cosine similarity over document chunks AND KB entries. Embeddings fingerprinted by content hash so they auto-refresh when content changes.
- **Source citations**: LexChat shows numbered citations with a source panel for the supporting passage and a link to the document, Knowledge Bank entry, or public judgment.

### Agentic Chat
- **ReAct agent loop** with cycle detection and forced-final-answer on max rounds. Tools:
  - `search_documents` — semantic search over uploaded files
  - `search_knowledge_bank` — search KB entries the user has access to
  - `search_memories` — keyword search over personal memory
  - `get_kb_entry` — fetch the full KB entry body; returns `source_document_id` for chaining
  - `read_document` — fetch the **full extracted text** of a document (up to 100KB) for fine-grained passage lookup
- **Streaming SSE** with token-by-token output and per-tool step visualisation.
- **Audit trail**: Knowledge Bank edits are logged in `kb_access_log`; reads are not recorded.
- **Resource metadata index**: documents, KB entries, workboard items, and review handoffs sync into `resource_metadata` for one authenticated access-aware lookup surface.

### Birdie — Floating AI Mentor
- A small **fixed circular button at the bottom right** opens Birdie across the signed-in workspace. Drag the panel header to move it and its bottom-right corner to resize it (arrow keys also resize). Close with the X or the Birdie button; conversation state survives closing. Text can be selected/copied and pasted into the composer.
- Tabs: **Ask** (live chat), **Review** (reviewer feedback and lessons), **Examples** (KB-backed), **Progress** (skills map).
- **Review tab:** comments seniors leave while redlining a junior's returned/completed review round appear here automatically, with no promote step. Birdie distils each round into 1–4 general lessons (once, on first open) and every comment has an **Explain this** button that continues in the Ask tab. Only the junior who submitted the round sees its feedback.
- Uses a dedicated `/birdie/stream` endpoint with a mentor-specific system prompt — separate agent from the main legal chat. Runs on the user's own **OpenRouter** key and the tier (High or Mid) chosen in the composer or Settings → Models.
- Pulls firm KB context (RBAC-respecting), recent reviewer feedback, and the current matter’s own assigned tickets for grounded answers.
- **Workboard tools, web and extension:** create self-assigned tickets; read, edit title/description, move status, reassign, or delete tickets currently assigned to you; report live completed/outstanding/overdue counts. Even admins cannot manage other people’s tickets through Birdie. Reassignment ends access. Linked reviews protect status, assignment and deletion; use the review workflow.
- **Documents:** Birdie can look up the firm's uploaded documents by their tags, summary and type (`find_documents`) and read one by id (`read_document`). It searches the current matter unless the user explicitly asks for all matters, and every read re-checks access to the document.
- **Privacy:** Birdie prompts (document excerpts, KB entries, reviewer feedback, Workboard ticket data) go to OpenRouter and the chosen model provider. Document metadata generation sends the document or note text to the uploader's or author's OpenRouter model.

### Workboard — Task Delegation
- Board and list views share a five-stage flow: To do → Drafting → Internal review → With client / counterparty → Done. Existing drafting and review tickets keep their stages; `with_client` is accepted by the authenticated action update endpoint.
- **Partners and senior associates** can create and assign actions; assignee or assigner can update.
- Completing a linked review handoff moves its ticket to Done. Any authenticated user can delete a ticket.
- Filter by matter, assignee, and tags; edit through a detail dialog.
- **Responsive board:** columns wrap to fit the available workspace width; scroll within each column without a visible scrollbar. Long tags truncate with their full text available on hover.
- **Sortable list:** Task, Status, Assignee, and Due headers toggle ascending/descending order. Mobile uses a Sort by selector and direction button. Status follows workflow order; unassigned and undated tickets remain last for their respective sorts. Sorting applies to the currently loaded, filtered tickets.
- Admin demo tools can idempotently add Sarah Chen (senior associate) and Jane Pereira (associate) to the firm roster.

Settings → Development & Testing → **Load property Workboard demo** adds 12 synthetic Singapore property-law tasks across four demo matters and all five stages, plus four private sample chats each for the presenter, Sarah, Jane and Marcus (16 chats in total). Chats contain pre-written fictional exchanges, stay linked to their matter and respect existing per-user chat ownership. Available to admins with `DEMO_MODE=true`; `POST /demo/workboard/property` requires an authenticated demo admin and returns 404 otherwise. Repeated loads preserve existing tasks and add no duplicates. The seed also adds Jane’s two Bishan OTP review PDFs, Sarah’s four comments and lessons, and a firm conveyancing style guide. PDF upload and processing require R2 and OpenAI embeddings; the style guide also requires embeddings. All content is fictional. Reloading retries failed PDFs and completes interrupted uploads without duplicating review rounds. Settings reports failed or processing PDFs; wait for them to be ready before presenting.

### Documents — In-App Review
- Open a document from its matter or a citation to review it at `/knowledge/documents/:id`. PDFs render inline; DOCX files provide an authenticated download.
- Matter members can view documents and share flat Markdown comments. Comment authors and partners/admins on the matter can delete comments.
- Uploaders can rename documents without moving the stored R2 object; citation labels are updated to use the new filename.

### Role-Based Access Control
- Three lawyer roles: **partner**, **senior_associate**, **associate**. Plus an `is_admin` flag for firm IT/ops (super-user bypass).
- KB read/write enforced per-scope: `firm_wide` (partners only write), `team` (team members), `matter` (matter members), `private` (creator).
- Settings shows the current role read-only; admins manage user roles.

### Matters & Teams
- Matter-scoped chat with encrypted `client_name` fields.
- Team and matter memberships drive KB visibility.

---

## Tech Stack

### Frontend
- **React 19** + **TypeScript 6** + **Vite 8**, installed and built with **Bun 1.3**
- **React Router 7** for URL-backed workspace navigation and **TanStack Query v5** for paginated server state and job-status polling
- **Tailwind CSS 4** through the Vite plugin
- **react-markdown** + **remark-gfm** for KB entry rendering
- **Server-Sent Events** for the streaming chat and Birdie agent

### Backend
- **FastAPI** on **Python 3.12**, served by Uvicorn, plus a database-backed background worker
- **SQLAlchemy 2.0** + **Alembic** migrations
- **PostgreSQL 17** + **pgvector** (1536-dimension cosine similarity) and `pg_trgm`
- **Pydantic 2** request/response validation
- **pypdf**, **python-docx**, **Tesseract**, and **Poppler** for document extraction and OCR fallback
- **Google OAuth2** + **JWT** auth; field-level Fernet encryption for `client_name`

### AI & Search
- **OpenRouter, bring your own key** for every LLM call (LexChat, Birdie, Dream, KB, memory, summaries). Each user saves their key and picks any model for two tiers, **High** and **Mid**, then chooses which tier each feature uses (Settings → Models). LexChat and Birdie also have a High/Mid pill in the composer.
- **No firm LLM key.** `DEMO_OPENROUTER_KEY` is used only when `DEMO_MODE=true` and the user has no key of their own. Background jobs (KB formatting, Dream) run on the key of the user who started them.
- **OpenAI `text-embedding-3-small`** (1536 dim) for both document chunks and KB entries
- **Cloudflare R2** for original document storage

### Infrastructure
- **Docker Compose** for local PostgreSQL
- **Railway** for the static frontend, FastAPI web service with its embedded worker, and managed PostgreSQL
- **Cloudflare R2** as the S3-compatible object store
- **Alembic head:** `a7b8c9d0e1f2`

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
│   │   ├── providers/                         # OpenRouter (chat) + OpenAI (embeddings) integrations
│   │   └── services/
│   │       ├── agent_service.py               # ReAct loop with cycle detection
│   │       ├── birdie_service.py              # Mentor agent (separate prompt + endpoint)
│   │       ├── chat_service.py                # Thread mgmt, history, summary
│   │       ├── kb_ingestion_service.py        # Worker claim + Flash formatting + embedding
│   │       ├── knowledge_bank_service.py      # KB CRUD + RBAC scope filter
│   │       ├── document_service.py            # Upload + full-text reader
│   │       ├── ingestion_service.py           # PDF/DOCX extraction (OCR fallback)
│   │       ├── action_service.py              # Task items with RBAC
│   │       ├── user_service.py                # Role updates
│   │       ├── memory_service.py              # Personal memory store
│   │       ├── organization_service.py        # Teams + matters
│   │       ├── rag_service.py                 # Vector search over docs
│   │       ├── storage_service.py             # R2 / local file storage
│   │       └── field_encryption.py            # Fernet encryption
│   ├── migrations/versions/                   # Alembic migrations
│   ├── railway.toml                           # Migrations + API + embedded worker
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/                               # App shell and URL route state
│   │   ├── features/                          # Domain-owned screens and components
│   │   │   ├── home/                          # Dashboard and matter management
│   │   │   ├── chat/                          # Main agent chat with tool steps
│   │   │   ├── knowledge-bank/                # KB browser, filters, reader, forms
│   │   │   ├── documents/                     # Upload and ingestion status
│   │   │   ├── actions/                       # Kanban task board
│   │   │   ├── memories/                      # Memory CRUD and async Dream results
│   │   │   └── ...                            # Auth, Birdie, settings
│   │   └── shared/
│   │       ├── api/api.ts                     # API client and SSE handling
│   │       ├── lib/                           # Shared async/error helpers
│   │       ├── types/workspace.ts             # Cross-feature domain types
│   │       └── ui/                            # Button, Dialog, badges, Markdown
│   └── package.json
├── extension/                                 # Birdie Chrome side panel (MV3)
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

Run the database from the repository root and the backend/frontend in separate terminals. Docker Compose runs only Postgres.

Prerequisites: Python 3.12, Bun 1.3, Docker Compose, and Google OAuth credentials. Document processing also requires OpenAI embeddings and Cloudflare R2 credentials; AI features require a personal OpenRouter key in Settings (or the demo-only fallback).

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
cp .env.example .env
# Fill in .env before migrating (see Environment Variables below)
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
cp .env.example .env
# Set VITE_GOOGLE_CLIENT_ID to the same client ID as backend GOOGLE_CLIENT_ID
bun install
bun run dev
```

Local services:

| Service | Address |
|---|---|
| Frontend | `http://127.0.0.1:5173` |
| Backend / API docs | `http://127.0.0.1:8000` / `http://127.0.0.1:8000/docs` |
| Postgres | `127.0.0.1:5432` |

In the Google OAuth web client, authorize `http://127.0.0.1:5173` and `http://localhost:5173` as JavaScript origins. Keep backend `CORS_ORIGINS` aligned with the frontend origins you use.

Mobile layouts cover phone, tablet and desktop widths. To run the frontend checks:

```bash
cd frontend
bun run build
bun run test
bunx playwright install chromium  # one-time browser setup
bun run test:mobile
```

The browser suite uses synthetic API fixtures and a local Vite server; it does not
exercise live Google sign-in, storage, or LLM calls. It covers all workspace pages,
phone navigation, dialogs, document comments, PDF review, shorter viewports, sidebar alignment, responsive Workboard columns, and desktop/mobile list sorting.
A physical iOS/Android keyboard check is still useful before a demo.

### 4. Birdie Chrome extension (optional)

`extension/` builds a Chrome side-panel extension that brings Birdie to any webpage.

```bash
cd extension
cp .env.example .env   # set VITE_GOOGLE_CLIENT_ID (same as the frontend)
bun install
bun run build          # -> extension/dist, talks to https://lexcatalyst-production.up.railway.app
bun run build:local    # -> extension/dist, talks to http://127.0.0.1:8000
bun run package        # -> extension/birdie-extension.zip
```

Load it at `chrome://extensions` -> Developer mode -> Load unpacked -> `extension/dist`.

Sign-in reuses the web Google OAuth client; `https://<extension-id>.chromiumapp.org/` must be an authorised redirect URI on it. The extension ID is pinned by the `key` in `extension/public/manifest.json` (the matching private key, `extension/key.pem`, is git-ignored).

Birdie only reads sites you turn on ("Turn on Birdie for this site", which grants that one origin). On those sites it shows your current highlight above the "Ask Birdie…" box and reads the page text (Google Docs via its text export; in Docs, copy (⌘C) or right-click to share a highlight). Nothing is sent until you press Send or open Related documents. Shared text goes to `POST /birdie/stream` (JWT required) as `web_context` (max 20,000 chars) and then to OpenRouter and the chosen model's provider — choose High or Mid with the pill under the box (tiers and models are set in the web app's Settings → Models). Case-law questions send only a short search phrase to eLitigation (https://www.elitigation.sg); Birdie cites only judgments found there. **New chat** (⌘K) clears the conversation and shared context. The **Related documents** tab calls `POST /precedent/search` with the highlighted clause.

`VITE_APP_URL` (default `https://lexcatalyst.pages.dev`) sets where "Open" links to documents point.

**Releases:** every push to `main` that changes `extension/` runs `.github/workflows/extension-release.yml`: it runs the tests, bumps the patch version in `extension/package.json` and `extension/public/manifest.json` (`node extension/scripts/bump-version.mjs`), builds against the production API, commits `chore(extension): release vX.Y.Z [skip ci]`, tags `extension-vX.Y.Z`, and publishes `birdie-extension-X.Y.Z.zip` as a GitHub Release. Set the repository variable `VITE_GOOGLE_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables) once. For a minor or major bump, edit both version fields by hand in your PR. Do not bump versions by hand otherwise; CI owns the patch number.

---

## Environment Variables

`backend/.env`:

```ini
ENVIRONMENT=development
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst
AUTO_CREATE_TABLES=false
# LLM calls use each user's OpenRouter key (Settings → Models). Demo only:
# DEMO_MODE=true
# DEMO_OPENROUTER_KEY=sk-or-...
OPENAI_API_KEY=your_key_here
GOOGLE_CLIENT_ID=your_google_oauth_client_id

# Required for document upload, review, and worker processing
CLOUDFLARE_R2_BUCKET_NAME=lexcatalyst
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_ENDPOINT_URL=...

# Must be at least 32 chars; rotating this invalidates existing JWT sessions
JWT_SECRET_KEY=at_least_32_characters_long
# Separate encryption key, required outside development; keep it stable
FIELD_ENCRYPTION_KEY=your_fernet_key
# Seals users' saved OpenRouter keys; separate from FIELD_ENCRYPTION_KEY, required outside development
OPENROUTER_KEY_ENCRYPTION_KEY=at_least_32_random_characters
# Comma-separated previous OPENROUTER_KEY_ENCRYPTION_KEY values, kept until keys are re-sealed
# OPENROUTER_KEY_ENCRYPTION_KEYS_OLD=
ADMIN_EMAILS=admin@example.com
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173

# Demo only (see "Demo mode" below). Leave unset/false in real deployments.
DEMO_MODE=false
```

`frontend/.env` (Vite variables are public build-time configuration):

```ini
VITE_API_URL=http://127.0.0.1:8000
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

Keep secrets in `backend/.env`, never in `VITE_*` variables. Generate a dedicated field encryption key with `backend/.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Rotating that key makes existing encrypted fields and saved OpenRouter keys unreadable. Apply schema changes through `make migrate`; do not rely on automatic table creation.

Users' personal OpenRouter keys are not environment variables: they are saved per user in Settings, checked with OpenRouter on save, sealed with AES-256-GCM under `OPENROUTER_KEY_ENCRYPTION_KEY` (bound to the user's id), and never returned by the API. Generate the key with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Rotating it requires moving the old value to `OPENROUTER_KEY_ENCRYPTION_KEYS_OLD` first, or users must re-enter their keys. Settings → AI models also has a "Check key" action, and a model picker with search, provider and tool-support filters, price and context columns, and starred favourites.

Settings routes (all require sign-in and touch only the caller's own row):

- `GET /settings/llm`: status, models, favourites and each feature's resolved model. Never includes the key.
- `PUT /settings/llm`: save a key (checked first; a rejected key leaves the saved one in place), High/Mid models, favourites (max 12) and feature tiers.
- `POST /settings/llm/openrouter-key/verify`: re-check the saved key.
- `DELETE /settings/llm/openrouter-key`: remove the key.
- `GET /settings/llm/models`: OpenRouter's model catalogue, cached for an hour.

---

## Demo mode

For presentations with synthetic data only. Never enable demo mode with real client data. Set `DEMO_MODE=true`, sign in with Google (demo mode grants admin access), then:

```sh
cd backend && source .venv/bin/activate
make seed-demo PRESENTER=you@example.com   # or Settings → Development & Testing → Load demo data
```

The seed creates a Corporate team, the *Meridian Capital — Share Purchase* matter, three synthetic PDFs (uploaded through the normal pipeline, so R2, the worker and OpenAI embeddings must be configured), Knowledge Bank entries, Workboard tickets, two review rounds (one already returned with Sarah's comments), and memories. Re-running resets previous demo data and never touches your own.

With demo mode on, admins get a **Switch user** picker in the sidebar to act as Sarah Chen (senior associate), Jane Pereira (associate) or Marcus Webb without Google. Switching works only into seeded `dummy:` users, never real accounts, and a banner shows who you are acting as. See `docs/demo-script.md` for the full walkthrough.

| Route | Auth | Behaviour |
|---|---|---|
| `GET /demo/users` | admin + `DEMO_MODE` | seeded users you can switch into |
| `POST /demo/switch` | admin + `DEMO_MODE` | 12-hour token for a seeded user (web Settings → View as, and the extension's header picker) |
| `POST /demo/seed` | admin + `DEMO_MODE` | (re)load demo data |
| `PUT /demo/role` | any real signed-in user + `DEMO_MODE` | mimic a role (`admin`, `partner`, `senior_associate`, `associate`) on your own account; 404 for seeded `dummy:` users |

In demo mode **every user who signs in with Google is an admin**, and the `ADMIN_EMAILS` sync is switched off so a mimicked role sticks until the next sign-in (which makes you an admin again). Pick a role under Settings → Professional role → **View as**; choosing Administrator switches back. Mimicking a role also updates your team and matter membership roles. Seeded `dummy:` users keep the roles the demo script gives them.

The first three routes return 404 unless demo mode is on and the caller is an admin; `PUT /demo/role` returns 404 unless demo mode is on.

---

## Roles & Permissions

| Role | Manage any firm-wide entry | Create matters | Create actions |
|---|---|---|---|
| `admin` (firm IT/ops) | ✅ | ✅ | ✅ |
| `partner` | ✅ | ✅ | ✅ |
| `senior_associate` | — | ✅ | ✅ |
| `associate` | — | ✅ | — |

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
- `GET|PATCH /kb/entries/{id}/metadata` reads or edits a manual note's tags and summary (`{tags?, summary?}`). Read and write follow the entry's Knowledge Bank access; document-backed entries return `409` and use the document route below.
- `POST /kb/backfill-note-metadata?limit=10` and `POST /kb/backfill-document-metadata?limit=10` tag existing notes and documents that have none (admin only; `403` otherwise).
- `GET /resources/metadata` returns cross-resource metadata using the same owner/team/matter/firm-wide visibility rules.

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
       │   Concatenates all chunk text (up to 150K chars)
       │   Calls the owner's OpenRouter model to reformat (no summarising)
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

Retry: clicking "Retry" on a failed KB entry resets it to `processing`; the
embedded worker claims it from the durable Postgres queue.

### ReAct Agent Loop
LexChat (`POST /chat/stream`, JWT required with matter-access checks) exposes `search_elitigation` alongside its internal retrieval tools. It searches public Singapore judgments with a short legal-topic phrase, supports newest-first decision-date sorting and an optional decision year, and returns numbered sources with dates, excerpts and full-judgment links. Lookups are audited as `case_search`. Failed searches are reported as unavailable, separately from empty results; missing excerpts do not support inferred holdings. Only the search phrase goes to eLitigation; prompts and retrieved judgment excerpts go to OpenRouter and the user's chosen model provider. The non-streaming `/chat` endpoint retains its internal retrieval flow.

1. **Build context** — `prepare_agent_context` injects memories + thread summary into the system prompt (NOT KB/docs — those come via tools).
2. **Stream** — `provider.stream_with_tools` yields `token` and `tool_calls` events.
3. **Execute** — each tool returns `(result_text, summary)`. RBAC and audit logging applied at the tool layer.
4. **Cycle guard** — if a round's tool calls repeat a previous fingerprint, inject a "stop repeating" system message and short-circuit to the final answer.
5. **Max rounds** — round MAX+1 disables tools entirely to force a text answer.

### Birdie — Stateless Mentor Agent
- `/birdie/stream` is an endpoint distinct from `/chat/stream`. Client manages history.
- System prompt: a legal drafting assistant (accuracy rules, partner-ready register, no AI-style padding, "Notes for reviewer" output), followed by the eLitigation case-law rule.
- Reuses `search_kb_for_chat` so KB scope filtering still applies.
- `birdie_workboard_service.py` exposes the same validated backend tool surface to the web panel and Chrome extension through `POST /birdie/stream`: `list_workboard_tickets`, `get_workboard_ticket`, `get_workboard_progress`, `create_workboard_ticket`, `update_workboard_ticket`, `delete_workboard_ticket`, and `find_workboard_assignees`. No client-supplied acting user is accepted.
- New tickets are assigned to the caller, including associates. Existing tickets require current assignment and matter access on each call, with no assigner/admin ownership bypass. Updates/deletes acquire a ticket row lock. Reassignment validates the colleague and their matter access, then revokes the caller’s ownership. Board HTTP permissions are unchanged.
- Lists/progress default to the current matter; no matter means General. An explicit across-matters request uses `scope=all`, still filtered by ownership and matter access. The extension has no selected matter by default. Lists return at most 50 tickets with `total`/`truncated`; progress counts cover all matching rows, including completed tickets. Progress reflects recorded status, not inferred completion.
- `birdie_document_service.py` adds `find_documents` (metadata search, current matter by default) and `read_document` (relevant passages, or the start of the document, capped at about 6,000 characters). Both use the caller's own access; a missing and an inaccessible document give the same answer. Document text is treated as untrusted content.
- The direct tool loop allows four rounds plus a final answer, at most eight executions per round, and caches identical mutations within a turn to prevent duplicate changes. The selected OpenRouter model must support tool calling. Workboard data sent to the model uses the caller’s own key.
- The stream retains `token`/`done`/`error` and adds `tool_call` (step ID/tool), `tool_result` (success/changed/summary), and `workboard_changed` (tool/ticket ID) events. Mutation events are emitted immediately after commit, before the final answer. The web panel refreshes Workboard queries; extension clients can use the optional `onWorkboardChange` callback. A later stream error does not undo changes already committed.
- The LLM is chosen per user by `llm_service.get_llm`: their OpenRouter key, else `DEMO_OPENROUTER_KEY` when `DEMO_MODE=true`, else `409 Add your OpenRouter key in Settings`. A rejected key surfaces an error pointing to Settings. `POST /birdie/stream` and `POST /chat[/stream]` accept optional `tier` (`high`|`mid`) and `model` (any OpenRouter id).

| Route | Auth | Behaviour |
|---|---|---|
| `POST /birdie/stream` | signed-in user; matter access if selected | shared web/extension streaming assistant with own-assigned-ticket Workboard tools; history accepts only user/assistant messages |
| `GET /birdie/lessons` | signed-in user | reviewer feedback on rounds the user submitted (returned/completed), with stored lessons |
| `POST /birdie/lessons/{handoff_id}/distill` | signed-in submitter of that round | idempotent; returns stored lessons or distils them once. 404 for anyone else |
| `POST /birdie/reviews` | signed-in user (matter access if `matter_id`) | review a draft shared from the extension; runs in the background on the caller's OpenRouter key, 409 without a key; returns `202` with the review |
| `GET /birdie/reviews?url=` / `GET /birdie/reviews/{id}` | owner only | the review with its suggestions (`replace`/`insert`/`comment`, each with anchor offsets, reason, category, source) and `current_text` with accepted edits applied |
| `PATCH /birdie/suggestions/{id}` | owner only | accept, reject or reset a suggestion; logged to the retrieval audit |
| `DELETE /birdie/reviews?url=` | owner only | reset: deletes the caller's own reviews of that page (extension **Reset**) |
| `POST /birdie/reviews/{id}/accept-style` | owner only | bulk accept mechanical `style` replacements only; substance is never bulk-accepted |
| `POST /birdie/suggestions/{id}/replies` | owner only | reply on a suggestion |
| `GET /settings/llm` | signed-in user | `{has_key, key_last4, key_source, custom_models, models, feature_tiers, features}`; never the key |
| `PUT /settings/llm` | signed-in user | save `openrouter_api_key`, `model_high`, `model_mid` and/or `feature_tiers` (422 on unknown feature or tier) |
| `DELETE /settings/llm/openrouter-key` | signed-in user | remove the key |
| `GET /settings/llm/models` | signed-in user | OpenRouter model catalogue for the pickers |
| `POST /precedent/search` | signed-in user | classify the highlighted clause and return the firm's past versions from the user's own/matter documents and clean or redacted KB entries, with source, matter ref, date, author and draft/executed status; logged to `retrieval_audit_events` |

`POST /birdie/stream` may first emit `event: sources` with `{"cases": [{citation, title, decision_date, url}]}`. Birdie only cites judgments from eLitigation (https://www.elitigation.sg): it searches eLitigation with a short phrase (no document or client text is sent there) and appends a warning if its answer contains a neutral citation that was not in the results. Each lookup is logged to `retrieval_audit_events`.

---

## Post-Deploy Checklist

For a Railway deployment:

Railway frontend service settings:

```txt
Root directory: frontend
Build command: bun run build
Static output directory: dist
BUN_VERSION: 1.3.11
VITE_API_URL: https://<backend-service>.up.railway.app
VITE_GOOGLE_CLIENT_ID: <Google OAuth web client ID>
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
| `o1d2e3f4a5b6` | Adds durable Dream claim fields and stores automated memory justifications | No |
| `p1e2f3a4b5c6` | Adds document comments | No |
| `q2f3a4b5c6d7` | Adds review handoffs, structured findings, and active handoff links on actions | No |
| `r3a4b5c6d7e8` | Adds durable review-handoff worker claim fields | No |
| `u6d7e8f9a0b1` | Adds explicit reverse scoring for positively worded survey questions | No |
| `a7b8c9d0e1f2` | Drops `survey_responses` and `survey_questions` (wellbeing questionnaire removed); downgrade recreates empty tables | Yes, deletes all survey responses |

`h5c6d7e8f9a0` intentionally removes historical read/share/redaction audit rows.
Knowledge and document records are unaffected.

Authenticated document review routes:

- `PATCH /documents/{id}` renames and/or moves an uploaded document (`{filename?, matter_id?}`; `matter_id: null` moves it to General); uploader only, and the target matter must be one the caller belongs to.
- `GET /document-folders?matter_id=<id|general>` lists folders in a matter (members only) or the caller's own General folders. `POST /document-folders` (`{name, matter_id?}`), `PATCH /document-folders/{id}` (`{name}`) and `DELETE /document-folders/{id}` manage them; creator or partner/admin only. Deleting a folder moves its documents back to the matter root.
- `POST /documents/upload` also accepts optional `matter_id` and `folder_id` form fields; `PATCH /documents/{id}` accepts `folder_id` (`null` = matter root).
- `DELETE /matters/{id}` hard-deletes a matter (partner/admin). Its chats and documents move to General; matter-scoped Knowledge Bank entries become private.
- `POST /chat/stream` also emits a `sources` event (numbered `{n, kind, id, title, locator, matter_id}`) as the agent consults documents and Knowledge Bank entries; the answer cites them as `[n]` and the list is stored on the assistant message (`sources`).
- `GET /chat/threads?matter_id=<id|general>` lists the caller's threads for one matter (members only) or for General; omit it for all threads.
- `PATCH /chat/threads/{id}` renames and/or moves a thread (`{title?, matter_id?}`; `matter_id: null` moves it to General); owner only.
- `GET /documents/{id}/file` serves the original file inline. It accepts the normal Bearer header or the JWT `token` query parameter used by the PDF iframe.
- `GET|POST /documents/{id}/comments` lists or creates comments for the uploader or a member of the document's matter.
- `GET|PATCH /documents/{id}/metadata` reads or edits a document's tags, summary, type, status and execution date. Allowed for the uploader or a member of the document's matter; anyone else gets `404`. `PATCH` returns `422` for an unknown type or status.
- `GET /documents/metadata/search?q=&tags=&document_type=&matter_id=&limit=` finds documents by metadata (tags are an AND filter; `q` ranks by embedding similarity). `GET /documents/metadata/tags?matter_id=` lists tags in use. Both only return documents the caller can access.
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
7. The bottom-right Birdie button opens the panel on every signed-in page. Test header dragging, corner resizing, copy/paste, and closing with either the X or the button. Ask for current-matter progress, rename/move your ticket, then reassign it and verify Birdie can no longer edit it. Repeat a Workboard request in the extension.
8. In demo mode, Settings → View as lets you mimic roles; KB write buttons should hide/show accordingly. Outside demo mode, role changes require admin access.

---

## License
Proprietary — Internal hackathon project.

The extension retains the demo presenter session separately while viewing seeded users, so **View as** can switch repeatedly without giving those users admin rights. Sign out clears both sessions. Accepting draft-review suggestions changes Birdie’s copy only: use **Copy accepted text**, then paste into Google Docs.
