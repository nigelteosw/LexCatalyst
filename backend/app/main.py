import json

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_or_create_user, verify_google_token
from app.config import get_settings
from app.database import create_db_tables, get_db
from app.dependencies import (
    can_create_firm_wide,
    get_current_user,
    is_senior_or_above,
    require_kb_read,
    require_kb_write,
    require_partner_or_admin,
)
from app.models import Document, User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider, SUPPORTED_CHAT_MODELS
from app.providers.embedding_provider import EmbeddingError
from app.schemas import (
    ActionItemCreate,
    ActionItemResponse,
    ActionItemUpdate,
    ChatMessageResponse,
    ChatRequest,
    ChatResponse,
    ChatThreadResponse,
    DocumentResponse,
    KnowledgeBankAccessLogResponse,
    KnowledgeBankBackfillResponse,
    KnowledgeBankEntryCreate,
    KnowledgeBankEntryResponse,
    KnowledgeBankEntryUpdate,
    KnowledgeBankPromoteRequest,
    MatterCreate,
    MatterMemberCreate,
    MatterMemberResponse,
    MatterResponse,
    MatterUpdate,
    MemoryCreate,
    MemoryResponse,
    MemoryUpdate,
    RedactionApprovalRequest,
    RedactionProposalResponse,
    SurveyQuestionCreate,
    SurveyQuestionResponse,
    SurveyQuestionUpdate,
    SurveyResponseCreate,
    SurveyResultsResponse,
    TeamResponse,
    UserResponse,
    UserSettingsUpdate,
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
from app.services.agent_service import run_agent_loop
from app.services.chat_service import (
    create_chat_response,
    list_thread_messages,
    list_threads,
    prepare_agent_context,
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
from app.services.kb_ingestion_service import (
    create_pending_kb_entry,
    process_kb_summary,
)
from app.services.knowledge_bank_service import (
    KnowledgeBankError,
    approve_redaction,
    backfill_missing_kb_embeddings,
    build_kb_graph,
    create_kb_entry,
    delete_kb_entry,
    get_kb_entry,
    get_redaction_proposal,
    list_audit_log,
    list_kb_entries,
    log_kb_access,
    promote_kb_entry,
    sync_linked_wiki_page_to_kb,
    update_kb_entry,
)
from app.services.organization_service import (
    add_matter_member,
    create_matter,
    get_matter,
    list_matter_members,
    list_matters,
    list_teams,
    remove_matter_member,
    update_matter,
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
from app.services.user_service import update_user_role
from app.services.birdie_service import stream_birdie_response
from app.services.survey_service import (
    create_survey_question,
    get_survey_results,
    list_survey_questions,
    submit_survey_response,
    update_survey_question,
)
from app.services.action_service import (
    create_action_item,
    delete_action_item,
    get_action_item,
    list_action_items,
    update_action_item,
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
                "firm_role": user.firm_role,
                "is_admin": user.is_admin,
            },
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@app.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@app.patch("/me", response_model=UserResponse)
def update_me(
    schema: UserSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    try:
        user = update_user_role(
            db,
            user=current_user,
            firm_role=schema.firm_role,
        )
        return UserResponse.model_validate(user)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="User settings are unavailable") from exc


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
        matter_id=document.matter_id,
        team_id=document.team_id,
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
    matter_id: str | None = None,
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
        if matter_id:
            matter = get_matter(db, matter_id)
            if not matter:
                raise HTTPException(status_code=404, detail="Matter not found")
            document.matter_id = matter.id
            document.team_id = matter.team_id
            db.commit()
            db.refresh(document)
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
async def patch_wiki_page(
    page_id: str,
    schema: WikiPageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = update_wiki_page(db, user_id=current_user.id, page_id=page_id, schema=schema)
        if page:
            await sync_linked_wiki_page_to_kb(db, user=current_user, page=page)
    except WikiForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
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
            matter_id=request.matter_id,
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
            thread, initial_messages, selected_model = await prepare_agent_context(
                db,
                user_message=request.message,
                user_id=current_user.id,
                thread_id=request.thread_id,
                model=request.model,
                matter_id=request.matter_id,
            )
            yield event("thread", {"thread_id": thread.id, "title": thread.title})

            chunks: list[str] = []
            tool_steps: list[dict] = []
            active_matter_id = request.matter_id or thread.matter_id

            async for event_type, event_data in run_agent_loop(
                initial_messages,
                db,
                user=current_user,
                matter_id=active_matter_id,
                model=selected_model,
            ):
                if event_type == "token":
                    chunks.append(event_data["content"])
                elif event_type == "tool_call":
                    tool_steps.append({
                        "id": event_data["step_id"],
                        "tool": event_data["tool"],
                        "args": event_data["args"],
                        "summary": None,
                        "status": "running",
                    })
                elif event_type == "tool_result":
                    for step in reversed(tool_steps):
                        if step["id"] == event_data["step_id"]:
                            step["summary"] = event_data["summary"]
                            step["status"] = "done"
                            break
                yield event(event_type, event_data)

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
                tool_steps=tool_steps if tool_steps else None,
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
        except Exception as exc:
            print(f"Unexpected chat stream error: {exc!r}")
            yield event("error", {"detail": "An unexpected error occurred"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class BirdieMessage(BaseModel):
    role: str
    content: str


class BirdieRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    history: list[BirdieMessage] = Field(default_factory=list, max_length=40)
    matter_id: str | None = None


@app.post("/birdie/stream")
async def birdie_stream(
    request: BirdieRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    def event(name: str, payload: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    async def stream():
        try:
            chunks: list[str] = []
            async for token in stream_birdie_response(
                db,
                user=current_user,
                user_message=request.message,
                history=[{"role": m.role, "content": m.content} for m in request.history],
                matter_id=request.matter_id,
            ):
                chunks.append(token)
                yield event("token", {"content": token})

            full_response = "".join(chunks).strip()
            if not full_response:
                yield event("error", {"detail": "Birdie returned an empty response"})
                return
            yield event("done", {"content": full_response})
        except DeepSeekError as exc:
            yield event("error", {"detail": str(exc)})
        except Exception as exc:
            print(f"Birdie stream error: {exc!r}")
            yield event("error", {"detail": "An unexpected error occurred"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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


@app.get("/teams", response_model=list[TeamResponse])
def teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TeamResponse]:
    try:
        return [TeamResponse.model_validate(team) for team in list_teams(db, current_user)]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Team database is unavailable") from exc


@app.get("/matters", response_model=list[MatterResponse])
def matters(
    matter_status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MatterResponse]:
    try:
        return [
            MatterResponse.model_validate(matter)
            for matter in list_matters(db, current_user, status=matter_status)
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc


@app.post("/matters", response_model=MatterResponse, status_code=status.HTTP_201_CREATED)
def post_matter(
    schema: MatterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatterResponse:
    try:
        return MatterResponse.model_validate(create_matter(db, current_user, schema))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc


@app.get("/matters/{matter_id}", response_model=MatterResponse)
def matter_detail(
    matter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatterResponse:
    try:
        matter = get_matter(db, matter_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc
    if not matter:
        raise HTTPException(status_code=404, detail="Matter not found")
    return MatterResponse.model_validate(matter)


@app.patch("/matters/{matter_id}", response_model=MatterResponse)
def patch_matter(
    matter_id: str,
    schema: MatterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatterResponse:
    try:
        matter = update_matter(db, matter_id, schema)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc
    if not matter:
        raise HTTPException(status_code=404, detail="Matter not found")
    return MatterResponse.model_validate(matter)


@app.get("/matters/{matter_id}/members", response_model=list[MatterMemberResponse])
def matter_members(
    matter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MatterMemberResponse]:
    if not get_matter(db, matter_id):
        raise HTTPException(status_code=404, detail="Matter not found")
    return [
        MatterMemberResponse.model_validate(member)
        for member in list_matter_members(db, matter_id)
    ]


@app.post(
    "/matters/{matter_id}/members",
    response_model=MatterMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_matter_member(
    matter_id: str,
    schema: MatterMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatterMemberResponse:
    if not get_matter(db, matter_id):
        raise HTTPException(status_code=404, detail="Matter not found")
    return MatterMemberResponse.model_validate(
        add_matter_member(
            db,
            matter_id=matter_id,
            granted_by=current_user.id,
            schema=schema,
        )
    )


@app.delete("/matters/{matter_id}/members/{user_id}")
def delete_matter_member(
    matter_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    if not remove_matter_member(db, matter_id, user_id):
        raise HTTPException(status_code=404, detail="Matter membership not found")
    return {"status": "ok"}


@app.get("/kb/graph", response_model=WikiGraphResponse)
def kb_graph(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> WikiGraphResponse:
    graph = build_kb_graph(db)
    return WikiGraphResponse(
        nodes=[WikiGraphNode(**node) for node in graph["nodes"]],
        edges=[WikiGraphEdge(**edge) for edge in graph["edges"]],
    )


@app.get("/kb/entries", response_model=list[KnowledgeBankEntryResponse])
def kb_entries(
    scope: str | None = None,
    entry_type: str | None = None,
    matter_id: str | None = None,
    team_id: str | None = None,
    pii_status: str | None = None,
    query: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[KnowledgeBankEntryResponse]:
    try:
        entries = list_kb_entries(
            db,
            user=current_user,
            scope=scope,
            entry_type=entry_type,
            matter_id=matter_id,
            team_id=team_id,
            pii_status=pii_status,
            query=query,
        )
        return [KnowledgeBankEntryResponse.model_validate(entry) for entry in entries]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@app.post(
    "/kb/entries",
    response_model=KnowledgeBankEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_kb_entry(
    schema: KnowledgeBankEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    if schema.scope == "firm_wide" and not can_create_firm_wide(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only partners can create firm-wide entries")
    try:
        entry = await create_kb_entry(db, user=current_user, schema=schema)
        return KnowledgeBankEntryResponse.model_validate(entry)
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@app.post(
    "/kb/backfill-embeddings",
    response_model=KnowledgeBankBackfillResponse,
)
async def backfill_kb_embeddings(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> KnowledgeBankBackfillResponse:
    try:
        (
            embedded_count,
            normalized_scope_count,
            remaining_count,
        ) = await backfill_missing_kb_embeddings(db)
        return KnowledgeBankBackfillResponse(
            embedded_count=embedded_count,
            normalized_scope_count=normalized_scope_count,
            remaining_count=remaining_count,
        )
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@app.post(
    "/kb/ingest/document/{document_id}",
    response_model=KnowledgeBankEntryResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_document_kb_entry(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    """Kick off async summarization of a document into a KB entry.

    Returns a placeholder entry with `status="processing"` immediately. The
    actual summarization runs in a background task using DeepSeek Pro and
    flips the entry to `status="ready"` (or `"failed"`) when done.
    Clients should poll `GET /kb/entries/{id}` to observe completion.
    """
    document = db.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == current_user.id,
        )
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status != "ready":
        raise HTTPException(
            status_code=409,
            detail="Document is still being processed. Try again once it is ready.",
        )

    try:
        entry = create_pending_kb_entry(db, user=current_user, document=document)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503, detail="Knowledge Bank is unavailable",
        ) from exc

    if entry.status == "processing" and not entry.body_markdown:
        # Only schedule if the entry actually needs processing. Re-clicking
        # while a job is in flight is a no-op.
        background_tasks.add_task(process_kb_summary, entry.id)

    return KnowledgeBankEntryResponse.model_validate(entry)


@app.get("/kb/entries/{entry_id}", response_model=KnowledgeBankEntryResponse)
def kb_entry_detail(
    entry_id: str,
    request: Request,
    context_matter_id: str | None = None,
    context_thread_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    try:
        entry = get_kb_entry(db, entry_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
        require_kb_read(db, current_user, entry)
        log_kb_access(
            db,
            user_id=current_user.id,
            action="read",
            entry_id=entry.id,
            matter_id=context_matter_id,
            thread_id=context_thread_id,
            ip_address=request.client.host if request.client else None,
        )
        return KnowledgeBankEntryResponse.model_validate(entry)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@app.get(
    "/kb/entries/{entry_id}/sources",
    response_model=list[WikiPageSourceResponse],
)
def kb_entry_sources(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WikiPageSourceResponse]:
    entry = get_kb_entry(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    return [
        build_wiki_source_response(source)
        for source in list_wiki_page_sources(
            db,
            user_id=current_user.id,
            page_id=entry.id,
        )
    ]


@app.patch("/kb/entries/{entry_id}", response_model=KnowledgeBankEntryResponse)
async def patch_kb_entry(
    entry_id: str,
    schema: KnowledgeBankEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    existing = get_kb_entry(db, entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    require_kb_write(db, current_user, existing)
    try:
        entry = await update_kb_entry(
            db,
            user=current_user,
            entry_id=entry_id,
            schema=schema,
        )
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    return KnowledgeBankEntryResponse.model_validate(entry)


@app.delete("/kb/entries/{entry_id}")
def delete_kb_entry_endpoint(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    existing = get_kb_entry(db, entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    require_kb_write(db, current_user, existing)
    try:
        success = delete_kb_entry(db, user=current_user, entry_id=entry_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc
    if not success:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    return {"status": "ok"}


@app.post(
    "/kb/entries/{entry_id}/promote",
    response_model=RedactionProposalResponse,
)
async def promote_kb_entry_endpoint(
    entry_id: str,
    schema: KnowledgeBankPromoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RedactionProposalResponse:
    try:
        entry, redaction = await promote_kb_entry(
            db,
            user=current_user,
            entry_id=entry_id,
            target_scope=schema.target_scope,
        )
        return RedactionProposalResponse(
            entry=KnowledgeBankEntryResponse.model_validate(entry),
            redacted_fields=redaction.redacted_fields,
            original_content=redaction.original_content,
            redacted_content=redaction.redacted_content,
        )
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@app.get(
    "/kb/entries/{entry_id}/redaction",
    response_model=RedactionProposalResponse,
)
def kb_redaction_detail(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RedactionProposalResponse:
    entry = get_kb_entry(db, entry_id)
    redaction = get_redaction_proposal(db, entry_id)
    if not entry or not redaction:
        raise HTTPException(status_code=404, detail="Redaction proposal not found")
    return RedactionProposalResponse(
        entry=KnowledgeBankEntryResponse.model_validate(entry),
        redacted_fields=redaction.redacted_fields,
        original_content=redaction.original_content,
        redacted_content=redaction.redacted_content,
    )


@app.post(
    "/kb/entries/{entry_id}/approve-redaction",
    response_model=KnowledgeBankEntryResponse,
)
async def approve_kb_redaction(
    entry_id: str,
    schema: RedactionApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    try:
        entry = await approve_redaction(
            db,
            user=current_user,
            entry_id=entry_id,
            schema=schema,
        )
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc
    if not entry:
        raise HTTPException(status_code=404, detail="Pending redaction not found")
    return KnowledgeBankEntryResponse.model_validate(entry)


@app.get("/audit-log", response_model=list[KnowledgeBankAccessLogResponse])
def audit_log(
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[KnowledgeBankAccessLogResponse]:
    require_partner_or_admin(current_user)
    try:
        return [
            KnowledgeBankAccessLogResponse.model_validate(item)
            for item in list_audit_log(db, limit=min(max(limit, 1), 500))
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Audit log is unavailable") from exc


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


# ---------------------------------------------------------------------------
# Survey routes
# ---------------------------------------------------------------------------


@app.get("/survey/questions", response_model=list[SurveyQuestionResponse])
def get_survey_questions(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[SurveyQuestionResponse]:
    return [SurveyQuestionResponse.model_validate(q) for q in list_survey_questions(db, active_only=active_only)]


@app.post("/survey/questions", response_model=SurveyQuestionResponse, status_code=status.HTTP_201_CREATED)
def post_survey_question(
    schema: SurveyQuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyQuestionResponse:
    require_partner_or_admin(current_user)
    q = create_survey_question(db, user=current_user, schema=schema)
    return SurveyQuestionResponse.model_validate(q)


@app.patch("/survey/questions/{question_id}", response_model=SurveyQuestionResponse)
def patch_survey_question(
    question_id: str,
    schema: SurveyQuestionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyQuestionResponse:
    require_partner_or_admin(current_user)
    q = update_survey_question(db, question_id=question_id, schema=schema)
    if not q:
        raise HTTPException(status_code=404, detail="Survey question not found")
    return SurveyQuestionResponse.model_validate(q)


@app.post("/survey/responses", status_code=status.HTTP_201_CREATED)
def post_survey_response(
    schema: SurveyResponseCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    submit_survey_response(db, schema=schema)
    return {"status": "ok"}


@app.get("/survey/results", response_model=SurveyResultsResponse)
def survey_results(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyResultsResponse:
    require_partner_or_admin(current_user)
    return SurveyResultsResponse(questions=get_survey_results(db))


# ---------------------------------------------------------------------------
# Action item routes
# ---------------------------------------------------------------------------


@app.get("/actions", response_model=list[ActionItemResponse])
def get_actions(
    matter_id: str | None = None,
    item_status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ActionItemResponse]:
    items = list_action_items(db, user=current_user, matter_id=matter_id, status=item_status)
    return [ActionItemResponse.model_validate(item) for item in items]


@app.post("/actions", response_model=ActionItemResponse, status_code=status.HTTP_201_CREATED)
def post_action(
    schema: ActionItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActionItemResponse:
    if not is_senior_or_above(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Partner or senior associate access required")
    item = create_action_item(db, user=current_user, schema=schema)
    return ActionItemResponse.model_validate(item)


@app.patch("/actions/{item_id}", response_model=ActionItemResponse)
def patch_action(
    item_id: str,
    schema: ActionItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActionItemResponse:
    item = update_action_item(db, user=current_user, item_id=item_id, schema=schema)
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found or access denied")
    return ActionItemResponse.model_validate(item)


@app.delete("/actions/{item_id}")
def delete_action(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    if not delete_action_item(db, user=current_user, item_id=item_id):
        raise HTTPException(status_code=404, detail="Action item not found or access denied")
    return {"status": "ok"}
