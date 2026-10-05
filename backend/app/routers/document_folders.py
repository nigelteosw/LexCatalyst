"""Document folders inside matters."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import DocumentFolder, User
from app.schemas import DocumentFolderCreate, DocumentFolderResponse, DocumentFolderUpdate
from app.services.document_folder_service import (
    GENERAL,
    can_manage_folder,
    create_folder,
    delete_folder,
    get_folder,
    list_folders,
    rename_folder,
    require_folder_access,
)

router = APIRouter(tags=["document-folders"])


def _response(folder: DocumentFolder, user: User) -> DocumentFolderResponse:
    return DocumentFolderResponse(
        id=folder.id,
        matter_id=folder.matter_id,
        name=folder.name,
        created_by=folder.created_by,
        can_manage=can_manage_folder(user, folder),
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


def _load_manageable(db: Session, user: User, folder_id: str) -> DocumentFolder:
    folder = get_folder(db, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    require_folder_access(db, user, folder)
    if not can_manage_folder(user, folder):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the folder creator or a partner can change this folder")
    return folder


@router.get("/document-folders", response_model=list[DocumentFolderResponse])
def folders(
    matter_id: str = Query(default=GENERAL),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentFolderResponse]:
    try:
        return [_response(f, current_user) for f in list_folders(db, current_user, matter_id)]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc


@router.post("/document-folders", response_model=DocumentFolderResponse, status_code=status.HTTP_201_CREATED)
def post_folder(
    schema: DocumentFolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentFolderResponse:
    try:
        folder = create_folder(db, current_user, name=schema.name, matter_id=schema.matter_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc
    return _response(folder, current_user)


@router.patch("/document-folders/{folder_id}", response_model=DocumentFolderResponse)
def patch_folder(
    folder_id: str,
    schema: DocumentFolderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentFolderResponse:
    folder = _load_manageable(db, current_user, folder_id)
    try:
        return _response(rename_folder(db, folder, schema.name), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc


@router.delete("/document-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    folder = _load_manageable(db, current_user, folder_id)
    try:
        delete_folder(db, folder)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Document database is unavailable") from exc
