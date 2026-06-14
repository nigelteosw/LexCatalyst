"""Document upload, viewing, comments, rename, and delete."""

from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import authenticate_user_token, get_current_user
from app.models import Document, User
from app.schemas import (
    DocumentCommentCreate,
    DocumentCommentResponse,
    DocumentResponse,
    DocumentUpdate,
)
from app.services.document_comment_service import (
    DocumentCommentAccessDenied,
    DocumentCommentNotFound,
    can_delete_comment,
    create_comment,
    delete_comment,
    list_comments,
)
from app.services.document_service import (
    can_access_document,
    create_pending_document,
    delete_user_document,
    get_user_document,
    list_user_documents,
    rename_user_document,
)
from app.services.ingestion_service import UnsupportedDocumentError
from app.services.storage_service import StorageError, download_document_file

router = APIRouter(tags=["documents"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def build_document_response(
    document: Document,
    chunk_count: int,
    *,
    current_user_id: str,
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
        can_manage=document.user_id == current_user_id,
    )


def build_comment_response(db: Session, comment, current_user: User) -> DocumentCommentResponse:
    return DocumentCommentResponse(
        id=comment.id,
        document_id=comment.document_id,
        user_id=comment.user_id,
        content=comment.content,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        author=comment.author,
        can_delete=can_delete_comment(db, comment=comment, user=current_user),
    )


@router.post(
    "/documents/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentResponse:
    """Store a document and enqueue extraction, OCR, and embedding."""
    filename = file.filename or "document"
    content_type = file.content_type or "application/octet-stream"

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Uploaded file is too large")

        document = await create_pending_document(
            db,
            user_id=current_user.id,
            filename=filename,
            content_type=content_type,
            file_bytes=file_bytes,
        )
        document_with_count = get_user_document(db, current_user.id, document.id)
        chunk_count = document_with_count[1] if document_with_count else 0
        return build_document_response(
            document,
            chunk_count,
            current_user_id=current_user.id,
        )
    except UnsupportedDocumentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc


@router.get("/documents", response_model=list[DocumentResponse])
def documents(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentResponse]:
    try:
        return [
            build_document_response(
                document,
                chunk_count,
                current_user_id=current_user.id,
            )
            for document, chunk_count in list_user_documents(
                db, current_user.id, limit=limit, offset=offset
            )
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
    return build_document_response(
        document,
        chunk_count,
        current_user_id=current_user.id,
    )


@router.patch("/documents/{document_id}", response_model=DocumentResponse)
def rename_document(
    document_id: str,
    schema: DocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentResponse:
    try:
        document = rename_user_document(
            db,
            user_id=current_user.id,
            document_id=document_id,
            filename=schema.filename,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    document_with_count = get_user_document(db, current_user.id, document.id)
    return build_document_response(
        document,
        document_with_count[1] if document_with_count else 0,
        current_user_id=current_user.id,
    )


@router.get("/documents/{document_id}/file")
def document_file(
    document_id: str,
    download: bool = Query(default=False),
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Response:
    bearer_token = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:].strip()
    current_user = authenticate_user_token(db, token or bearer_token)

    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_access_document(db, user_id=current_user.id, document=document):
        raise HTTPException(status_code=403, detail="Access denied")
    if not document.storage_key:
        raise HTTPException(status_code=409, detail="Document file is not available")

    try:
        file_bytes = download_document_file(document.storage_key)
    except StorageError as exc:
        raise HTTPException(status_code=503, detail="Document storage is unavailable") from exc

    disposition = "attachment" if download else "inline"
    encoded_filename = quote(document.filename)
    return Response(
        content=file_bytes,
        media_type=document.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": (
                f"{disposition}; filename*=UTF-8''{encoded_filename}"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/documents/{document_id}/comments",
    response_model=list[DocumentCommentResponse],
)
def document_comments(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentCommentResponse]:
    try:
        comments = list_comments(db, document_id=document_id, user=current_user)
    except DocumentCommentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DocumentCommentAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return [
        build_comment_response(db, comment, current_user)
        for comment in comments
    ]


@router.post(
    "/documents/{document_id}/comments",
    response_model=DocumentCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_document_comment(
    document_id: str,
    schema: DocumentCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentCommentResponse:
    content = schema.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    try:
        comment = create_comment(
            db,
            document_id=document_id,
            user=current_user,
            content=content,
        )
    except DocumentCommentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DocumentCommentAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return build_comment_response(db, comment, current_user)


@router.delete("/documents/comments/{comment_id}")
def delete_document_comment(
    comment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        delete_comment(db, comment_id=comment_id, user=current_user)
    except DocumentCommentNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DocumentCommentAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"status": "ok"}


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
