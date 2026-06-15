"""Review Handoff service.

A handoff is a bounded review package: a junior uploads a PDF attached to
a Workboard action; a senior reviews it by placing visual annotations on the
PDF.  See docs/plans/pdf-redlining-review.md.

Status transitions:
    ready_for_review -> in_review -> completed
                                  -> returned  (rework or full reject)
"""

from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    ActionItem,
    Document,
    ReviewAnnotation,
    ReviewAnnotationReply,
    ReviewHandoff,
    User,
)
from app.models import new_uuid as _new_uuid
from app.schemas import ReviewHandoffCreate

SENIOR_ROLES = {"partner", "senior_associate"}

DEFAULT_LIMIT = 100


class ReviewHandoffError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def _handoff_query():
    return select(ReviewHandoff).options(
        joinedload(ReviewHandoff.submitter),
        joinedload(ReviewHandoff.reviewer),
        joinedload(ReviewHandoff.document),
        joinedload(ReviewHandoff.annotations).joinedload(ReviewAnnotation.author),
        joinedload(ReviewHandoff.annotations).joinedload(
            ReviewAnnotation.replies
        ).joinedload(ReviewAnnotationReply.author),
    )


def get_handoff(db: Session, handoff_id: str) -> ReviewHandoff | None:
    return db.scalar(_handoff_query().where(ReviewHandoff.id == handoff_id))


def list_handoffs_for_action(db: Session, action_id: str) -> list[ReviewHandoff]:
    stmt = (
        _handoff_query()
        .where(ReviewHandoff.action_id == action_id)
        .order_by(ReviewHandoff.submitted_at.desc())
    )
    return list(db.scalars(stmt).unique())


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------


def create_handoff(
    db: Session,
    *,
    user: User,
    schema: ReviewHandoffCreate,
) -> ReviewHandoff:
    """Create a handoff for an uploaded PDF.

    Sets the linked action's active_handoff_id and bumps status to 'review'
    so it surfaces in the senior's Review column immediately — no extraction
    phase.
    """
    document = db.get(Document, schema.document_id)
    if not document:
        raise ReviewHandoffError("Document not found")

    matter_id = schema.matter_id or document.matter_id
    action: ActionItem | None = None
    reviewer_id = schema.reviewer_id
    if schema.action_id:
        action = db.get(ActionItem, schema.action_id)
        if not action:
            raise ReviewHandoffError("Action not found")
        if not matter_id:
            matter_id = action.matter_id
        if not reviewer_id:
            reviewer_id = action.assigner_id

    handoff = ReviewHandoff(
        action_id=action.id if action else None,
        matter_id=matter_id,
        document_id=document.id,
        submitted_by=user.id,
        reviewer_id=reviewer_id,
        status="ready_for_review",
    )
    db.add(handoff)
    db.flush()

    if action is not None:
        # Carry forward any needs_rework annotations from the previous round
        if action.active_handoff_id and action.active_handoff_id != handoff.id:
            _carry_forward_annotations(db, prev_handoff_id=action.active_handoff_id, new_handoff=handoff)
        action.active_handoff_id = handoff.id
        action.status = "review"

    db.commit()
    db.refresh(handoff)
    return handoff


def _carry_forward_annotations(
    db: Session, *, prev_handoff_id: str, new_handoff: ReviewHandoff
) -> None:
    """Clone needs_rework annotations into the new handoff round.

    Replies are re-pointed to the carried-forward row so the conversation
    survives the round boundary. The old annotation rows keep their terminal
    status for history.
    """
    prev_annotations = list(
        db.scalars(
            select(ReviewAnnotation)
            .options(joinedload(ReviewAnnotation.replies))
            .where(
                ReviewAnnotation.handoff_id == prev_handoff_id,
                ReviewAnnotation.status == "needs_rework",
            )
        ).unique()
    )

    for old_ann in prev_annotations:
        new_id = _new_uuid()
        new_ann = ReviewAnnotation(
            id=new_id,
            handoff_id=new_handoff.id,
            document_id=new_handoff.document_id,
            page_no=old_ann.page_no,
            kind=old_ann.kind,
            anchor_quote=old_ann.anchor_quote,
            anchor_rects=old_ann.anchor_rects,
            suggested_text=old_ann.suggested_text,
            note=old_ann.note,
            status="open",
            author_user_id=old_ann.author_user_id,
            previous_annotation_id=old_ann.id,
        )
        db.add(new_ann)
        db.flush()

        # Re-point replies from the old annotation to the carried-forward one
        for reply in list(old_ann.replies):
            reply.annotation_id = new_id

    db.flush()


def update_handoff_status(
    db: Session,
    *,
    handoff_id: str,
    status: str,
    reviewer_id: str | None = None,
) -> ReviewHandoff | None:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return None

    if status == "completed":
        open_annotation_id = db.scalar(
            select(ReviewAnnotation.id)
            .where(
                ReviewAnnotation.handoff_id == handoff.id,
                ReviewAnnotation.status.in_(("open", "needs_rework")),
            )
            .limit(1)
        )
        if open_annotation_id:
            raise ReviewHandoffError(
                "All annotations must be resolved before marking complete"
            )
        handoff.completed_at = datetime.now(UTC)
        if handoff.action_id:
            action = db.get(ActionItem, handoff.action_id)
            if action and str(action.active_handoff_id) == str(handoff.id):
                action.status = "done"
                action.active_handoff_id = None

    handoff.status = status
    if reviewer_id is not None:
        handoff.reviewer_id = reviewer_id

    db.commit()
    db.refresh(handoff)
    return get_handoff(db, handoff.id)


def return_handoff_for_rework(db: Session, handoff_id: str) -> ReviewHandoff | None:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return None
    handoff.status = "returned"
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action:
            action.status = "in_progress"
    db.commit()
    return get_handoff(db, handoff.id)


def reject_handoff(
    db: Session, *, handoff_id: str, reason: str
) -> ReviewHandoff | None:
    """Whole-draft reject — returns the handoff with a required reason banner.

    Clears active_handoff_id so that when the junior re-submits, create_handoff
    does NOT carry forward annotations from this rejected draft.
    """
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return None
    handoff.status = "returned"
    handoff.return_reason = reason
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action:
            action.status = "in_progress"
            action.active_handoff_id = None
    db.commit()
    return get_handoff(db, handoff.id)


def delete_handoff(db: Session, handoff_id: str) -> bool:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return False
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action and str(action.active_handoff_id) == str(handoff.id):
            action.active_handoff_id = None
            if action.status == "review":
                action.status = "in_progress"
    db.delete(handoff)
    db.commit()
    return True


def count_reviews_waiting(db: Session, user: User) -> int:
    """Count handoffs awaiting or actively under this user's review (sidebar badge).

    Includes both ready_for_review (not yet opened) and in_review (senior has
    started but not completed) so the badge does not vanish mid-review.
    Partners and senior associates see all pending reviews, not just explicitly
    assigned ones.
    Uses SELECT COUNT(*) rather than hydrating full ORM rows.
    """
    if user.is_admin or user.firm_role in SENIOR_ROLES:
        stmt = select(func.count(ReviewHandoff.id)).where(
            ReviewHandoff.status.in_(("ready_for_review", "in_review")),
        )
    else:
        stmt = (
            select(func.count(ReviewHandoff.id))
            .outerjoin(ActionItem, ActionItem.id == ReviewHandoff.action_id)
            .where(
                ReviewHandoff.status.in_(("ready_for_review", "in_review")),
                or_(
                    ReviewHandoff.reviewer_id == user.id,
                    ActionItem.assigner_id == user.id,
                ),
            )
        )
    return db.scalar(stmt) or 0
