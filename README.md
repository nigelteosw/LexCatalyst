# LexCatalyst

LexCatalyst is a hackathon-oriented legal assistant for junior lawyers. The core demo path is simple: upload a legal document, extract and index its text, chat over the matter materials, save useful review memory, and surface one or two admin insights about repeated questions or missing playbooks.

The project intentionally uses a boring Python-first stack so the team can spend time on the legal workflow instead of infrastructure.

## Product Scope

The MVP should prove this flow:

1. A user signs up or logs in.
2. The user uploads a PDF or DOCX for a matter.
3. The backend extracts text, chunks it, embeds it, and marks the document ready.
4. The user asks a matter-specific legal review question.
5. The chat endpoint retrieves relevant document chunks and memories.
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
- `/memories`
- `/admin`

### Backend

- FastAPI
- Python
- Uvicorn

Planned backend additions:

- SQLAlchemy
- Alembic
- passlib[argon2]
- PyJWT or python-jose
- httpx
- pypdf
- python-docx
- OpenAI-compatible LLM provider client

The planned demo LLM provider is DeepSeek or OpenAI behind a provider abstraction.

### Data

Use SQLite for the fastest local demo. Use Postgres with pgvector if the team is ready for a more production-like path.

Core tables to add:

- `users`
- `workspaces`
- `workspace_members`
- `matters`
- `documents`
- `document_chunks`
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

### Backend

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
make install
make dev
```

The backend runs on:

```txt
http://127.0.0.1:8000
```

Health check:

```txt
GET /health
```

### Frontend

```sh
cd frontend
bun install
bun run dev
```

Vite will print the local frontend URL.

## Environment

Create `backend/.env` for backend-only secrets.

Expected variables as the LLM integration is added:

```txt
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
LANGSMITH_API_KEY=...
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=lexcatalyst-local
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

POST /chat

POST /memories
GET  /memories/search
POST /memories/{memory_id}/promote

GET  /admin/insights
```

Every document, memory, and chat lookup must be scoped to the current user, workspace, and matter.

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
2. SQLite database connection
3. User model and auth routes
4. React login/signup flow
5. Document upload endpoint
6. PDF and DOCX text extraction
7. Chunking and embeddings
8. RAG search endpoint
9. Chat endpoint
10. Memory suggestion and retrieval
11. Admin insight page
12. Deployment

The main demo is document upload plus useful chat. Build that before polishing secondary screens.
