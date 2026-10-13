"""Mentor ↔ mentee pairings inside a mentorship class, and who may read a mentee's feedback.

Membership is necessary for access but never sufficient to read another member's private
content: a mentor reads a mentee's mentee-audience feedback only through an active pairing.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ClassAuditEvent, ClassMembership, MentorPairing, User
from app.services.mentorship_class_service import ClassAccessError, ClassContext, require_class_role

MENTOR_ROLES = {"owner", "mentor"}


def _active_member(db: Session, *, class_id: str, user_id: str) -> ClassMembership | None:
    return db.scalar(select(ClassMembership).where(
        ClassMembership.class_id == class_id,
        ClassMembership.user_id == user_id,
        ClassMembership.status == "active",
    ))


def _audit(db: Session, class_id: str, actor_id: str, action: str, subject_id: str) -> None:
    db.add(ClassAuditEvent(class_id=class_id, actor_id=actor_id, subject_id=subject_id, action=action))


def create_pairing(
    db: Session, *, context: ClassContext, mentor_user_id: str, mentee_user_id: str
) -> MentorPairing:
    require_class_role(context, MENTOR_ROLES)
    if context.role == "mentor" and mentor_user_id != context.user_id:
        raise ClassAccessError("Mentors can only pair themselves as the mentor")
    if mentor_user_id == mentee_user_id:
        raise ClassAccessError("A mentor cannot be paired with themselves", 422)

    mentor = _active_member(db, class_id=context.class_id, user_id=mentor_user_id)
    mentee = _active_member(db, class_id=context.class_id, user_id=mentee_user_id)
    if mentor is None or mentee is None:
        raise ClassAccessError("Active team member not found", 404)
    if mentor.role not in MENTOR_ROLES:
        raise ClassAccessError("The mentor must be an owner or a mentor", 422)

    existing = db.scalar(select(MentorPairing.id).where(
        MentorPairing.class_id == context.class_id,
        MentorPairing.mentor_user_id == mentor_user_id,
        MentorPairing.mentee_user_id == mentee_user_id,
        MentorPairing.ended_at.is_(None),
    ))
    if existing:
        raise ClassAccessError("This pairing already exists", 409)

    pairing = MentorPairing(
        class_id=context.class_id,
        mentor_user_id=mentor_user_id,
        mentee_user_id=mentee_user_id,
        created_by=context.user_id,
    )
    db.add(pairing)
    db.flush()
    _audit(db, context.class_id, context.user_id, "pairing_created", mentee_user_id)
    db.commit()
    db.refresh(pairing)
    return pairing


def end_pairing(db: Session, *, context: ClassContext, pairing_id: str) -> None:
    require_class_role(context, MENTOR_ROLES)
    pairing = db.scalar(select(MentorPairing).where(
        MentorPairing.id == pairing_id,
        MentorPairing.class_id == context.class_id,
        MentorPairing.ended_at.is_(None),
    ))
    if pairing is None:
        raise ClassAccessError("Active pairing not found", 404)
    if context.role == "mentor" and pairing.mentor_user_id != context.user_id:
        raise ClassAccessError("Mentors can only end their own pairings")
    pairing.ended_at = datetime.now(UTC)
    _audit(db, context.class_id, context.user_id, "pairing_ended", pairing.mentee_user_id)
    db.commit()


def list_pairings(db: Session, *, context: ClassContext) -> list[MentorPairing]:
    return list(db.scalars(select(MentorPairing).where(
        MentorPairing.class_id == context.class_id,
        MentorPairing.ended_at.is_(None),
    ).order_by(MentorPairing.created_at)))


def relationships_for(db: Session, *, context: ClassContext) -> tuple[list[User], list[User]]:
    """(my mentors, my mentees) through active pairings."""
    mentor_ids = db.scalars(select(MentorPairing.mentor_user_id).where(
        MentorPairing.class_id == context.class_id,
        MentorPairing.mentee_user_id == context.user_id,
        MentorPairing.ended_at.is_(None),
    )).all()
    mentee_ids = db.scalars(select(MentorPairing.mentee_user_id).where(
        MentorPairing.class_id == context.class_id,
        MentorPairing.mentor_user_id == context.user_id,
        MentorPairing.ended_at.is_(None),
    )).all()
    mentors = list(db.scalars(select(User).where(User.id.in_(mentor_ids)))) if mentor_ids else []
    mentees = list(db.scalars(select(User).where(User.id.in_(mentee_ids)))) if mentee_ids else []
    return mentors, mentees


def is_active_mentor_of(db: Session, *, class_id: str, mentor_user_id: str, mentee_user_id: str) -> bool:
    return db.scalar(select(MentorPairing.id).where(
        MentorPairing.class_id == class_id,
        MentorPairing.mentor_user_id == mentor_user_id,
        MentorPairing.mentee_user_id == mentee_user_id,
        MentorPairing.ended_at.is_(None),
    ).limit(1)) is not None


def can_read_mentee(db: Session, *, context: ClassContext, mentee_user_id: str) -> bool:
    if mentee_user_id == context.user_id:
        return True
    return is_active_mentor_of(
        db, class_id=context.class_id, mentor_user_id=context.user_id, mentee_user_id=mentee_user_id
    )

