from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dependencies import is_partner_or_admin
from app.models import Document, DocumentComment, User
from app.services.document_service import can_access_document


class DocumentCommentNotFound(RuntimeError):
    pass


class DocumentCommentAccessDenied(RuntimeError):
    pass


def _require_document_access(
    db: Session,
    *,
    document_id: str,
    user: User,
) -> Document:
    document = db.get(Document, document_id)
    if not document:
        raise DocumentCommentNotFound("Document not found")
    if not can_access_document(db, user_id=user.id, document=document):
        raise DocumentCommentAccessDenied("Access denied")
    return document


def list_comments(
    db: Session,
    *,
    document_id: str,
    user: User,
) -> list[DocumentComment]:
    _require_document_access(db, document_id=document_id, user=user)
    return list(
        db.scalars(
            select(DocumentComment)
            .options(joinedload(DocumentComment.author))
            .where(DocumentComment.document_id == document_id)
            .order_by(DocumentComment.created_at)
        )
    )


def create_comment(
    db: Session,
    *,
    document_id: str,
    user: User,
    content: str,
) -> DocumentComment:
    _require_document_access(db, document_id=document_id, user=user)
    comment = DocumentComment(
        document_id=document_id,
        user_id=user.id,
        content=content.strip(),
    )
    db.add(comment)
    db.commit()
    return db.scalar(
        select(DocumentComment)
        .options(joinedload(DocumentComment.author))
        .where(DocumentComment.id == comment.id)
    ) or comment


def can_delete_comment(
    db: Session,
    *,
    comment: DocumentComment,
    user: User,
) -> bool:
    if comment.user_id == user.id:
        return True
    document = comment.document or db.get(Document, comment.document_id)
    return bool(
        document
        and is_partner_or_admin(user)
        and can_access_document(db, user_id=user.id, document=document)
    )


def delete_comment(
    db: Session,
    *,
    comment_id: str,
    user: User,
) -> None:
    comment = db.scalar(
        select(DocumentComment)
        .options(joinedload(DocumentComment.document))
        .where(DocumentComment.id == comment_id)
    )
    if not comment:
        raise DocumentCommentNotFound("Comment not found")
    if not can_delete_comment(db, comment=comment, user=user):
        raise DocumentCommentAccessDenied(
            "Only the author or a partner on the matter can delete this comment"
        )
    db.delete(comment)
    db.commit()
