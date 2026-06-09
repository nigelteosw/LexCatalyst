# LexCatalyst

LexCatalyst is a hackathon-oriented legal assistant for junior lawyers. The core demo path is simple: upload a legal document, extract and index its text, chat over the matter materials, save useful review memory, and surface one or two admin insights about repeated questions or missing playbooks.

The project intentionally uses a boring Python-first stack so the team can spend time on the legal workflow instead of infrastructure.

## Product Scope

The MVP should prove this flow:

1. A user signs up or logs in.
2. The user uploads a PDF or DOCX for a matter.
3. The backend extracts text, chunks it, embeds it, and marks the document ready.
4. The user asks a matter-specific legal review question.
5. The chat endpoint retrieves relevant document chunks, memories, and scoped Knowledge Bank entries.
6. The answer includes document references or citations.
7. The system suggests a useful personal or matter memory.
8. The admin view shows one aggregated insight, such as repeated junior questions.

Keep the demo narrow. Do not start with a broad admin dashboard or complex agent framework.

## Stack

### Frontend

- React
- Vite
- TypeScript
- Tailwind CSS

Planned UI additions:

- shadcn/ui
- lucide-react
- TanStack Router
- TanStack Query
- zod
- react-hook-form

Suggested routes:

- `/login`
- `/signup`
- `/workspace`
- `/chat`
- `/documents`
- `/knowledge-bank`
- `/memories`
- `/admin`

### Backend

- FastAPI
- Python
- Uvicorn
- SQLAlchemy
- Postgres
- DeepSeek via the OpenAI-compatible SDK

Planned backend additions:

- Alembic
- passlib[argon2]
- PyJWT or python-jose
- httpx
- pypdf
- python-docx

The demo LLM provider is DeepSeek behind a provider abstraction. The default model is `deepseek-v4-pro` because the demo benefits from stronger legal reasoning. The chat navbar lets users switch each prompt between `deepseek-v4-pro` for deeper legal reasoning and `deepseek-v4-flash` for faster, lower-cost responses.

### Data

Use local Postgres through Docker Compose with pgvector enabled for document embeddings.

Core tables to add:

- `users`
- `workspaces`
- `workspace_members`
- `matters`
- `teams`
- `team_members`
- `matter_members`
- `documents`
- `document_chunks`
- `kb_entries`
- `kb_access_log`
- `pii_redactions`
- `memories`
- `chat_threads`
- `chat_messages`
- `agent_traces`
- `insights`

Do not store uploaded PDFs or DOCX files directly in Postgres. Use local disk or a Railway volume for the demo, and Cloudflare R2 if object storage is needed.

## Repo Layout

```txt
.
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── Makefile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── package.json
│   └── bun.lock
├── AGENTS.md
├── plan.md
└── README.md
```

## Local Setup

### Local Database

Run Postgres locally with Docker Compose:

```sh
cp backend/.env.example backend/.env
# Fill DEEPSEEK_API_KEY, OPENAI_API_KEY, and R2 credentials in backend/.env
docker compose up -d
```

Services:

```txt
Postgres: 127.0.0.1:5432
```

Stop the stack:

```sh
docker compose down
```

Delete the local Postgres volume and all local database data:

```sh
docker compose down -v
```

### Backend

The backend runs locally from the Python virtual environment and connects to Docker Postgres through `127.0.0.1:5432`.

Start Postgres first:

```sh
docker compose up -d
```

Then run the backend:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
make install
make migrate
make dev
```

On a server, run `make migrate` or `.venv/bin/alembic upgrade head` as a release/startup step before starting Uvicorn. Alembic is the deploy migration path. The backend only runs `create_all()` on startup when `AUTO_CREATE_TABLES=true`, which should stay disabled in Railway.

The backend runs on:

```txt
http://127.0.0.1:8000
```

Health check:

```txt
GET /health
```

### Frontend

The frontend is its own local Vite app:

```sh
cd frontend
cp .env.example .env
bun install
bun run dev
```

Vite will print the local frontend URL. By default the frontend calls `http://127.0.0.1:8000`; override it with `VITE_API_URL` in `frontend/.env`.

## Environment

Create `backend/.env` for backend-only secrets.

Expected variables:

```txt
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst
AUTO_CREATE_TABLES=false

DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TEMPERATURE=0.2

OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536

CLOUDFLARE_R2_BUCKET_NAME=lexcatalyst
CLOUDFLARE_R2_ENDPOINT_URL=https://aa1656cdf4783d312f507847447334cb.r2.cloudflarestorage.com
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
```

Only use synthetic or non-confidential documents for demos unless everyone understands which external model providers receive document text.

## Backend Route Plan

```txt
POST /auth/signup
POST /auth/login
POST /auth/logout
GET  /auth/me

POST /documents/upload
GET  /documents
GET  /documents/{document_id}

GET  /teams
GET  /matters
POST /matters
GET  /matters/{matter_id}
PATCH /matters/{matter_id}
GET  /matters/{matter_id}/members
POST /matters/{matter_id}/members
DELETE /matters/{matter_id}/members/{user_id}

GET    /kb/entries
POST   /kb/entries
POST   /kb/ingest/document/{document_id}
GET    /kb/entries/{entry_id}
GET    /kb/entries/{entry_id}/sources
PATCH  /kb/entries/{entry_id}
DELETE /kb/entries/{entry_id}
POST   /kb/entries/{entry_id}/promote
GET    /kb/entries/{entry_id}/redaction
POST   /kb/entries/{entry_id}/approve-redaction
GET    /audit-log

POST /chat
POST /chat/stream
GET  /chat/threads
GET  /chat/threads/{thread_id}/messages

POST /memories
GET  /memories/search
POST /memories/{memory_id}/promote

GET  /admin/insights
```

`POST /chat` and `POST /chat/stream` accept an optional `model` value:

```txt
deepseek-v4-pro
deepseek-v4-flash
```

`POST /chat` and `POST /chat/stream` also accept an optional `matter_id`. When provided,
document retrieval and Knowledge Bank context are restricted to the active matter plus applicable
team, firm-wide, and private entries.

All `/teams`, `/matters`, `/kb/*`, and `/audit-log` routes require the authenticated bearer token.
The current hackathon build follows `docs/rfc-knowledge-bank.md` super-user mode: role and scope
metadata are persisted, but all authenticated users can operate across the single demo firm.
Production RBAC enforcement must be enabled before confidential client data is used.

Matter client names and retained original content in redaction records are encrypted at rest using
an application key derived from `JWT_SECRET_KEY`. Changing that secret makes existing encrypted
values unreadable, so production deployments must keep it stable and managed securely.

## Backend Service Plan

Prefer normal Python services before agent orchestration:

```txt
auth_service.py
document_service.py
ingestion_service.py
embedding_service.py
rag_service.py
memory_service.py
chat_service.py
insight_service.py
llm_provider.py
embedding_provider.py
```

Service functions can be shaped like tools without introducing MCP or a full agent framework:

```py
tools = {
    "search_documents": search_documents,
    "search_memories": search_memories,
    "save_memory": save_memory,
    "suggest_shared_memory": suggest_shared_memory,
    "generate_insights": generate_insights,
}
```

## Build Order

1. FastAPI app skeleton
2. Postgres database connection
3. DeepSeek chat endpoint with persisted chat threads
4. User model and auth routes
5. React login/signup flow
6. Document upload endpoint
7. PDF and DOCX text extraction
8. Chunking and embeddings
9. RAG search endpoint
10. Memory suggestion and retrieval
11. Admin insight page
12. Deployment

The main demo is document upload plus useful chat. Build that before polishing secondary screens.
