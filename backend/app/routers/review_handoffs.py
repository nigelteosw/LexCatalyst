"""Review Handoff + Annotation endpoints.

See docs/plans/pdf-redlining-review.md for the full design.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ReviewAnnotation, ReviewAnnotationReply, ReviewHandoff, User
from app.schemas import (
    KnowledgeBankEntryResponse,
    ReviewAnnotationCreate,
    ReviewAnnotationPromoteRequest,
    ReviewAnnotationReplyCreate,
    ReviewAnnotationReplyResponse,
    ReviewAnnotationResponse,
    ReviewAnnotationUpdate,
    ReviewHandoffCreate,
    ReviewHandoffRejectRequest,
    ReviewHandoffResponse,
    ReviewHandoffUpdate,
    ReviewWaitingCountResponse,
)
from app.services.review_annotation_service import (
    ReviewAnnotationError,
    create_annotation,
    delete_annotation,
    delete_reply,
    export_flattened_pdf,
    get_annotation,
    get_annotation_history,
    list_annotations,
    list_replies,
    post_reply,
    promote_annotation_to_kb,
    update_annotation,
)
from app.services.review_handoff_service import (
    ReviewHandoffError,
    can_remove_handoff,
    can_review_handoff,
    count_reviews_waiting,
    create_handoff,
    delete_handoff,
    get_handoff,
    is_handoff_active,
    list_handoffs_for_action,
    reject_handoff,
    require_handoff_access,
    require_handoff_removal,
    require_reviewer,
    return_handoff_for_rework,
    update_handoff_status,
)

router = APIRouter(tags=["review-handoffs"])


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------


def _serialise_handoff(
    handoff: ReviewHandoff, *, db: Session, user: User
) -> ReviewHandoffResponse:
    can_review = can_review_handoff(db, user=user, handoff=handoff)
    return ReviewHandoffResponse(
        can_review=can_review,
        can_annotate=can_review and is_handoff_active(handoff),
        can_remove=can_remove_handoff(db, user=user, handoff=handoff),
        id=handoff.id,
        action_id=handoff.action_id,
        matter_id=handoff.matter_id,
        document_id=handoff.document_id,
        submitted_by=handoff.submitted_by,
        submitted_at=handoff.submitted_at,
        status=handoff.status,
        reviewer_id=handoff.reviewer_id,
        completed_at=handoff.completed_at,
        return_reason=handoff.return_reason,
        error_message=handoff.error_message,
        created_at=handoff.created_at,
        updated_at=handoff.updated_at,
        submitter=handoff.submitter,
        reviewer=handoff.reviewer,
        annotations=[ReviewAnnotationResponse.model_validate(a) for a in handoff.annotations],
        document_filename=handoff.document.filename if handoff.document else None,
    )


def _serialise_annotation(annotation: ReviewAnnotation) -> ReviewAnnotationResponse:
    return ReviewAnnotationResponse.model_validate(annotation)


def _closed_round(exc: ReviewHandoffError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


def _get_handoff_or_404(
    db: Session,
    handoff_id: str,
    current_user: User,
) -> ReviewHandoff:
    handoff = get_handoff(db, handoff_id)
    if not handoff:
        raise HTTPException(status_code=404, detail="Handoff not found")
    require_handoff_access(db, user=current_user, handoff=handoff)
    return handoff


def _get_annotation_or_404(
    db: Session,
    handoff_id: str,
    annotation_id: str,
    current_user: User,
    *,
    reviewer_only: bool = False,
) -> ReviewAnnotation:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    if reviewer_only:
        require_reviewer(db, user=current_user, handoff=handoff)
    annotation = get_annotation(db, annotation_id)
    if not annotation or annotation.handoff_id != handoff_id:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return annotation


# ---------------------------------------------------------------------------
# Handoff CRUD
# ---------------------------------------------------------------------------


@router.post("/handoffs", response_model=ReviewHandoffResponse, status_code=status.HTTP_201_CREATED)
def post_handoff(
    schema: ReviewHandoffCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    try:
        handoff = create_handoff(db, user=current_user, schema=schema)
    except ReviewHandoffError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialise_handoff(handoff, db=db, user=current_user)


@router.get("/handoffs/reviews/waiting", response_model=ReviewWaitingCountResponse)
def get_reviews_waiting(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewWaitingCountResponse:
    return ReviewWaitingCountResponse(count=count_reviews_waiting(db, current_user))


@router.get("/handoffs", response_model=list[ReviewHandoffResponse])
def list_handoffs(
    action_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ReviewHandoffResponse]:
    if not action_id:
        raise HTTPException(status_code=400, detail="action_id is required")
    return [
        _serialise_handoff(h, db=db, user=current_user)
        for h in list_handoffs_for_action(db, action_id, user=current_user)
    ]


@router.get("/handoffs/{handoff_id}", response_model=ReviewHandoffResponse)
def get_one_handoff(
    handoff_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    return _serialise_handoff(
        _get_handoff_or_404(db, handoff_id, current_user), db=db, user=current_user
    )


@router.patch("/handoffs/{handoff_id}", response_model=ReviewHandoffResponse)
def patch_handoff(
    handoff_id: str,
    schema: ReviewHandoffUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    require_reviewer(db, user=current_user, handoff=handoff)
    try:
        if schema.status == "returned":
            updated = return_handoff_for_rework(db, handoff_id)
        elif schema.status:
            updated = update_handoff_status(
                db,
                handoff_id=handoff_id,
                status=schema.status,
                reviewer_id=schema.reviewer_id,
            )
        elif schema.reviewer_id is not None:
            updated = update_handoff_status(
                db,
                handoff_id=handoff_id,
                status=handoff.status,
                reviewer_id=schema.reviewer_id,
            )
        else:
            updated = handoff
    except ReviewHandoffError as exc:
        raise _closed_round(exc)
    if not updated:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return _serialise_handoff(updated, db=db, user=current_user)


@router.post("/handoffs/{handoff_id}/reject", response_model=ReviewHandoffResponse)
def post_reject_handoff(
    handoff_id: str,
    schema: ReviewHandoffRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    require_reviewer(db, user=current_user, handoff=handoff)
    try:
        updated = reject_handoff(db, handoff_id=handoff_id, reason=schema.reason)
    except ReviewHandoffError as exc:
        raise _closed_round(exc)
    if not updated:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return _serialise_handoff(updated, db=db, user=current_user)


@router.delete("/handoffs/{handoff_id}")
def remove_handoff(
    handoff_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    require_handoff_removal(db, user=current_user, handoff=handoff)
    if not delete_handoff(db, handoff_id):
        raise HTTPException(status_code=404, detail="Handoff not found")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------


@router.get(
    "/handoffs/{handoff_id}/annotations",
    response_model=list[ReviewAnnotationResponse],
)
def get_annotations(
    handoff_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ReviewAnnotationResponse]:
    _get_handoff_or_404(db, handoff_id, current_user)
    return [_serialise_annotation(a) for a in list_annotations(db, handoff_id=handoff_id)]


@router.post(
    "/handoffs/{handoff_id}/annotations",
    response_model=ReviewAnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_annotation(
    handoff_id: str,
    schema: ReviewAnnotationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewAnnotationResponse:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    require_reviewer(db, user=current_user, handoff=handoff)
    try:
        annotation = create_annotation(db, handoff=handoff, user=current_user, schema=schema)
    except ReviewHandoffError as exc:
        raise _closed_round(exc)
    return _serialise_annotation(annotation)


@router.patch(
    "/handoffs/{handoff_id}/annotations/{annotation_id}",
    response_model=ReviewAnnotationResponse,
)
def patch_annotation(
    handoff_id: str,
    annotation_id: str,
    schema: ReviewAnnotationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewAnnotationResponse:
    annotation = _get_annotation_or_404(
        db, handoff_id, annotation_id, current_user, reviewer_only=True
    )
    try:
        updated = update_annotation(db, annotation=annotation, schema=schema)
    except ReviewHandoffError as exc:
        raise _closed_round(exc)
    return _serialise_annotation(updated)


@router.delete("/handoffs/{handoff_id}/annotations/{annotation_id}")
def remove_annotation(
    handoff_id: str,
    annotation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    annotation = _get_annotation_or_404(
        db, handoff_id, annotation_id, current_user, reviewer_only=True
    )
    try:
        delete_annotation(db, annotation)
    except ReviewHandoffError as exc:
        raise _closed_round(exc)
    return {"status": "ok"}


@router.get(
    "/handoffs/{handoff_id}/annotations/{annotation_id}/history",
    response_model=list[ReviewAnnotationResponse],
)
def get_annotation_history_endpoint(
    handoff_id: str,
    annotation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ReviewAnnotationResponse]:
    """Earlier rounds of a carried-forward annotation (with their replies), newest first."""
    annotation = _get_annotation_or_404(db, handoff_id, annotation_id, current_user)
    return [
        _serialise_annotation(a)
        for a in get_annotation_history(db, user=current_user, annotation=annotation)
    ]


# ---------------------------------------------------------------------------
# Replies
# ---------------------------------------------------------------------------


@router.get(
    "/handoffs/{handoff_id}/annotations/{annotation_id}/replies",
    response_model=list[ReviewAnnotationReplyResponse],
)
def get_replies(
    handoff_id: str,
    annotation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ReviewAnnotationReplyResponse]:
    _get_annotation_or_404(db, handoff_id, annotation_id, current_user)
    return [
        ReviewAnnotationReplyResponse.model_validate(r)
        for r in list_replies(db, annotation_id=annotation_id)
    ]


@router.post(
    "/handoffs/{handoff_id}/annotations/{annotation_id}/replies",
    response_model=ReviewAnnotationReplyResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_reply_endpoint(
    handoff_id: str,
    annotation_id: str,
    schema: ReviewAnnotationReplyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewAnnotationReplyResponse:
    annotation = _get_annotation_or_404(
        db, handoff_id, annotation_id, current_user
    )
    try:
        reply = post_reply(
            db,
            annotation=annotation,
            user=current_user,
            body_markdown=schema.body_markdown,
        )
    except ReviewAnnotationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ReviewAnnotationReplyResponse.model_validate(reply)


@router.delete(
    "/handoffs/{handoff_id}/annotations/{annotation_id}/replies/{reply_id}"
)
def remove_reply(
    handoff_id: str,
    annotation_id: str,
    reply_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    _get_annotation_or_404(db, handoff_id, annotation_id, current_user)
    reply = db.get(ReviewAnnotationReply, reply_id)
    if not reply or reply.annotation_id != annotation_id:
        raise HTTPException(status_code=404, detail="Reply not found")
    try:
        delete_reply(db, reply=reply, user=current_user)
    except ReviewAnnotationError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Promote annotation to KB
# ---------------------------------------------------------------------------


@router.post(
    "/handoffs/{handoff_id}/annotations/{annotation_id}/promote",
    response_model=KnowledgeBankEntryResponse,
)
async def promote_annotation(
    handoff_id: str,
    annotation_id: str,
    schema: ReviewAnnotationPromoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    annotation = _get_annotation_or_404(
        db, handoff_id, annotation_id, current_user, reviewer_only=True
    )
    try:
        entry = await promote_annotation_to_kb(
            db,
            annotation=annotation,
            handoff=handoff,
            user=current_user,
            schema=schema,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return KnowledgeBankEntryResponse.model_validate(entry)


# ---------------------------------------------------------------------------
# Flattened PDF export
# ---------------------------------------------------------------------------


@router.post("/handoffs/{handoff_id}/export")
def post_export_pdf(
    handoff_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    handoff = _get_handoff_or_404(db, handoff_id, current_user)
    try:
        pdf_bytes = export_flattened_pdf(db, handoff=handoff)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    filename = (handoff.document.filename or "review").rsplit(".", 1)[0] + "_annotated.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
