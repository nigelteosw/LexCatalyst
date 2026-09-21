"""Review Annotation service.

Annotations are text-anchored marks (highlight / strike / suggestion) that
a senior reviewer places on a junior's uploaded PDF.  See
docs/plans/pdf-redlining-review.md §6.
"""

from datetime import UTC, datetime

from fastapi import HTTPException

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    KnowledgeBankEntry,
    ReviewAnnotation,
    ReviewAnnotationReply,
    ReviewHandoff,
    User,
)
from app.services.review_handoff_service import (
    get_handoff,
    lock_active_handoff,
    require_handoff_access,
)
from app.schemas import (
    KnowledgeBankEntryCreate,
    ReviewAnnotationCreate,
    ReviewAnnotationPromoteRequest,
    ReviewAnnotationUpdate,
)

MAX_NOTE = 10_000
MAX_BODY = 10_000


class ReviewAnnotationError(RuntimeError):
    pass


def _annotation_query():
    return select(ReviewAnnotation).options(
        joinedload(ReviewAnnotation.author),
        joinedload(ReviewAnnotation.replies).joinedload(ReviewAnnotationReply.author),
    )


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------


def list_annotations(
    db: Session, *, handoff_id: str
) -> list[ReviewAnnotation]:
    stmt = (
        _annotation_query()
        .where(ReviewAnnotation.handoff_id == handoff_id)
        .order_by(ReviewAnnotation.page_no, ReviewAnnotation.created_at)
    )
    return list(db.scalars(stmt).unique())


def get_annotation(db: Session, annotation_id: str) -> ReviewAnnotation | None:
    return db.scalar(
        _annotation_query().where(ReviewAnnotation.id == annotation_id)
    )


def create_annotation(
    db: Session,
    *,
    handoff: ReviewHandoff,
    user: User,
    schema: ReviewAnnotationCreate,
) -> ReviewAnnotation:
    lock_active_handoff(db, handoff.id)
    annotation = ReviewAnnotation(
        handoff_id=handoff.id,
        document_id=handoff.document_id,
        page_no=schema.page_no,
        kind=schema.kind,
        anchor_quote=schema.anchor_quote,
        anchor_rects=schema.anchor_rects,
        suggested_text=schema.suggested_text,
        note=schema.note,
        author_user_id=user.id,
        status="open",
    )
    db.add(annotation)

    # Flip handoff to in_review on first reviewer mark
    if handoff.status == "ready_for_review":
        handoff.status = "in_review"

    db.commit()
    db.refresh(annotation)
    return get_annotation(db, annotation.id)  # type: ignore[return-value]


def update_annotation(
    db: Session,
    *,
    annotation: ReviewAnnotation,
    schema: ReviewAnnotationUpdate,
) -> ReviewAnnotation:
    lock_active_handoff(db, annotation.handoff_id)
    payload = schema.model_dump(exclude_unset=True)
    for field, value in payload.items():
        setattr(annotation, field, value)
    annotation.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(annotation)
    return get_annotation(db, annotation.id)  # type: ignore[return-value]


def delete_annotation(db: Session, annotation: ReviewAnnotation) -> None:
    lock_active_handoff(db, annotation.handoff_id)
    db.delete(annotation)
    db.commit()


MAX_HISTORY_DEPTH = 20


def get_annotation_history(
    db: Session, *, user: User, annotation: ReviewAnnotation
) -> list[ReviewAnnotation]:
    """Earlier rounds of a carried-forward annotation, newest first.

    Each prior annotation lives on a previous handoff; the caller's access to
    that handoff is re-checked at every step, and the walk stops (without
    error) at the first round they cannot read.
    """
    history: list[ReviewAnnotation] = []
    previous_id = annotation.previous_annotation_id
    while previous_id and len(history) < MAX_HISTORY_DEPTH:
        previous = get_annotation(db, previous_id)
        if not previous:
            break
        handoff = get_handoff(db, previous.handoff_id)
        if not handoff:
            break
        try:
            require_handoff_access(db, user=user, handoff=handoff)
        except HTTPException:
            break
        history.append(previous)
        previous_id = previous.previous_annotation_id
    return history


# ---------------------------------------------------------------------------
# Replies
# ---------------------------------------------------------------------------


def list_replies(
    db: Session, *, annotation_id: str
) -> list[ReviewAnnotationReply]:
    stmt = (
        select(ReviewAnnotationReply)
        .options(joinedload(ReviewAnnotationReply.author))
        .where(ReviewAnnotationReply.annotation_id == annotation_id)
        .order_by(ReviewAnnotationReply.created_at)
    )
    return list(db.scalars(stmt).unique())


def post_reply(
    db: Session,
    *,
    annotation: ReviewAnnotation,
    user: User,
    body_markdown: str,
) -> ReviewAnnotationReply:
    if not body_markdown.strip():
        raise ReviewAnnotationError("Reply body cannot be empty")
    reply = ReviewAnnotationReply(
        annotation_id=annotation.id,
        author_user_id=user.id,
        body_markdown=body_markdown[:MAX_BODY],
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


def delete_reply(
    db: Session, *, reply: ReviewAnnotationReply, user: User
) -> None:
    if reply.author_user_id != user.id:
        raise ReviewAnnotationError("Only the author can delete their reply")
    db.delete(reply)
    db.commit()


# ---------------------------------------------------------------------------
# KB promotion
# ---------------------------------------------------------------------------


async def promote_annotation_to_kb(
    db: Session,
    *,
    annotation: ReviewAnnotation,
    handoff: ReviewHandoff,
    user: User,
    schema: ReviewAnnotationPromoteRequest,
) -> KnowledgeBankEntry:
    from app.services import knowledge_bank_service as kb

    if annotation.promoted_kb_entry_id:
        raise ReviewAnnotationError("This annotation has already been promoted")

    # Build body_markdown from annotation content
    parts: list[str] = []
    wording = annotation.suggested_text or annotation.anchor_quote
    if wording:
        parts.append(f"## Standard position\n\n{wording.strip()}")
    if annotation.note:
        parts.append(f"## Reasoning\n\n{annotation.note.strip()}")
    if annotation.anchor_quote and annotation.suggested_text:
        parts.append(
            "## Example clause (counter-example)\n\n> "
            + annotation.anchor_quote.strip().replace("\n", "\n> ")
        )
    body_markdown = "\n\n".join(parts) or "(empty)"

    title = schema.title or (
        (annotation.note or annotation.anchor_quote or "Promoted annotation").split(".")[0][:120]
    )

    kb_schema = KnowledgeBankEntryCreate(
        team_id=None,
        matter_id=handoff.matter_id if schema.target_scope == "matter" else None,
        scope=schema.target_scope,
        entry_type=schema.entry_type,
        title=title,
        body_markdown=body_markdown,
        tags=schema.tags,
    )

    if schema.target_scope == "matter":
        # Stays inside the matter's access boundary; no redaction needed.
        entry = await kb.create_kb_entry(db, user=user, schema=kb_schema)
    else:
        # Wider scopes must pass PII review before readers/search see the content.
        entry, _ = await kb.create_pending_review_entry(
            db, user=user, schema=kb_schema, source_matter_id=handoff.matter_id
        )
    annotation.promoted_kb_entry_id = entry.id
    annotation.updated_at = datetime.now(UTC)
    db.commit()
    return entry
