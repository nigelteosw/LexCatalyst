"""Wiki page CRUD, ingestion, and graph."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.providers.deepseek import DeepSeekError
from app.schemas import (
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
from app.services.knowledge_bank_service import (
    KnowledgeBankError,
    sync_linked_wiki_page_to_kb,
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

router = APIRouter(tags=["wiki"])


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


@router.get("/wiki/pages", response_model=list[WikiPageResponse])
def wiki_pages(
    status: str | None = None,
    page_type: str | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WikiPageResponse]:
    try:
        pages = list_wiki_pages(
            db,
            user_id=current_user.id,
            status=status,
            page_type=page_type,
            limit=limit,
            offset=offset,
        )
        return [build_wiki_page_response(page) for page in pages]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc


@router.post("/wiki/pages", response_model=WikiPageResponse, status_code=status.HTTP_201_CREATED)
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


@router.get("/wiki/pages/{page_id}", response_model=WikiPageResponse)
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


@router.patch("/wiki/pages/{page_id}", response_model=WikiPageResponse)
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


@router.delete("/wiki/pages/{page_id}")
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


@router.post("/wiki/pages/{page_id}/publish", response_model=WikiPageResponse)
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


@router.post("/wiki/ingest/document/{document_id}", response_model=WikiPageResponse)
async def ingest_document_wiki_page(
    document_id: str,
    request: WikiIngestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiPageResponse:
    try:
        page = await ingest_document_to_wiki(
            db, user=current_user, document_id=document_id, request=request,
        )
        return build_wiki_page_response(page)
    except WikiIngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc


@router.get("/wiki/pages/{page_id}/sources", response_model=list[WikiPageSourceResponse])
def wiki_page_sources(
    page_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WikiPageSourceResponse]:
    try:
        page = get_wiki_page(db, user_id=current_user.id, page_id=page_id)
        if not page:
            raise HTTPException(status_code=404, detail="Wiki page not found")
        sources = list_wiki_page_sources(
            db, user_id=current_user.id, page_id=page_id, limit=limit, offset=offset,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Wiki database is unavailable") from exc
    return [build_wiki_source_response(source) for source in sources]


@router.get("/wiki/graph", response_model=WikiGraphResponse)
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
