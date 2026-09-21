"""Review Handoff service.

A handoff is a bounded review package: a junior uploads a PDF attached to
a Workboard action; a senior reviews it by placing visual annotations on the
PDF.  See docs/plans/pdf-redlining-review.md.

Status transitions:
    ready_for_review -> in_review -> completed
                                  -> returned  (rework or full reject)
"""

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    ActionItem,
    Document,
    MatterMember,
    ReviewAnnotation,
    ReviewAnnotationReply,
    ReviewHandoff,
    User,
)
from app.models import new_uuid as _new_uuid
from app.schemas import ReviewHandoffCreate
from app.services.resource_metadata_service import (
    RESOURCE_REVIEW_HANDOFF,
    delete_resource_metadata,
    sync_action_metadata,
    sync_handoff_metadata,
    sync_metadata_safe,
)


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


def _handoff_access_filter(user: User):
    if user.is_admin:
        return ReviewHandoff.id.is_not(None)
    return or_(
        ReviewHandoff.submitted_by == user.id,
        ReviewHandoff.reviewer_id == user.id,
        ReviewHandoff.document.has(Document.user_id == user.id),
        and_(
            ReviewHandoff.matter_id.is_not(None),
            exists(
                select(MatterMember.id).where(
                    MatterMember.matter_id == ReviewHandoff.matter_id,
                    MatterMember.user_id == user.id,
                )
            ),
        ),
        ReviewHandoff.action.has(
            or_(
                ActionItem.assignee_id == user.id,
                ActionItem.assigner_id == user.id,
            )
        ),
    )


def require_handoff_access(
    db: Session,
    *,
    user: User,
    handoff: ReviewHandoff,
) -> None:
    allowed = db.scalar(
        select(ReviewHandoff.id).where(
            ReviewHandoff.id == handoff.id,
            _handoff_access_filter(user),
        )
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


# ---------------------------------------------------------------------------
# Lifecycle policy
# ---------------------------------------------------------------------------

ACTIVE_STATUSES = frozenset({"ready_for_review", "in_review"})
TERMINAL_STATUSES = frozenset({"completed", "returned"})
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "ready_for_review": frozenset({"in_review", "completed", "returned"}),
    "in_review": frozenset({"completed", "returned"}),
    "completed": frozenset(),
    "returned": frozenset(),
}


def is_handoff_active(handoff: ReviewHandoff) -> bool:
    return handoff.status in ACTIVE_STATUSES


def assert_transition(handoff: ReviewHandoff, new_status: str) -> None:
    """Raise unless ``handoff`` may move to ``new_status``. Same-status is a no-op."""
    if new_status == handoff.status:
        return
    if new_status not in ALLOWED_TRANSITIONS:
        raise ReviewHandoffError(f"Unknown review status: {new_status}")
    if new_status not in ALLOWED_TRANSITIONS.get(handoff.status, frozenset()):
        if handoff.status in TERMINAL_STATUSES:
            raise ReviewHandoffError("This review round is closed")
        raise ReviewHandoffError(
            f"Cannot move a review from {handoff.status} to {new_status}"
        )


def lock_handoff(db: Session, handoff_id: str) -> ReviewHandoff | None:
    """Row-lock the handoff for the current transaction.

    Every status change and annotation write takes this lock first, so a
    completion racing a new annotation (or two terminal actions) serialise and
    the second sees the first's result.
    """
    return db.scalar(
        select(ReviewHandoff).where(ReviewHandoff.id == handoff_id).with_for_update()
    )


def lock_active_handoff(db: Session, handoff_id: str) -> ReviewHandoff:
    handoff = lock_handoff(db, handoff_id)
    if not handoff:
        raise ReviewHandoffError("Handoff not found")
    if not is_handoff_active(handoff):
        raise ReviewHandoffError("This review round is closed")
    return handoff


def _action_if_current(db: Session, handoff: ReviewHandoff) -> ActionItem | None:
    """The linked action, only when this handoff is still its active round."""
    if not handoff.action_id:
        return None
    action = db.get(ActionItem, handoff.action_id)
    if action and str(action.active_handoff_id) == str(handoff.id):
        return action
    return None


# Firm roles that may review any handoff they can read (mirrors the UI's isManager).
REVIEWER_FIRM_ROLES = frozenset({"partner", "senior_associate"})


def _action_for(db: Session, handoff: ReviewHandoff) -> ActionItem | None:
    if not handoff.action_id:
        return None
    return db.get(ActionItem, handoff.action_id)


def can_review_handoff(db: Session, *, user: User, handoff: ReviewHandoff) -> bool:
    """Reviewer capability: annotate, resolve, complete, return or reject a handoff.

    Read access (submitter, matter member, document owner) is deliberately not enough.
    """
    if user.is_admin or user.firm_role in REVIEWER_FIRM_ROLES:
        return True
    if handoff.reviewer_id == user.id:
        return True
    action = _action_for(db, handoff)
    return bool(action and action.assigner_id == user.id)


def can_remove_handoff(db: Session, *, user: User, handoff: ReviewHandoff) -> bool:
    """The submitter may withdraw their own handoff; reviewers may remove any."""
    return handoff.submitted_by == user.id or can_review_handoff(
        db, user=user, handoff=handoff
    )


def require_reviewer(db: Session, *, user: User, handoff: ReviewHandoff) -> None:
    if not can_review_handoff(db, user=user, handoff=handoff):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Reviewer access required"
        )


def require_handoff_removal(db: Session, *, user: User, handoff: ReviewHandoff) -> None:
    if not can_remove_handoff(db, user=user, handoff=handoff):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the submitter or a reviewer can remove this handoff",
        )


def list_handoffs_for_action(
    db: Session,
    action_id: str,
    *,
    user: User,
) -> list[ReviewHandoff]:
    stmt = (
        _handoff_query()
        .where(
            ReviewHandoff.action_id == action_id,
            _handoff_access_filter(user),
        )
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
    if document.user_id != user.id:
        raise ReviewHandoffError("Document not found")

    if (
        schema.matter_id
        and document.matter_id
        and schema.matter_id != document.matter_id
    ):
        raise ReviewHandoffError("Document belongs to a different matter")

    matter_id = schema.matter_id or document.matter_id
    action: ActionItem | None = None
    action_participant = False
    reviewer_id = schema.reviewer_id
    if schema.action_id:
        action = db.get(ActionItem, schema.action_id)
        if not action:
            raise ReviewHandoffError("Action not found")
        action_participant = (
            action.assignee_id == user.id or action.assigner_id == user.id
        )
        action_access = (
            user.is_admin
            or action_participant
            or (
                action.matter_id
                and db.scalar(
                    select(MatterMember.id).where(
                        MatterMember.matter_id == action.matter_id,
                        MatterMember.user_id == user.id,
                    )
                )
            )
        )
        if not action_access:
            raise ReviewHandoffError("Action not found")
        if matter_id and action.matter_id and matter_id != action.matter_id:
            raise ReviewHandoffError("Document and action belong to different matters")
        if not matter_id:
            matter_id = action.matter_id
        if not reviewer_id:
            reviewer_id = action.assigner_id
        # One open round per action: a revised draft may only follow a
        # returned or completed round.
        if action.active_handoff_id:
            current = db.get(ReviewHandoff, action.active_handoff_id)
            if current and is_handoff_active(current):
                raise ReviewHandoffError(
                    "A review round is already in progress for this action"
                )
    if matter_id and not user.is_admin:
        is_member = db.scalar(
            select(MatterMember.id).where(
                MatterMember.matter_id == matter_id,
                MatterMember.user_id == user.id,
            )
        )
        if not is_member and not (
            action
            and action.matter_id == matter_id
            and action_participant
        ):
            raise ReviewHandoffError("Matter access required")

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
    if action is not None:
        sync_metadata_safe(db, sync_action_metadata, action)
    sync_metadata_safe(db, sync_handoff_metadata, handoff)
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
    handoff = lock_handoff(db, handoff_id)
    if not handoff:
        return None
    assert_transition(handoff, status)

    action_to_sync: ActionItem | None = None
    if status == "completed" and handoff.status != "completed":
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
        action_to_sync = _action_if_current(db, handoff)
        if action_to_sync:
            action_to_sync.status = "done"
            action_to_sync.active_handoff_id = None

    handoff.status = status
    if reviewer_id is not None:
        handoff.reviewer_id = reviewer_id

    db.commit()
    if action_to_sync:
        sync_metadata_safe(db, sync_action_metadata, action_to_sync)
    sync_metadata_safe(db, sync_handoff_metadata, handoff)
    return get_handoff(db, handoff.id)


def _return_handoff(
    db: Session,
    handoff_id: str,
    *,
    reason: str | None,
    clear_active: bool,
) -> ReviewHandoff | None:
    handoff = lock_handoff(db, handoff_id)
    if not handoff:
        return None
    assert_transition(handoff, "returned")
    handoff.status = "returned"
    if reason is not None:
        handoff.return_reason = reason

    # Only the current round may move the action; an older round returning
    # late must not reset a newer submission.
    action_to_sync = _action_if_current(db, handoff)
    if action_to_sync:
        action_to_sync.status = "in_progress"
        if clear_active:
            action_to_sync.active_handoff_id = None

    db.commit()
    if action_to_sync:
        sync_metadata_safe(db, sync_action_metadata, action_to_sync)
    sync_metadata_safe(db, sync_handoff_metadata, handoff)
    return get_handoff(db, handoff.id)


def return_handoff_for_rework(db: Session, handoff_id: str) -> ReviewHandoff | None:
    """Return for rework: the action keeps this as its active round so the next
    submission carries forward needs_rework annotations."""
    return _return_handoff(db, handoff_id, reason=None, clear_active=False)


def reject_handoff(
    db: Session, *, handoff_id: str, reason: str
) -> ReviewHandoff | None:
    """Whole-draft reject with a required reason banner.

    Clears active_handoff_id so the next submission starts clean rather than
    carrying forward annotations from the rejected draft.
    """
    return _return_handoff(db, handoff_id, reason=reason, clear_active=True)


def delete_handoff(db: Session, handoff_id: str) -> bool:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return False
    action_to_sync = None
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action and str(action.active_handoff_id) == str(handoff.id):
            action.active_handoff_id = None
            if action.status == "review":
                action.status = "in_progress"
            action_to_sync = action
    delete_resource_metadata(
        db,
        resource_type=RESOURCE_REVIEW_HANDOFF,
        resource_id=handoff.id,
    )
    db.delete(handoff)
    db.commit()
    if action_to_sync:
        sync_metadata_safe(db, sync_action_metadata, action_to_sync)
    return True


def count_reviews_waiting(db: Session, user: User) -> int:
    """Count handoffs awaiting or actively under this user's review (sidebar badge).

    Includes both ready_for_review (not yet opened) and in_review (senior has
    started but not completed) so the badge does not vanish mid-review.
    Partners and senior associates see all pending reviews, not just explicitly
    assigned ones.
    Uses SELECT COUNT(*) rather than hydrating full ORM rows.
    """
    stmt = select(func.count(ReviewHandoff.id)).where(
        ReviewHandoff.status.in_(("ready_for_review", "in_review")),
        _handoff_access_filter(user),
    )
    return db.scalar(stmt) or 0
