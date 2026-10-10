"""Membership and short-lived invitation codes for mentorship classes."""

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models import (
    ClassAuditEvent,
    ClassInvite,
    ClassJoinAttempt,
    ClassMembership,
    MentorshipClass,
    User,
)

CODE_RE = re.compile(r"^(?:\d{6}|\d{3}-\d{3})$")
INVITE_LIFETIME = timedelta(hours=24)
ATTEMPT_WINDOW = timedelta(minutes=15)


class ClassAccessError(ValueError):
    def __init__(self, detail: str, status_code: int = 403):
        self.status_code = status_code
        super().__init__(detail)


@dataclass(frozen=True)
class ClassContext:
    user_id: str
    class_id: str
    role: str


def _digest(secret: str, value: str) -> str:
    if len(secret.strip()) < 32:
        raise ValueError("CLASS_INVITE_SECRET must contain at least 32 characters")
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def _audit(db: Session, class_id: str, actor_id: str, action: str, subject_id: str | None = None) -> None:
    db.add(ClassAuditEvent(class_id=class_id, actor_id=actor_id, subject_id=subject_id, action=action))


def require_class_context(db: Session, user: User) -> ClassContext:
    membership = db.scalar(
        select(ClassMembership).join(MentorshipClass)
        .where(ClassMembership.user_id == user.id,
               ClassMembership.status == "active",
               MentorshipClass.status == "active")
    )
    if membership is None:
        raise ClassAccessError("Approved team membership required")
    return ClassContext(user_id=user.id, class_id=membership.class_id, role=membership.role)


def require_active_class_id(db: Session, user_id: str) -> str:
    class_id = db.scalar(
        select(ClassMembership.class_id).join(MentorshipClass).where(
            ClassMembership.user_id == user_id,
            ClassMembership.status == "active",
            MentorshipClass.status == "active",
        )
    )
    if not class_id:
        raise ClassAccessError("Approved team membership required")
    return class_id


def revalidate_class_access(db: Session, *, user_id: str, class_id: str) -> None:
    """Check live membership in the original class outside a long-lived read transaction.

    Streams and jobs must not use an ORM identity cache or an old database snapshot
    to authorize delivery, or move into a newly joined class mid-operation.
    """
    with Session(bind=db.get_bind()) as access_db:
        active = access_db.scalar(select(ClassMembership.id).join(MentorshipClass).where(
            ClassMembership.user_id == user_id,
            ClassMembership.class_id == class_id,
            ClassMembership.status == "active",
            MentorshipClass.status == "active",
        ))
    if active is None:
        raise ClassAccessError("Team access changed. Reopen your workspace")


def require_class_role(context: ClassContext, allowed_roles: set[str]) -> None:
    if context.role not in allowed_roles:
        raise ClassAccessError("Team management permission required")


def create_class(db: Session, *, user: User, name: str) -> MentorshipClass:
    name = name.strip()
    if not 2 <= len(name) <= 160:
        raise ClassAccessError("Team name must be 2–160 characters", 422)
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    if db.scalar(select(ClassMembership.id).where(and_(ClassMembership.user_id == user.id, ClassMembership.status == "active"))):
        raise ClassAccessError("You already belong to a team", 409)
    cohort = MentorshipClass(name=name, status="active", created_by=user.id)
    db.add(cohort)
    db.flush()
    db.add(ClassMembership(class_id=cohort.id, user_id=user.id, role="owner", status="active", joined_at=datetime.now(UTC)))
    _audit(db, cohort.id, user.id, "class_created")
    db.commit()
    db.refresh(cohort)
    return cohort


def rotate_invite(db: Session, *, context: ClassContext, secret: str) -> str:
    require_class_role(context, {"owner", "mentor"})
    cohort = db.get(MentorshipClass, context.class_id)
    if not cohort or cohort.status != "active":
        raise ClassAccessError("Team unavailable")
    now = datetime.now(UTC)
    for invite in db.scalars(select(ClassInvite).where(ClassInvite.class_id == context.class_id, ClassInvite.revoked_at.is_(None))):
        invite.revoked_at = now
    db.flush()
    for _ in range(20):
        digits = f"{secrets.randbelow(1_000_000):06d}"
        digest = _digest(secret, digits)
        if not db.scalar(select(ClassInvite.id).where(ClassInvite.code_digest == digest, ClassInvite.revoked_at.is_(None))):
            db.add(ClassInvite(class_id=context.class_id, code_digest=digest,
                               expires_at=now + INVITE_LIFETIME, created_by=context.user_id))
            _audit(db, context.class_id, context.user_id, "invite_rotated")
            db.commit()
            return f"{digits[:3]}-{digits[3:]}"
    db.rollback()
    raise ClassAccessError("Could not generate a unique code", 503)


def request_join(db: Session, *, user: User, code: str, source_ip: str, secret: str) -> ClassMembership:
    now = datetime.now(UTC)
    ip_digest = _digest(secret, "ip:" + source_ip)
    since = now - ATTEMPT_WINDOW
    user_count = db.scalar(select(func.count()).select_from(ClassJoinAttempt).where(
        ClassJoinAttempt.user_id == user.id, ClassJoinAttempt.attempted_at >= since)) or 0
    ip_count = db.scalar(select(func.count()).select_from(ClassJoinAttempt).where(
        ClassJoinAttempt.source_ip_digest == ip_digest, ClassJoinAttempt.attempted_at >= since)) or 0
    if user_count >= 5 or ip_count >= 30:
        raise ClassAccessError("Too many attempts. Try again in 15 minutes", 429)
    db.add(ClassJoinAttempt(user_id=user.id, source_ip_digest=ip_digest, attempted_at=now))
    db.commit()  # Failed guesses must count too.
    if not CODE_RE.fullmatch(code.strip()):
        raise ClassAccessError("Invalid or expired team code", 400)
    digits = code.strip().replace("-", "")
    invite = db.scalar(select(ClassInvite).where(
        ClassInvite.code_digest == _digest(secret, digits), ClassInvite.revoked_at.is_(None)))
    if not invite or invite.expires_at.replace(tzinfo=UTC) <= now:
        raise ClassAccessError("Invalid or expired team code", 400)
    cohort = db.get(MentorshipClass, invite.class_id)
    if not cohort or cohort.status != "active":
        raise ClassAccessError("Invalid or expired team code", 400)
    if db.scalar(select(ClassMembership.id).where(
        ClassMembership.user_id == user.id, ClassMembership.status == "active")):
        raise ClassAccessError("You already belong to a team", 409)
    membership = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == cohort.id, ClassMembership.user_id == user.id))
    if membership is None:
        membership = ClassMembership(class_id=cohort.id, user_id=user.id, role="member", status="pending")
        db.add(membership)
    elif membership.status != "pending":
        membership.status = "pending"
        membership.role = "member"
        membership.removed_at = None
    _audit(db, cohort.id, user.id, "join_requested", user.id)
    db.commit()
    db.refresh(membership)
    return membership


def approve_member(db: Session, *, context: ClassContext, target_user_id: str) -> ClassMembership:
    require_class_role(context, {"owner", "mentor"})
    db.scalar(select(User).where(User.id == target_user_id).with_for_update())
    membership = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == target_user_id,
    ).with_for_update())
    cohort = db.get(MentorshipClass, context.class_id)
    if not cohort or cohort.status != "active" or not membership or membership.status != "pending":
        raise ClassAccessError("Pending request not found", 404)
    if db.scalar(select(ClassMembership.id).where(
        ClassMembership.user_id == target_user_id,
        ClassMembership.status == "active")):
        raise ClassAccessError("User already belongs to a team", 409)
    membership.status = "active"
    membership.joined_at = datetime.now(UTC)
    _audit(db, context.class_id, context.user_id, "member_approved", target_user_id)
    db.commit()
    db.refresh(membership)
    return membership


def transfer_ownership(db: Session, *, context: ClassContext, target_user_id: str) -> None:
    require_class_role(context, {"owner"})
    if target_user_id == context.user_id:
        raise ClassAccessError("Choose another active member", 422)
    current = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == context.user_id,
        ClassMembership.status == "active",
    ).with_for_update())
    target = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == target_user_id,
        ClassMembership.status == "active",
    ).with_for_update())
    if not current or current.role != "owner" or not target:
        raise ClassAccessError("Active team member required", 404)
    target.role = "owner"
    current.role = "member"
    _audit(db, context.class_id, context.user_id, "ownership_transferred", target_user_id)
    db.commit()


def remove_member(db: Session, *, context: ClassContext, target_user_id: str) -> None:
    target = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == target_user_id,
        ClassMembership.status == "active",
    ).with_for_update())
    if not target:
        raise ClassAccessError("Active team member not found", 404)
    if target.role == "owner":
        raise ClassAccessError("Transfer ownership before leaving or removing the owner", 409)
    if context.user_id != target_user_id:
        require_class_role(context, {"owner", "mentor"})
        if context.role == "mentor" and target.role == "mentor":
            raise ClassAccessError("Only the owner can remove a mentor")
    target.status = "removed"
    target.removed_at = datetime.now(UTC)
    _audit(db, context.class_id, context.user_id, "member_removed", target_user_id)
    db.commit()


def reject_member(db: Session, *, context: ClassContext, target_user_id: str) -> None:
    require_class_role(context, {"owner", "mentor"})
    membership = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == target_user_id,
        ClassMembership.status == "pending",
    ).with_for_update())
    if membership is None:
        raise ClassAccessError("Pending request not found", 404)
    membership.status = "rejected"
    _audit(db, context.class_id, context.user_id, "member_rejected", target_user_id)
    db.commit()


def set_member_role(db: Session, *, context: ClassContext, target_user_id: str, role: str) -> None:
    require_class_role(context, {"owner"})
    if role not in {"member", "mentor"}:
        raise ClassAccessError("Invalid team role", 422)
    membership = db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == target_user_id,
        ClassMembership.status == "active",
    ).with_for_update())
    if membership is None or membership.role == "owner":
        raise ClassAccessError("Active team member not found", 404)
    membership.role = role
    _audit(db, context.class_id, context.user_id, "member_role_changed", target_user_id)
    db.commit()


def disable_invite(db: Session, *, context: ClassContext) -> None:
    require_class_role(context, {"owner", "mentor"})
    now = datetime.now(UTC)
    for invite in db.scalars(select(ClassInvite).where(
        ClassInvite.class_id == context.class_id, ClassInvite.revoked_at.is_(None),
    ).with_for_update()):
        invite.revoked_at = now
    _audit(db, context.class_id, context.user_id, "invite_disabled")
    db.commit()


def archive_class(db: Session, *, context: ClassContext) -> None:
    require_class_role(context, {"owner"})
    cohort = db.scalar(select(MentorshipClass).where(
        MentorshipClass.id == context.class_id,
        MentorshipClass.status == "active",
    ).with_for_update())
    if cohort is None:
        raise ClassAccessError("Team unavailable", 404)
    now = datetime.now(UTC)
    cohort.status = "archived"
    for membership in db.scalars(select(ClassMembership).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.status.in_(("active", "pending")),
    ).with_for_update()):
        membership.status = "removed"
        membership.removed_at = now
    for invite in db.scalars(select(ClassInvite).where(
        ClassInvite.class_id == context.class_id, ClassInvite.revoked_at.is_(None),
    )):
        invite.revoked_at = now
    _audit(db, context.class_id, context.user_id, "class_archived")
    db.commit()
