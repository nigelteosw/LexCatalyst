"""Authenticated mentorship class enrollment and management."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import ClassMembership, MentorshipClass, User
from app.services.mentorship_class_service import (
    ClassAccessError,
    archive_class,
    approve_member,
    create_class,
    disable_invite,
    reject_member,
    remove_member,
    request_join,
    require_class_context,
    require_class_role,
    rotate_invite,
    set_member_role,
    transfer_ownership,
)

router = APIRouter(prefix="/classes", tags=["mentorship classes"])


class CreateClassRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)


class JoinClassRequest(BaseModel):
    code: str = Field(min_length=6, max_length=7)


class MemberIdRequest(BaseModel):
    user_id: str


class MemberRoleRequest(BaseModel):
    role: str


def _http_error(exc: ClassAccessError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _current(db: Session, user: User) -> tuple[object, MentorshipClass]:
    try:
        context = require_class_context(db, user)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    cohort = db.get(MentorshipClass, context.class_id)
    if cohort is None:
        raise HTTPException(status_code=403, detail="Approved team membership required")
    return context, cohort


@router.get("/status")
def class_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    active = db.scalar(select(ClassMembership).where(
        ClassMembership.user_id == current_user.id, ClassMembership.status == "active"))
    if active:
        cohort = db.get(MentorshipClass, active.class_id)
        if cohort and cohort.status == "active":
            return {"status": "active", "class_id": cohort.id, "name": cohort.name, "role": active.role}
    pending = db.scalar(select(ClassMembership).where(
        ClassMembership.user_id == current_user.id, ClassMembership.status == "pending"))
    return {"status": "pending" if pending else "none"}


@router.post("", status_code=201)
def post_class(schema: CreateClassRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    try:
        cohort = create_class(db, user=current_user, name=schema.name)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"id": cohort.id, "name": cohort.name, "role": "owner"}


@router.post("/join", status_code=202)
def post_join(schema: JoinClassRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    secret = get_settings().class_invite_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Team joining is unavailable")
    try:
        membership = request_join(
            db, user=current_user, code=schema.code,
            source_ip=request.client.host if request.client else "unknown", secret=secret,
        )
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": membership.status}


@router.get("/current")
def get_current_class(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, cohort = _current(db, current_user)
    return {"id": cohort.id, "name": cohort.name, "role": context.role}


@router.get("/current/members")
def get_members(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    context, _ = _current(db, current_user)
    rows = db.execute(select(ClassMembership, User).join(User, ClassMembership.user_id == User.id).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.status == "active",
    )).all()
    return [{"id": user.id, "full_name": user.full_name, "role": membership.role} for membership, user in rows]


@router.get("/current/requests")
def get_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    context, _ = _current(db, current_user)
    try:
        require_class_role(context, {"owner", "mentor"})
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    rows = db.execute(select(ClassMembership, User).join(User, ClassMembership.user_id == User.id).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.status == "pending",
    )).all()
    return [{"id": user.id, "full_name": user.full_name, "requested_at": membership.requested_at} for membership, user in rows]


@router.post("/current/invite")
def post_invite(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    secret = get_settings().class_invite_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Team invitations are unavailable")
    try:
        code = rotate_invite(db, context=context, secret=secret)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"code": code, "expires_in_seconds": 86400}


@router.post("/current/members/{user_id}/approve")
def post_approve(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        membership = approve_member(db, context=context, target_user_id=user_id)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"id": membership.user_id, "status": membership.status}


@router.post("/current/members/{user_id}/reject")
def post_reject(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        reject_member(db, context=context, target_user_id=user_id)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "rejected"}


@router.patch("/current/members/{user_id}/role")
def patch_member_role(user_id: str, schema: MemberRoleRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        set_member_role(db, context=context, target_user_id=user_id, role=schema.role)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "updated", "role": schema.role}


@router.delete("/current/invite")
def delete_invite(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        disable_invite(db, context=context)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "disabled"}


@router.post("/current/archive")
def post_archive(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        archive_class(db, context=context)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "archived"}


@router.post("/current/transfer-owner")
def post_transfer_ownership(schema: MemberIdRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        transfer_ownership(db, context=context, target_user_id=schema.user_id)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "transferred"}


@router.post("/current/leave")
def post_leave(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        remove_member(db, context=context, target_user_id=current_user.id)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "left"}


@router.delete("/current/members/{user_id}")
def delete_member(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    context, _ = _current(db, current_user)
    try:
        remove_member(db, context=context, target_user_id=user_id)
    except ClassAccessError as exc:
        raise _http_error(exc) from exc
    return {"status": "removed"}
