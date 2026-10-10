"""Document folders: one level deep, inside a matter or the creator's General space."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import is_partner_or_admin, require_matter_member
from app.models import DocumentFolder, User
from app.services.mentorship_class_service import require_active_class_id

GENERAL = "general"


def require_folder_access(db: Session, user: User, folder: DocumentFolder) -> None:
    """Matter folders need matter membership; General folders are private to their creator."""
    if folder.class_id != require_active_class_id(db, user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
    if folder.matter_id:
        require_matter_member(db, user, folder.matter_id)
    elif folder.created_by != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")


def can_manage_folder(user: User, folder: DocumentFolder) -> bool:
    return folder.created_by == user.id or is_partner_or_admin(user)


def get_folder(db: Session, user: User, folder_id: str) -> DocumentFolder | None:
    return db.scalar(select(DocumentFolder).where(
        DocumentFolder.id == folder_id,
        DocumentFolder.class_id == require_active_class_id(db, user.id),
    ))


def list_folders(db: Session, user: User, matter_filter: str) -> list[DocumentFolder]:
    """matter_filter: GENERAL = the caller's own General folders, else a matter id."""
    stmt = select(DocumentFolder).where(DocumentFolder.class_id == require_active_class_id(db, user.id))
    if matter_filter == GENERAL:
        stmt = stmt.where(DocumentFolder.matter_id.is_(None), DocumentFolder.created_by == user.id)
    else:
        require_matter_member(db, user, matter_filter)
        stmt = stmt.where(DocumentFolder.matter_id == matter_filter)
    return list(db.scalars(stmt.order_by(DocumentFolder.name)))


def create_folder(db: Session, user: User, *, name: str, matter_id: str | None) -> DocumentFolder:
    class_id = require_active_class_id(db, user.id)
    if matter_id:
        require_matter_member(db, user, matter_id)
    clean = name.strip()
    if not clean:
        raise ValueError("Folder name is required")
    folder = DocumentFolder(class_id=class_id, name=clean, matter_id=matter_id, created_by=user.id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


def rename_folder(db: Session, folder: DocumentFolder, name: str) -> DocumentFolder:
    clean = name.strip()
    if not clean:
        raise ValueError("Folder name is required")
    folder.name = clean
    db.commit()
    db.refresh(folder)
    return folder


def delete_folder(db: Session, folder: DocumentFolder) -> None:
    """Documents inside move back to the matter root (documents.folder_id is SET NULL)."""
    db.delete(folder)
    db.commit()
