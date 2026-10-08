"""Document metadata: LLM-generated tags and summary, editable by people with access.

Access follows the document (owner or matter member), not the Knowledge Bank scope.
See app/services/document_catalogue_service.py.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import DocumentMetadataResponse, DocumentMetadataUpdate
from app.services.document_catalogue_service import (
    DocumentMetadataError,
    get_document_metadata,
    list_document_tags,
    backfill_document_metadata,
    search_document_catalogue,
    update_document_metadata,
)

router = APIRouter(tags=["document-metadata"])


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")


@router.get("/documents/metadata/search", response_model=list[DocumentMetadataResponse])
async def search_metadata(
    q: str | None = Query(default=None, max_length=200),
    tags: list[str] = Query(default=[], max_length=10),
    document_type: str | None = Query(default=None, max_length=40),
    matter_id: str | None = Query(default=None, max_length=36),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = await search_document_catalogue(
        db,
        user=current_user,
        query=q,
        tags=tags,
        document_type=document_type,
        matter_id=matter_id,
        limit=limit,
    )
    return rows


@router.get("/documents/metadata/tags", response_model=list[str])
def tag_list(
    matter_id: str | None = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return list_document_tags(db, user=current_user, matter_id=matter_id)


@router.get("/documents/{document_id}/metadata", response_model=DocumentMetadataResponse)
def metadata_detail(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    metadata = get_document_metadata(db, user=current_user, document_id=document_id)
    if not metadata:
        raise _not_found()
    return metadata


@router.patch("/documents/{document_id}/metadata", response_model=DocumentMetadataResponse)
async def metadata_update(
    document_id: str,
    schema: DocumentMetadataUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = schema.model_dump(exclude_unset=True)
    try:
        metadata = await update_document_metadata(
            db, user=current_user, document_id=document_id, updates=updates
        )
    except DocumentMetadataError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if not metadata:
        raise _not_found()
    return metadata


@router.post("/kb/backfill-document-metadata")
async def metadata_backfill(
    limit: int = Query(default=10, ge=1, le=25),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int]:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return await backfill_document_metadata(db, limit=limit)
