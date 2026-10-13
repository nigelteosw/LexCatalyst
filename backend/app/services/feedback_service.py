"""Mentor feedback: one table for every source (review round, captured comment, direct guidance).

Visibility is decided here, in one SQL filter: a mentee-audience row is readable by the mentee,
its author, and an active mentor of the mentee; a team-audience row by every active member.
Mentors never gain access to a mentee's chats, Birdie threads, memories or private documents.

Round feedback is copied in when a review round is returned or completed, so later edits to the
annotation do not rewrite what the mentor said.
"""

from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import ClassMembership, MentorFeedback, MentorPairing, ReviewAnnotation, ReviewHandoff, User
from app.services.mentorship_class_service import ClassAccessError, ClassContext, require_class_role
from app.services.mentorship_service import is_active_mentor_of

MENTOR_ROLES = {"owner", "mentor"}


def is_feedback(annotation: ReviewAnnotation, handoff: ReviewHandoff) -> bool:
    if annotation.author_user_id == handoff.submitted_by:
        return False
    if annotation.previous_annotation_id:
        return False
    return bool((annotation.note or "").strip() or (annotation.suggested_text or "").strip())


def _display_name(db: Session, user_id: str | None) -> str:
    if not user_id:
        return "a reviewer"
    user = db.get(User, user_id)
    if user is None:
        return "a reviewer"
    return user.full_name or user.email


def snapshot_round_feedback(db: Session, handoff: ReviewHandoff) -> int:
    """Copy this round's feedback annotations into mentor_feedback. Idempotent. Flushes; caller commits."""
    annotations = [a for a in handoff.annotations if is_feedback(a, handoff)]
    if not annotations:
        return 0
    already = set(db.scalars(
        select(MentorFeedback.annotation_id).where(
            MentorFeedback.annotation_id.in_([a.id for a in annotations])
        )
    ))
    created = 0
    for annotation in annotations:
        if annotation.id in already:
            continue
        db.add(MentorFeedback(
            class_id=handoff.class_id,
            audience="mentee",
            mentee_user_id=handoff.submitted_by,
            author_user_id=annotation.author_user_id,
            author_name=_display_name(db, annotation.author_user_id),
            source="review_round",
            handoff_id=handoff.id,
            annotation_id=annotation.id,
            anchor_quote=annotation.anchor_quote,
            suggested_text=annotation.suggested_text,
            note=annotation.note or "",
            created_by=annotation.author_user_id or handoff.submitted_by,
        ))
        created += 1
    db.flush()
    return created


def _visible_clause(context: ClassContext):
    mentored_mentees = select(MentorPairing.mentee_user_id).where(
        MentorPairing.class_id == context.class_id,
        MentorPairing.mentor_user_id == context.user_id,
        MentorPairing.ended_at.is_(None),
    )
    return and_(
        MentorFeedback.class_id == context.class_id,
        MentorFeedback.deleted_at.is_(None),
        or_(
            MentorFeedback.audience == "team",
            and_(
                MentorFeedback.audience == "mentee",
                or_(
                    MentorFeedback.mentee_user_id == context.user_id,
                    MentorFeedback.author_user_id == context.user_id,
                    MentorFeedback.mentee_user_id.in_(mentored_mentees),
                ),
            ),
        ),
    )


def list_feedback(
    db: Session,
    *,
    context: ClassContext,
    mentee_user_id: str | None = None,
    source: str | None = None,
    audience: str | None = None,
    limit: int = 100,
) -> list[MentorFeedback]:
    stmt = select(MentorFeedback).where(_visible_clause(context))
    if mentee_user_id is not None:
        stmt = stmt.where(MentorFeedback.mentee_user_id == mentee_user_id)
    if source is not None:
        stmt = stmt.where(MentorFeedback.source == source)
    if audience is not None:
        stmt = stmt.where(MentorFeedback.audience == audience)
    stmt = stmt.order_by(MentorFeedback.created_at.desc()).limit(limit)
    return list(db.scalars(stmt))


def _visible_row(db: Session, context: ClassContext, feedback_id: str) -> MentorFeedback:
    row = db.scalar(select(MentorFeedback).where(MentorFeedback.id == feedback_id, _visible_clause(context)))
    if row is None:
        raise ClassAccessError("Feedback not found", 404)
    return row


def create_guidance(
    db: Session,
    *,
    context: ClassContext,
    audience: str,
    mentee_user_id: str | None,
    note: str,
    anchor_quote: str | None = None,
    suggested_text: str | None = None,
) -> MentorFeedback:
    note = note.strip()
    if not note:
        raise ClassAccessError("Guidance cannot be empty", 422)
    if audience == "team":
        if mentee_user_id is not None:
            raise ClassAccessError("Team guidance has no mentee", 422)
        require_class_role(context, MENTOR_ROLES)
    elif audience == "mentee":
        if mentee_user_id is None:
            raise ClassAccessError("Choose a mentee for this guidance", 422)
        if context.role != "owner" and not is_active_mentor_of(
            db, class_id=context.class_id, mentor_user_id=context.user_id, mentee_user_id=mentee_user_id
        ):
            raise ClassAccessError("Only the mentee's active mentor or the owner can write this guidance")
        if context.role == "owner":
            member = db.scalar(select(ClassMembership.id).where(
                ClassMembership.class_id == context.class_id,
                ClassMembership.user_id == mentee_user_id,
                ClassMembership.status == "active",
            ))
            if member is None:
                raise ClassAccessError("Active team member not found", 404)
    else:
        raise ClassAccessError("Invalid audience", 422)

    row = MentorFeedback(
        class_id=context.class_id,
        audience=audience,
        mentee_user_id=mentee_user_id,
        author_user_id=context.user_id,
        author_name=_display_name(db, context.user_id),
        source="guidance",
        anchor_quote=anchor_quote,
        suggested_text=suggested_text,
        note=note,
        created_by=context.user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_feedback(
    db: Session,
    *,
    context: ClassContext,
    feedback_id: str,
    note: str | None = None,
    anchor_quote: str | None = None,
    suggested_text: str | None = None,
) -> MentorFeedback:
    row = _visible_row(db, context, feedback_id)
    if row.author_user_id != context.user_id:
        raise ClassAccessError("Only the author can edit this feedback", 403)
    if note is not None:
        if not note.strip():
            raise ClassAccessError("Feedback cannot be empty", 422)
        row.note = note.strip()
    if anchor_quote is not None:
        row.anchor_quote = anchor_quote
    if suggested_text is not None:
        row.suggested_text = suggested_text
    db.commit()
    db.refresh(row)
    return row


def delete_feedback(db: Session, *, context: ClassContext, feedback_id: str) -> None:
    row = _visible_row(db, context, feedback_id)
    is_team_owner = row.audience == "team" and context.role == "owner"
    if row.author_user_id != context.user_id and not is_team_owner:
        raise ClassAccessError("Only the author can delete this feedback", 403)
    row.deleted_at = datetime.now(UTC)
    db.commit()
