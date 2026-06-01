# RFC: Semantic Document Ingestion and Vector Search

Status: Implemented  
Date: 2026-06-01  
Owner: LexCatalyst backend

## Summary

LexCatalyst needs document ingestion and semantic search so lawyers can upload PDF or DOCX files, ask questions, and receive answers grounded in the uploaded materials with citations.

The implementation should stay simple for the hackathon demo:

```txt
upload -> store in R2 -> extract text -> chunk -> embed -> vector search -> chat with citations
```

The backend remains FastAPI and Python. Chat generation stays on DeepSeek. Document embeddings use OpenAI. Uploaded source files are stored in Cloudflare R2. Chunk embeddings are stored in Postgres with pgvector.

## Goals

- Support authenticated upload of PDF and DOCX documents.
- Store original uploaded files in Cloudflare R2.
- Extract readable text from uploaded files.
- Split extracted text into citation-friendly chunks.
- Generate embeddings for each chunk with OpenAI.
- Store chunks and embeddings in Postgres with pgvector.
- Retrieve relevant chunks during chat.
- Require chat answers to cite retrieved document chunks.
- Keep access scoped to the current user for the first implementation.

## Non-Goals

- No MCP integration.
- No LangGraph or agent runtime.
- No Celery or distributed job queue.
- No admin dashboard work in this RFC.
- No cross-user, workspace, or matter-level sharing in the first pass.
- No complex legal clause parser before basic ingestion and search work.

## Current State

The backend already has:

- FastAPI app setup.
- Postgres connection through SQLAlchemy.
- Google-authenticated users.
- DeepSeek-backed chat routes.
- Chat thread and message persistence.
- Memory CRUD and automatic memory extraction.
- R2 and OpenAI environment placeholders in `backend/.env.example`.

The backend does not yet have:

- Document models.
- Upload routes.
- R2 upload service.
- PDF or DOCX extraction.
- Chunking.
- Embedding generation.
- pgvector-backed semantic search.
- Document citations in chat.

## Proposed Architecture

```txt
FastAPI
  |
  |-- /documents/upload
  |     |
  |     |-- storage_service.upload_to_r2(...)
  |     |-- ingestion_service.extract_text(...)
  |     |-- ingestion_service.chunk_text(...)
  |     |-- embedding_provider.embed_texts(...)
  |     `-- document_chunks persisted with embeddings
  |
  `-- /chat or /chat/stream
        |
        |-- rag_service.search_documents(...)
        |-- memory_service.list_memories(...)
        |-- chat_service.build_provider_messages(...)
        `-- DeepSeek response with citations
```

## Configuration

Add or use these backend environment variables:

```txt
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536

CLOUDFLARE_R2_BUCKET_NAME=lexcatalyst
CLOUDFLARE_R2_ENDPOINT_URL=https://aa1656cdf4783d312f507847447334cb.r2.cloudflarestorage.com
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
```

DeepSeek remains the chat provider:

```txt
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TEMPERATURE=0.2
```

## Dependencies

Add backend dependencies:

```txt
boto3
pypdf
python-docx
pgvector
```

The existing `openai` dependency can be reused for embeddings.

## Database Changes

Enable pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Use a pgvector-enabled Postgres image locally, such as:

```yaml
image: pgvector/pgvector:pg17
```

### `documents`

```txt
id
user_id
filename
content_type
storage_key
status
error_message
created_at
updated_at
```

Allowed statuses:

```txt
uploaded
processing
ready
failed
```

### `document_chunks`

```txt
id
document_id
chunk_index
text
embedding
page_number
citation_label
created_at
```

The embedding column should use pgvector with the dimension required by the selected OpenAI embedding model.

## R2 Storage

Create `backend/app/services/storage_service.py`.

Responsibilities:

- Create an S3-compatible R2 client.
- Upload original files.
- Return the object key.
- Keep uploaded legal documents private by default.

Use object keys shaped like:

```txt
users/{user_id}/documents/{document_id}/{safe_filename}
```

The app should store the R2 object key in Postgres, not a public URL.

## Text Extraction

Create `backend/app/services/ingestion_service.py`.

Extraction support:

- PDF: `pypdf`
- DOCX: `python-docx`

The service should return text blocks with best-effort citation metadata:

```py
{
    "text": "...",
    "page_number": 3,
}
```

For DOCX, `page_number` can be `None` because DOCX does not have stable page numbers without rendering.

If extraction fails:

- mark the document as `failed`
- store a short `error_message`
- do not create chunks

## Chunking

Use deterministic chunking first.

Initial targets:

- `3000-5000` characters per chunk
- `300-500` character overlap

Each chunk should include:

- chunk text
- chunk index
- document id
- page number when known
- citation label

Example citation labels:

```txt
filename.pdf p. 3 chunk 2
contract.docx chunk 5
```

## Embeddings

Create `backend/app/providers/embedding_provider.py`.

Provider interface:

```py
async def embed_texts(texts: list[str]) -> list[list[float]]:
    ...
```

Implementation notes:

- Use `OPENAI_API_KEY`.
- Default to `text-embedding-3-small`.
- Batch chunk embedding requests.
- Fail ingestion clearly if embeddings cannot be generated.
- Do not call DeepSeek for embeddings.

## Semantic Search

Create `backend/app/services/rag_service.py`.

Core function:

```py
async def search_documents(
    db,
    *,
    query: str,
    user_id: str,
    limit: int = 6,
) -> list[DocumentSearchResult]:
    ...
```

The service should:

- embed the user query
- search `document_chunks` by vector similarity
- join through `documents`
- filter by `documents.user_id == user_id`
- return chunk text, score, filename, page number, and citation label

For the first pass, user-level filtering is the security boundary. Workspace and matter filters should be added before shared matter retrieval.

## API Routes

Add document routes:

```txt
POST /documents/upload
GET  /documents
GET  /documents/{document_id}
```

### `POST /documents/upload`

Input:

- multipart file
- authenticated current user

Behavior:

1. Create a `documents` row with status `uploaded`.
2. Upload the original file to R2.
3. Mark status `processing`.
4. Extract text.
5. Chunk text.
6. Generate embeddings.
7. Persist chunks.
8. Mark status `ready`.

For the hackathon demo, synchronous processing is acceptable. If it becomes too slow, move ingestion into a FastAPI background task while preserving the same status model.

### `GET /documents`

Return the current user's documents with status and timestamps.

### `GET /documents/{document_id}`

Return one current-user document with status and chunk count.

## Chat Integration

Before calling DeepSeek in `/chat` and `/chat/stream`:

1. Run `search_documents(...)` with the user's message.
2. Fetch existing user memories.
3. Build the provider prompt with both:
   - retrieved document chunks
   - long-term memory context
4. Tell DeepSeek to answer only from supplied document context when citations are needed.
5. Tell DeepSeek not to invent citations.

Prompt context shape:

```txt
Document Context:

[1] filename.pdf p. 3 chunk 2
<chunk text>

[2] filename.pdf p. 4 chunk 3
<chunk text>
```

The answer should cite sources using bracket references:

```txt
The termination right appears to require written notice within 30 days [1].
```

## Security Rules

Every document path must check `current_user.id`.

Required first-pass filters:

- Uploads create documents owned by the current user.
- `GET /documents` returns only current-user documents.
- `GET /documents/{document_id}` checks current-user ownership.
- Semantic search joins through `documents` and filters by current user.
- Chat only receives chunks from current-user documents.

Before workspace or matter sharing is implemented, do not retrieve across users, matters, or workspaces.

## Error Handling

Document ingestion should fail visibly and recoverably.

Examples:

- R2 upload failure: `failed`
- unsupported file type: request rejected
- PDF extraction failure: `failed`
- empty extracted text: `failed`
- OpenAI embedding failure: `failed`
- pgvector insert/search failure: return `503`

Do not mark a document `ready` unless chunks and embeddings were persisted.

## Implementation Order

1. Add config settings.
2. Add dependencies.
3. Switch local Postgres image to pgvector.
4. Add document and chunk models.
5. Ensure pgvector extension is created.
6. Add R2 storage service.
7. Add extraction and chunking service.
8. Add OpenAI embedding provider.
9. Add upload/list/detail document routes.
10. Add semantic search service.
11. Wire search into non-streaming chat.
12. Wire search into streaming chat.
13. Update README setup notes.
14. Verify with one synthetic legal document.

## Verification Plan

Use a synthetic or non-confidential legal document.

Checklist:

- Backend imports cleanly.
- `docker compose up -d` starts pgvector-enabled Postgres.
- `CREATE EXTENSION vector` succeeds.
- `/health` returns `ok`.
- Authenticated user can upload a PDF or DOCX.
- Original file appears in R2.
- Document status reaches `ready`.
- Chunks are stored in Postgres.
- Embeddings are stored for each chunk.
- Chat retrieves relevant chunks.
- Chat answer cites retrieved chunks.
- Another user cannot see or search the document.

## Risks

### pgvector local migration risk

Existing local Docker volumes may use a plain Postgres image without pgvector. Developers may need to recreate the local volume after switching images.

### Synchronous ingestion latency

Embedding large documents during upload can be slow. This is acceptable for a hackathon demo, but the status model should allow background processing later.

### Citation quality

Simple chunks can produce rough citations. The first pass should prioritize reliable source labels over perfect page-level legal citation.

### Provider data exposure

Document chunks are sent to OpenAI for embeddings and to DeepSeek during chat. Demo documents should be synthetic or non-confidential unless the team explicitly accepts that provider exposure.

## Open Questions

- Should the first upload route accept only one file at a time?
- Should document search retrieve across all user documents or only a selected document?
- Should the chat request include a `document_id` filter?
- Should failed ingestion preserve the R2 object or delete it?
- Should citations be returned as structured JSON in addition to answer text?
