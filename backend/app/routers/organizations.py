"""Teams, matters, and matter memberships."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_matter_member, require_partner_or_admin
from app.models import User
from app.schemas import (
    MatterCreate,
    MatterMemberCreate,
    MatterMemberResponse,
    MatterResponse,
    MatterUpdate,
    TeamResponse,
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

router = APIRouter(tags=["organizations"])


@router.get("/teams", response_model=list[TeamResponse])
def teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TeamResponse]:
    try:
        return [TeamResponse.model_validate(team) for team in list_teams(db, current_user)]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Team database is unavailable") from exc


@router.get("/matters", response_model=list[MatterResponse])
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


@router.post("/matters", response_model=MatterResponse, status_code=status.HTTP_201_CREATED)
def post_matter(
    schema: MatterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatterResponse:
    try:
        return MatterResponse.model_validate(create_matter(db, current_user, schema))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc


@router.get("/matters/{matter_id}", response_model=MatterResponse)
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
    require_matter_member(db, current_user, matter_id)
    return MatterResponse.model_validate(matter)


@router.patch("/matters/{matter_id}", response_model=MatterResponse)
def patch_matter(
    matter_id: str,
    schema: MatterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MatterResponse:
    require_partner_or_admin(current_user)
    try:
        matter = update_matter(db, matter_id, schema)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc
    if not matter:
        raise HTTPException(status_code=404, detail="Matter not found")
    return MatterResponse.model_validate(matter)


@router.get("/matters/{matter_id}/members", response_model=list[MatterMemberResponse])
def matter_members(
    matter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MatterMemberResponse]:
    if not get_matter(db, matter_id):
        raise HTTPException(status_code=404, detail="Matter not found")
    require_matter_member(db, current_user, matter_id)
    return [
        MatterMemberResponse.model_validate(member)
        for member in list_matter_members(db, matter_id)
    ]


@router.post(
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
    require_partner_or_admin(current_user)
    if not get_matter(db, matter_id):
        raise HTTPException(status_code=404, detail="Matter not found")
    return MatterMemberResponse.model_validate(
        add_matter_member(
            db, matter_id=matter_id, granted_by=current_user.id, schema=schema,
        )
    )


@router.delete("/matters/{matter_id}/members/{user_id}")
def delete_matter_member(
    matter_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    require_partner_or_admin(current_user)
    if not remove_matter_member(db, matter_id, user_id):
        raise HTTPException(status_code=404, detail="Matter membership not found")
    return {"status": "ok"}
