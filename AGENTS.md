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

- Frontend: React + Vite + TypeScript + Tailwind
- Backend: FastAPI + Python
- Local database: Postgres through Docker Compose
- Production database: Postgres, with pgvector when embeddings are implemented
- Auth: backend-owned email/password auth
- Deployment targets: frontend on Cloudflare Pages or Vercel, backend on Railway

Do not introduce Better Auth into the FastAPI backend.

Do not start with MCP, LangGraph, Celery, or a complex agent runtime. Build direct Python services first. Add orchestration only after the upload, retrieval, chat, and memory loop works.

## Current Repo Shape

```txt
backend/
  app/main.py
  requirements.txt
  Makefile

frontend/
  src/App.tsx
  src/App.css
  package.json
  bun.lock
```

The current frontend is a static prototype. The current backend exposes health/config endpoints plus DeepSeek-backed chat routes persisted to Postgres.

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

## Implementation Priorities

Build in this order:

1. Database connection and models
2. DeepSeek chat endpoint with persisted chat threads
3. Auth routes and session hydration
4. Document upload
5. Text extraction for PDF and DOCX
6. Chunking and embeddings
7. RAG search
8. Memory CRUD and retrieval
9. Admin insights
10. Deployment wiring

Do not spend early time on an admin dashboard, provider switching UI, or generalized agent abstractions.

## Backend Structure

Prefer small service modules:

```txt
app/services/auth_service.py
app/services/document_service.py
app/services/ingestion_service.py
app/services/embedding_service.py
app/services/rag_service.py
app/services/memory_service.py
app/services/chat_service.py
app/services/insight_service.py
app/providers/llm_provider.py
app/providers/embedding_provider.py
```

Keep route handlers thin. Put business logic in services.

Design service functions so they could become tools later:

```py
search_documents(...)
search_memories(...)
save_memory(...)
suggest_shared_memory(...)
generate_insights(...)
```

Do not add a tool registry unless it removes real duplication.

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

Default to `deepseek-v4-pro` for the demo because the user asked to prioritize the slower, more capable DeepSeek V4 Pro model. Surface model choice in the chat navbar so users can switch each prompt between `deepseek-v4-pro` for deeper legal reasoning and `deepseek-v4-flash` for faster, lower-cost responses.

Keep the provider interface minimal:

```py
generate_chat_response(messages, *, temperature=0.2)
embed_texts(texts)
```

## Frontend Guidance

This is an operational legal workspace, not a marketing site.

Use dense, readable UI for repeated work:

- chat as the primary workflow
- document status visible
- citations and source references visible
- memory review explicit
- admin insights secondary

Do not overbuild custom interaction patterns. Use standard controls and accessible forms.

## Documentation Rules

Keep README setup commands current whenever dependencies, ports, env vars, or run commands change.

If a new backend route is added, document the route and expected authentication behavior.

If the LLM or embedding provider changes, update both `README.md` and this file.
