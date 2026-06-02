import json

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_or_create_user, verify_google_token
from app.config import get_settings
from app.database import create_db_tables, get_db
from app.dependencies import get_current_user
from app.models import User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider, SUPPORTED_CHAT_MODELS
from app.providers.embedding_provider import EmbeddingError
from app.schemas import (
    ChatMessageResponse,
    ChatRequest,
    ChatResponse,
    ChatThreadResponse,
    DocumentResponse,
    MemoryCreate,
    MemoryResponse,
    MemoryUpdate,
    WikiGraphEdge,
    WikiGraphNode,
    WikiGraphResponse,
    WikiIngestRequest,
    WikiPageCreate,
    WikiPageResponse,
    WikiPageSourceResponse,
    WikiPageUpdate,
    WikiUserResponse,
)
from app.services.chat_service import (
    create_chat_request,
    create_chat_response,
    list_thread_messages,
    list_threads,
    save_assistant_response,
)
from app.services.document_service import (
    delete_user_document,
    get_user_document,
    ingest_uploaded_document,
    list_user_documents,
)
from app.services.ingestion_service import UnsupportedDocumentError
from app.services.memory_service import (
    create_memory,
    delete_memory,
    list_memories,
    update_memory,
)
from app.services.wiki_service import (
    WikiForbiddenError,
    WikiIngestionError,
    archive_wiki_page,
    build_wiki_graph,
    create_wiki_page,
    get_wiki_page,
    ingest_document_to_wiki,
    list_wiki_page_sources,
    list_wiki_pages,
    publish_wiki_page,
    update_wiki_page,
)

app = FastAPI(title="LexCatalyst API")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    settings = get_settings()
    if not settings.auto_create_tables:
        return

    try:
        create_db_tables()
    except SQLAlchemyError as exc:
        print(f"Database startup skipped: {exc}")


class GoogleAuthRequest(BaseModel):
    credential: str


@app.post("/auth/google")
async def auth_google(request: GoogleAuthRequest, db: Session = Depends(get_db)):
    try:
        # 1. Verify Google Token
        google_info = verify_google_token(request.credential)

        # 2. Get or Create User
        user = get_or_create_user(db, google_info)

        # 3. Create Local JWT
        access_token = create_access_token(data={"sub": user.id})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
            },
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/config")
def config() -> dict[str, object]:
    settings = get_settings()
    return {
        "deepseek_model": settings.deepseek_model,
        "deepseek_base_url": settings.deepseek_base_url,
        "available_chat_models": list(SUPPORTED_CHAT_MODELS),
    }


def build_document_response(
    document,
    chunk_count: int,
) -> DocumentResponse:
    return DocumentResponse(
        id=document.id,
        filename=document.filename,
        content_type=document.content_type,
        status=document.status,
        error_message=document.error_message,
        created_at=document.created_at,
        updated_at=document.updated_at,
        chunk_count=chunk_count,
    )


def build_wiki_user_response(user) -> WikiUserResponse | None:
    if not user:
        return None
    return WikiUserResponse(id=user.id, full_name=user.full_name, email=user.email)


def build_wiki_page_response(page) -> WikiPageResponse:
    return WikiPageResponse(
        id=page.id,
        owner_user_id=page.owner_user_id,
        author_user_id=page.author_user_id,
        latest_editor_user_id=page.latest_editor_user_id,
        title=page.title,
        slug=page.slug,
        body_markdown=page.body_markdown,
        excerpt=page.excerpt,
        page_type=page.page_type,
        status=page.status,
        created_by=page.created_by,
        source_document_id=page.source_document_id,
        version=page.version,
        published_at=page.published_at,
        created_at=page.created_at,
        updated_at=page.updated_at,
        author=build_wiki_user_response(getattr(page, "author", None)),
        latest_editor=build_wiki_user_response(getattr(page, "latest_editor", None)),
    )


def build_wiki_source_response(source) -> WikiPageSourceResponse:
    snippet = None
    if source.chunk:
        snippet = source.chunk.text[:800]
    return WikiPageSourceResponse(
        id=source.id,
        page_id=source.page_id,
        document_id=source.document_id,
        chunk_id=source.chunk_id,
        memory_id=source.memory_id,
        chat_message_id=source.chat_message_id,
        citation_label=source.citation_label,
        relevance_note=source.relevance_note,
        snippet=snippet,
        created_at=source.created_at,
    )


@app.post(
    "/documents/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentResponse:
    filename = file.filename or "document"
    content_type = file.content_type or "application/octet-stream"

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded file is too large")

        document = await ingest_uploaded_document(
            db,
            user_id=current_user.id,
            filename=filename,
            content_type=content_type,
            file_bytes=file_bytes,
        )
        document_with_count = get_user_document(db, current_user.id, document.id)
        chunk_count = document_with_count[1] if document_with_count else 0
        return build_document_response(document, chunk_count)
    except UnsupportedDocumentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc


@app.get("/documents", response_model=list[DocumentResponse])
def documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentResponse]:
    try:
        return [
            build_document_response(document, chunk_count)
            for document, chunk_count in list_user_documents(db, current_user.id)
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc


@app.get("/documents/{document_id}", response_model=DocumentResponse)
def document_detail(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentResponse:
    try:
        document_with_count = get_user_document(db, current_user.id, document_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc

    if not document_with_count:
        raise HTTPException(status_code=404, detail="Document not found")
    document, chunk_count = document_with_count
    return build_document_response(document, chunk_count)


@app.delete("/documents/{document_id}")
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        success = delete_user_document(db, current_user.id, document_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc

    if not success:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "ok"}


@app.get("/wiki/pages", response_model=list[WikiPageResponse])
def wiki_pages(
    status: str | None = None,
    page_type: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WikiPageResponse]:
    try:
        pages = list_wiki_pages(
            db,
            user_id=current_user.id,
            status=status,
            page_type=page_type,
        )
        return [build_wiki_page_response(page) for page in pages]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc


@app.post("/wiki/pages", response_model=WikiPageResponse, status_code=status.HTTP_201_CREATED)
def create_wiki_page_endpoint(
    schema: WikiPageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = create_wiki_page(db, user_id=current_user.id, schema=schema)
        return build_wiki_page_response(page)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc


@app.get("/wiki/pages/{page_id}", response_model=WikiPageResponse)
def wiki_page_detail(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = get_wiki_page(db, user_id=current_user.id, page_id=page_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    if not page:
        raise HTTPException(status_code=404, detail="Wiki page not found")
    return build_wiki_page_response(page)


@app.patch("/wiki/pages/{page_id}", response_model=WikiPageResponse)
def patch_wiki_page(
    page_id: str,
    schema: WikiPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = update_wiki_page(db, user_id=current_user.id, page_id=page_id, schema=schema)
    except WikiForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    if not page:
        raise HTTPException(status_code=404, detail="Wiki page not found")
    return build_wiki_page_response(page)


@app.delete("/wiki/pages/{page_id}")
def delete_wiki_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        success = archive_wiki_page(db, user_id=current_user.id, page_id=page_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    if not success:
        raise HTTPException(status_code=404, detail="Wiki page not found")
    return {"status": "ok"}


@app.post("/wiki/pages/{page_id}/publish", response_model=WikiPageResponse)
def publish_wiki_page_endpoint(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = publish_wiki_page(db, user_id=current_user.id, page_id=page_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    if not page:
        raise HTTPException(status_code=404, detail="Wiki page not found")
    return build_wiki_page_response(page)


@app.post("/wiki/ingest/document/{document_id}", response_model=WikiPageResponse)
async def ingest_document_wiki_page(
    document_id: str,
    request: WikiIngestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = await ingest_document_to_wiki(
            db,
            user=current_user,
            document_id=document_id,
            request=request,
        )
        return build_wiki_page_response(page)
    except WikiIngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc


@app.get("/wiki/pages/{page_id}/sources", response_model=list[WikiPageSourceResponse])
def wiki_page_sources(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WikiPageSourceResponse]:
    try:
        page = get_wiki_page(db, user_id=current_user.id, page_id=page_id)
        if not page:
            raise HTTPException(status_code=404, detail="Wiki page not found")
        sources = list_wiki_page_sources(db, user_id=current_user.id, page_id=page_id)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    return [build_wiki_source_response(source) for source in sources]


@app.get("/wiki/graph", response_model=WikiGraphResponse)
def wiki_graph(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiGraphResponse:
    try:
        graph = build_wiki_graph(db, user_id=current_user.id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    return WikiGraphResponse(
        nodes=[WikiGraphNode(**node) for node in graph["nodes"]],
        edges=[WikiGraphEdge(**edge) for edge in graph["edges"]],
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatResponse:
    try:
        thread, assistant_message = await create_chat_response(
            db,
            user_message=request.message,
            user_id=current_user.id,
            thread_id=request.thread_id,
            model=request.model,
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except EmbeddingError as exc:
        raise HTTPException(status_code=502, detail=f"Document search is unavailable: {exc}") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc

    return ChatResponse(
        thread_id=thread.id,
        message=ChatMessageResponse.model_validate(assistant_message),
        model=assistant_message.model or get_settings().deepseek_model,
    )


@app.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    def event(name: str, payload: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    async def stream():
        try:
            thread, provider_messages, selected_model = await create_chat_request(
                db,
                user_message=request.message,
                user_id=current_user.id,
                thread_id=request.thread_id,
                model=request.model,
            )
            yield event("thread", {"thread_id": thread.id, "title": thread.title})

            provider = DeepSeekProvider()
            chunks: list[str] = []
            async for chunk in provider.stream_chat(provider_messages, model=selected_model):
                chunks.append(chunk)
                yield event("token", {"content": chunk})

            assistant_content = "".join(chunks).strip()
            if not assistant_content:
                yield event("error", {"detail": "DeepSeek returned an empty response"})
                return

            assistant_message = await save_assistant_response(
                db,
                user_id=current_user.id,
                thread=thread,
                content=assistant_content,
                user_message=request.message,
                model=selected_model,
            )
            yield event(
                "done",
                {
                    "thread_id": thread.id,
                    "message": ChatMessageResponse.model_validate(assistant_message).model_dump(
                        mode="json"
                    ),
                    "model": assistant_message.model or selected_model,
                },
            )
        except DeepSeekError as exc:
            yield event("error", {"detail": str(exc)})
        except EmbeddingError as exc:
            yield event("error", {"detail": f"Document search is unavailable: {exc}"})
        except SQLAlchemyError:
            yield event("error", {"detail": "Chat database is unavailable"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/chat/threads", response_model=list[ChatThreadResponse])
def chat_threads(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[ChatThreadResponse]:
    try:
        return [
            ChatThreadResponse.model_validate(thread)
            for thread in list_threads(db, current_user.id)
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc


@app.get("/chat/threads/{thread_id}/messages", response_model=list[ChatMessageResponse])
def chat_messages(
    thread_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessageResponse]:
    try:
        messages = list_thread_messages(db, thread_id, current_user.id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc

    if not messages:
        raise HTTPException(status_code=404, detail="Chat thread not found")

    return [ChatMessageResponse.model_validate(message) for message in messages]


# Memory Endpoints


@app.get("/memories", response_model=list[MemoryResponse])
def get_memories(
    category: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MemoryResponse]:
    try:
        memories = list_memories(db, user_id=current_user.id, category=category)
        return [MemoryResponse.model_validate(m) for m in memories]
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.post("/memories", response_model=MemoryResponse)
def post_memory(
    schema: MemoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemoryResponse:
    try:
        memory = create_memory(db, user_id=current_user.id, schema=schema)
        return MemoryResponse.model_validate(memory)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.patch("/memories/{memory_id}", response_model=MemoryResponse)
def patch_memory(
    memory_id: str,
    schema: MemoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemoryResponse:
    try:
        memory = update_memory(db, user_id=current_user.id, memory_id=memory_id, schema=schema)
        if not memory:
            raise HTTPException(status_code=404, detail="Memory not found")
        return MemoryResponse.model_validate(memory)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.delete("/memories/{memory_id}")
def delete_memory_endpoint(
    memory_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        success = delete_memory(db, user_id=current_user.id, memory_id=memory_id)
        if not success:
            raise HTTPException(status_code=404, detail="Memory not found")
        return {"status": "ok"}
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")
