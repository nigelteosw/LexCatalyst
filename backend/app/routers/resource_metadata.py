"""Read-only resource metadata index."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import ResourceMetadataResponse
from app.services.resource_metadata_service import (
    get_accessible_resource_metadata,
    list_resource_metadata,
)

router = APIRouter(prefix="/resources/metadata", tags=["resource-metadata"])


@router.get("", response_model=list[ResourceMetadataResponse])
def list_metadata(
    resource_type: str | None = None,
    matter_id: str | None = None,
    team_id: str | None = None,
    scope: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ResourceMetadataResponse]:
    try:
        return list_resource_metadata(
            db,
            user=current_user,
            resource_type=resource_type,
            matter_id=matter_id,
            team_id=team_id,
            scope=scope,
            limit=limit,
            offset=offset,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Resource metadata is unavailable") from exc


@router.get("/{resource_type}/{resource_id}", response_model=ResourceMetadataResponse)
def get_metadata(
    resource_type: str,
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResourceMetadataResponse:
    try:
        metadata = get_accessible_resource_metadata(
            db,
            user=current_user,
            resource_type=resource_type,
            resource_id=resource_id,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Resource metadata is unavailable") from exc
    if not metadata:
        raise HTTPException(status_code=404, detail="Resource metadata not found")
    return metadata
