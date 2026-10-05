"""Knowledge Bank CRUD, ingestion, redaction, graph, and audit log."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import (
    get_current_user,
    require_kb_owner,
    require_kb_read,
    require_kb_write,
    require_partner_or_admin,
)
from app.models import Document, User
from app.routers.wiki import build_wiki_source_response
from app.schemas import (
    KnowledgeBankAccessLogResponse,
    KnowledgeBankBackfillResponse,
    KnowledgeBankEntryCreate,
    KnowledgeBankEntryPageResponse,
    KnowledgeBankEntryResponse,
    KnowledgeBankEntryStatusResponse,
    KnowledgeBankEntrySummaryResponse,
    KnowledgeBankEntryUpdate,
    KnowledgeBankPromoteRequest,
    RedactionApprovalRequest,
    RedactionProposalResponse,
    WikiGraphEdge,
    WikiGraphNode,
    WikiGraphResponse,
    WikiPageSourceResponse,
)
from app.services.kb_ingestion_service import create_pending_kb_entry
from app.services.knowledge_bank_service import (
    KnowledgeBankError,
    KnowledgeBankScopeError,
    approve_redaction,
    backfill_missing_kb_embeddings,
    build_kb_graph,
    create_kb_entry,
    delete_kb_entry,
    get_kb_entry,
    get_kb_entry_statuses,
    get_redaction_proposal,
    list_audit_log,
    list_kb_entries,
    promote_kb_entry,
    update_kb_entry,
)
from app.services.wiki_service import list_wiki_page_sources

router = APIRouter(tags=["knowledge-bank"])


@router.get("/kb/graph", response_model=WikiGraphResponse)
def kb_graph(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WikiGraphResponse:
    graph = build_kb_graph(db, user=current_user)
    return WikiGraphResponse(
        nodes=[WikiGraphNode(**node) for node in graph["nodes"]],
        edges=[WikiGraphEdge(**edge) for edge in graph["edges"]],
    )


@router.get("/kb/entries", response_model=KnowledgeBankEntryPageResponse)
def kb_entries(
    scope: str | None = None,
    entry_type: str | None = None,
    matter_id: str | None = None,
    context_matter_id: str | None = None,
    team_id: str | None = None,
    pii_status: str | None = None,
    query: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryPageResponse:
    try:
        entries, next_offset = list_kb_entries(
            db,
            user=current_user,
            scope=scope,
            entry_type=entry_type,
            matter_id=matter_id,
            context_matter_id=context_matter_id,
            team_id=team_id,
            pii_status=pii_status,
            query=query,
            limit=limit,
            offset=offset,
        )
        return KnowledgeBankEntryPageResponse(
            items=[KnowledgeBankEntrySummaryResponse(**entry) for entry in entries],
            limit=limit,
            offset=offset,
            next_offset=next_offset,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@router.post(
    "/kb/entries",
    response_model=KnowledgeBankEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_kb_entry(
    schema: KnowledgeBankEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    if schema.scope == "firm_wide":
        require_partner_or_admin(current_user)
    try:
        entry = await create_kb_entry(db, user=current_user, schema=schema)
        return KnowledgeBankEntryResponse.model_validate(entry)
    except KnowledgeBankScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@router.post("/kb/backfill-embeddings", response_model=KnowledgeBankBackfillResponse)
async def backfill_kb_embeddings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankBackfillResponse:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    try:
        embedded_count, normalized_scope_count, remaining_count = (
            await backfill_missing_kb_embeddings(db)
        )
        return KnowledgeBankBackfillResponse(
            embedded_count=embedded_count,
            normalized_scope_count=normalized_scope_count,
            remaining_count=remaining_count,
        )
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@router.post(
    "/kb/ingest/document/{document_id}",
    response_model=KnowledgeBankEntryResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_document_kb_entry(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    """Kick off async ingestion of a document into a KB entry.

    Returns a placeholder entry with `status="processing"` immediately. The
    worker claims the job, formats the full document text using the owner's OpenRouter model,
    computes the embedding, and flips the entry to `status="ready"` (or
    `"failed"`) when done. Clients should poll `GET /kb/entries/{id}` to
    observe completion.
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

    return KnowledgeBankEntryResponse.model_validate(entry)


# IMPORTANT: declared BEFORE /kb/entries/{entry_id} so the literal path
# `status` isn't swallowed by the {entry_id} param matcher.
@router.get(
    "/kb/entries/status",
    response_model=list[KnowledgeBankEntryStatusResponse],
)
def kb_entry_statuses(
    ids: list[str] = Query(default_factory=list),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[KnowledgeBankEntryStatusResponse]:
    try:
        return [
            KnowledgeBankEntryStatusResponse(**entry)
            for entry in get_kb_entry_statuses(db, user=current_user, entry_ids=ids)
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@router.get("/kb/entries/{entry_id}", response_model=KnowledgeBankEntryResponse)
def kb_entry_detail(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    try:
        entry = get_kb_entry(db, entry_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
        require_kb_read(db, current_user, entry)
        return KnowledgeBankEntryResponse.model_validate(entry)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc


@router.get(
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
    require_kb_read(db, current_user, entry)
    return [
        build_wiki_source_response(source)
        for source in list_wiki_page_sources(db, user_id=current_user.id, page_id=entry.id)
    ]


@router.patch("/kb/entries/{entry_id}", response_model=KnowledgeBankEntryResponse)
async def patch_kb_entry(
    entry_id: str,
    schema: KnowledgeBankEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    existing = get_kb_entry(db, entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    classification_fields = {"scope", "team_id", "matter_id"}
    if classification_fields.intersection(schema.model_fields_set):
        require_kb_owner(current_user, existing)
    else:
        require_kb_write(db, current_user, existing)
    try:
        entry = await update_kb_entry(
            db, user=current_user, entry_id=entry_id, schema=schema,
        )
    except KnowledgeBankScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    return KnowledgeBankEntryResponse.model_validate(entry)


@router.delete("/kb/entries/{entry_id}")
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


@router.post(
    "/kb/entries/{entry_id}/promote",
    response_model=RedactionProposalResponse,
)
async def promote_kb_entry_endpoint(
    entry_id: str,
    schema: KnowledgeBankPromoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RedactionProposalResponse:
    existing = get_kb_entry(db, entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Knowledge Bank entry not found")
    require_kb_owner(current_user, existing)
    try:
        entry, redaction = await promote_kb_entry(
            db, user=current_user, entry_id=entry_id, target_scope=schema.target_scope,
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


@router.get(
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
    require_kb_owner(current_user, entry)
    return RedactionProposalResponse(
        entry=KnowledgeBankEntryResponse.model_validate(entry),
        redacted_fields=redaction.redacted_fields,
        original_content=redaction.original_content,
        redacted_content=redaction.redacted_content,
    )


@router.post(
    "/kb/entries/{entry_id}/approve-redaction",
    response_model=KnowledgeBankEntryResponse,
)
async def approve_kb_redaction(
    entry_id: str,
    schema: RedactionApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    existing = get_kb_entry(db, entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Pending redaction not found")
    require_kb_owner(current_user, existing)
    try:
        entry = await approve_redaction(
            db, user=current_user, entry_id=entry_id, schema=schema,
        )
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Knowledge Bank is unavailable") from exc
    if not entry:
        raise HTTPException(status_code=404, detail="Pending redaction not found")
    return KnowledgeBankEntryResponse.model_validate(entry)


@router.get("/audit-log", response_model=list[KnowledgeBankAccessLogResponse])
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
