"""Document upload, list, and delete."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import DocumentResponse
from app.services.document_service import (
    delete_user_document,
    get_user_document,
    ingest_uploaded_document,
    list_user_documents,
)
from app.services.ingestion_service import UnsupportedDocumentError
from app.services.organization_service import get_matter

router = APIRouter(tags=["documents"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def build_document_response(document, chunk_count: int) -> DocumentResponse:
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


@router.post(
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


@router.get("/documents", response_model=list[DocumentResponse])
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


@router.get("/documents/{document_id}", response_model=DocumentResponse)
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


@router.delete("/documents/{document_id}")
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
