"""Teams, matters, and matter memberships."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import _is_matter_member, get_current_user, is_partner_or_admin, is_senior_or_above, require_matter_member, require_partner_or_admin
from app.models import User
from app.services.mentorship_class_service import ClassAccessError
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
    delete_matter,
    get_matter,
    list_matter_members,
    list_matters,
    list_teams,
    remove_matter_member,
    update_matter,
)

router = APIRouter(tags=["organizations"])


def _require_membership_manager(db: Session, user: User, matter_id: str) -> None:
    """Require explicit matter access before checking the management role."""
    require_matter_member(db, user, matter_id)
    if is_partner_or_admin(user):
        return
    if is_senior_or_above(user) and _is_matter_member(db, user.id, matter_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Partner access or senior membership on this matter is required",
    )


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
    if not is_senior_or_above(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Senior associate or partner access required")
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
    require_matter_member(db, current_user, matter_id)
    try:
        matter = update_matter(db, matter_id, schema)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc
    if not matter:
        raise HTTPException(status_code=404, detail="Matter not found")
    return MatterResponse.model_validate(matter)


@router.delete("/matters/{matter_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_matter(
    matter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    require_partner_or_admin(current_user)
    require_matter_member(db, current_user, matter_id)
    try:
        deleted = delete_matter(db, matter_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Matter database is unavailable") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Matter not found")


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
    _require_membership_manager(db, current_user, matter_id)
    if not get_matter(db, matter_id):
        raise HTTPException(status_code=404, detail="Matter not found")
    try:
        return MatterMemberResponse.model_validate(
            add_matter_member(
                db, matter_id=matter_id, granted_by=current_user.id, schema=schema,
            )
        )
    except ClassAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.delete("/matters/{matter_id}/members/{user_id}")
def delete_matter_member(
    matter_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    _require_membership_manager(db, current_user, matter_id)
    if not remove_matter_member(db, matter_id, user_id):
        raise HTTPException(status_code=404, detail="Matter membership not found")
    return {"status": "ok"}
