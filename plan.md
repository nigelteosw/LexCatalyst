Use a **boring Python-first stack**. For a hackathon, the goal is to ship a working legal assistant, not prove infra complexity.

The team should optimize for:

```txt
easy local setup
simple backend code
Python-native document/RAG tooling
minimal auth
one clear demo path
```

## Recommended Stack

### Frontend

Use:

**React + Vite + TypeScript + Tailwind + shadcn/ui**

Deploy on:

**Cloudflare Pages** or **Vercel**

Why this is still the right frontend:

The UI is a ChatGPT-style workflow with document upload, memory review, and an admin dashboard. React + Tailwind + shadcn/ui is fast to build and easy to demo.

Suggested frontend routes:

```txt
/login
/signup
/workspace
/chat
/documents
/memories
/admin
```

Use these libraries:

```txt
@tanstack/react-router
@tanstack/react-query
shadcn/ui
lucide-react
zod
react-hook-form
```

Keep the chat UI simple. Do not overbuild custom interaction patterns.

---

### Backend

Use:

**FastAPI + Python**

Deploy on:

**Railway**

Why FastAPI:

FastAPI is easier for a less technical team to reason about, and Python is the better fit for the hard parts of this project: PDF parsing, DOCX parsing, embeddings, RAG, summarisation, and agent workflows.

Backend responsibilities:

```txt
Auth
Chat endpoint
Document upload
Document text extraction
Chunking and embeddings
RAG retrieval
Memory CRUD
Admin insights
Background ingestion jobs
```

Basic route structure:

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

Recommended backend libraries:

```txt
fastapi
uvicorn
sqlalchemy
alembic
pydantic
python-multipart
passlib[argon2]
python-jose or PyJWT
httpx
pypdf
python-docx
openai or provider SDK
```

---

### Auth

Do **not** use Better Auth if the backend is FastAPI.

Use simple backend-owned auth:

```txt
email/password signup
password hashing with argon2
JWT or signed HTTP-only session cookie
/auth/me for frontend session hydration
```

For the hackathon, skip email verification unless it is required by the judging criteria.

If you need a slightly more realistic flow:

```txt
signup creates user
login returns session cookie
frontend calls /auth/me on app load
logout clears cookie
protected API routes require current user
```

Important:

Auth must include workspace and matter access checks before document search or shared memory retrieval. A legal app cannot accidentally retrieve another client or matter's documents.

---

### Database

Use:

**Postgres locally through Docker, Postgres on Railway**

When document embeddings are added, use:

**Postgres + pgvector**

Recommended ORM:

**SQLAlchemy + Alembic**

Core tables:

```txt
users
workspaces
workspace_members
matters
documents
document_chunks
memories
chat_threads
chat_messages
agent_traces
insights
```

Store embeddings in Postgres with `pgvector`.

Use raw SQL for vector similarity search if SQLAlchemy support becomes awkward.

Recommended choice:

```txt
Use Postgres in local dev and production.
Use pgvector when embeddings are implemented.
```

---

### Blob Storage

Use:

**Cloudflare R2** or **Railway volume/local disk for the demo**

Store:

```txt
PDFs
DOCX files
uploaded precedents
extracted text files
generated summaries
```

MVP upload flow:

```txt
User uploads PDF or DOCX
Backend stores original file
Backend creates document row with status = "processing"
Backend extracts text
Backend chunks text
Backend embeds chunks
Backend stores chunks + embeddings
Backend marks document status = "ready"
```

Do not store raw files directly in Postgres.

---

## Background Jobs

Do not make document ingestion fully synchronous.

Use the database-backed worker embedded in the FastAPI service:

```txt
uvicorn app.main:app
```

The upload request stores the original in R2 and creates a durable
`processing` document row. The worker claims jobs with `FOR UPDATE SKIP
LOCKED`, reclaims stale jobs after restarts, and performs extraction, OCR,
chunking, and embedding outside the FastAPI event loop on a managed worker
thread. OCR extraction runs in a killable subprocess so a timeout cannot leave
CPU work running. The same embedded worker processes Knowledge Bank summaries
and Dream jobs. Worker concurrency is deliberately fixed in code for the demo:
two jobs globally and one slot per queue. Run one Uvicorn process for the
Railway backend service.

Document statuses:

```txt
uploaded
processing
ready
failed
```

This matters because PDF parsing, DOCX parsing, and embeddings can fail. The frontend should show document status instead of pretending upload means ready.

---

## Agent Orchestration

Do **not** start with MCP.

Use normal Python services first:

```txt
auth_service.py
document_service.py
ingestion_service.py
embedding_service.py
rag_service.py
memory_service.py
chat_service.py
insight_service.py
```

The chat service can call these directly.

Design service functions to look like tools:

```py
tools = {
    "search_documents": search_documents,
    "search_memories": search_memories,
    "save_memory": save_memory,
    "suggest_shared_memory": suggest_shared_memory,
    "generate_insights": generate_insights,
}
```

That gives you a clean architecture story without spending hackathon time on MCP plumbing.

---

## Model

Use a provider abstraction:

```txt
llm_provider.py
embedding_provider.py
```

Possible providers:

```txt
OpenAI
DeepSeek
Gemini
Anthropic
local Ollama model
```

Recommended demo setup:

```txt
LLM: DeepSeek or OpenAI
Embeddings: OpenAI text-embedding-3-small or a local embedding model
Small extraction model: same provider as main LLM unless cost becomes an issue
```

Important:

Use synthetic or non-confidential documents for the demo. If real legal documents are uploaded, be explicit about which external model providers receive document text.

---

## Suggested Architecture

```txt
Cloudflare Pages / Vercel
   |
   | React frontend
   |
Railway Backend: FastAPI + Python
   |
   |-- Auth
   |-- Chat API
   |-- Document Upload
   |-- Document Parser
   |-- RAG Service
   |-- Memory Service
   |-- Insight Service
   |
Railway Postgres
   |
   |-- users
   |-- workspaces
   |-- matters
   |-- documents
   |-- document_chunks
   |-- memories
   |-- traces
   |
Cloudflare R2 / Railway storage
   |
   |-- uploaded PDFs / DOCX
   |-- extracted raw text
```

---

## What To Build For The Hackathon

Build one tight demo path.

### 1. Login

A user can sign up, log in, and stay logged in.

Keep it simple:

```txt
email
password
name
workspace_id
```

### 2. Upload One Document

User uploads a PDF or DOCX.

The system:

```txt
saves the file
extracts text
chunks text
generates embeddings
marks the document ready
```

### 3. Chat Over That Document

A junior lawyer asks:

> "What should I know before reviewing this shareholder agreement?"

The system:

```txt
retrieves relevant chunks
answers with citations or document references
stores the chat message
```

### 4. Suggest A Memory

After the chat, the system suggests one useful memory:

```txt
Save as personal memory
Suggest as matter memory
Discard
```

### 5. Retrieve That Memory

Another similar question retrieves the saved memory and uses it in the answer.

### 6. Show One Admin Insight

The admin page shows one or two aggregated signals:

```txt
common junior questions
missing playbooks
repeated unclear instructions
```

That is enough to prove the concept.

---

## Build Order

Use this order:

```txt
1. FastAPI app skeleton
2. Postgres connection
3. DeepSeek chat endpoint with persisted chat threads
4. User model and auth routes
5. React login/signup flow
6. Document upload endpoint
7. Text extraction for PDF and DOCX
8. Chunking and embeddings
9. RAG search endpoint
10. Memory suggestion and retrieval
11. Admin insight page
12. Deployment
```

Do not start with the admin dashboard. The main demo is document upload plus useful chat.

---

## Final Recommendation

Use this:

```txt
Frontend: React + Vite + TypeScript + Tailwind + shadcn/ui
Frontend hosting: Cloudflare Pages or Vercel

Backend: FastAPI + Python
Backend hosting: Railway

Database: Postgres locally through Docker, Postgres + pgvector when embeddings are implemented

Blob storage: Railway local volume first, Cloudflare R2 if time allows

Auth: simple FastAPI-owned email/password auth

Agent orchestration: direct Python services first, MCP later

Observability/demo: store traces in Postgres or log them clearly
```

Do not force Better Auth into a Python backend. If the team is more comfortable with Python, use FastAPI and keep auth minimal. Spend the real time on the legal workflow: upload, retrieve, answer, remember, and surface insights.
