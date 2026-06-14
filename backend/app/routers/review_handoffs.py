"""Structured Review Handoff endpoints.

See `docs/rfc-review-handoff.md` for the design. In super-user mode any
authenticated matter member can submit and review; the reviewer fields
are still recorded so enforcement can layer on later.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ReviewFinding, User
from app.schemas import (
    KnowledgeBankEntryCreate,
    KnowledgeBankEntryResponse,
    ReviewFindingCreate,
    ReviewFindingResponse,
    ReviewFindingUpdate,
    ReviewHandoffCreate,
    ReviewHandoffPromoteRequest,
    ReviewHandoffResponse,
    ReviewHandoffUpdate,
    ReviewWaitingCountResponse,
)
from app.services.knowledge_bank_service import (
    KnowledgeBankError,
    KnowledgeBankScopeError,
    create_kb_entry,
)
from app.services.review_handoff_service import (
    ReviewHandoffError,
    count_reviews_waiting,
    create_finding,
    create_handoff,
    delete_finding,
    get_handoff,
    list_handoffs_for_action,
    restart_extraction,
    return_handoff_for_rework,
    update_finding,
    update_handoff_status,
)

router = APIRouter(tags=["review-handoffs"])


def _serialise(handoff) -> ReviewHandoffResponse:
    return ReviewHandoffResponse(
        id=handoff.id,
        action_id=handoff.action_id,
        matter_id=handoff.matter_id,
        document_id=handoff.document_id,
        submitted_by=handoff.submitted_by,
        submitted_at=handoff.submitted_at,
        status=handoff.status,
        reviewer_id=handoff.reviewer_id,
        completed_at=handoff.completed_at,
        error_message=handoff.error_message,
        created_at=handoff.created_at,
        updated_at=handoff.updated_at,
        submitter=handoff.submitter,
        reviewer=handoff.reviewer,
        findings=[ReviewFindingResponse.model_validate(f) for f in handoff.findings],
        document_filename=handoff.document.filename if handoff.document else None,
    )


@router.post(
    "/handoffs",
    response_model=ReviewHandoffResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_handoff(
    schema: ReviewHandoffCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    try:
        handoff = create_handoff(db, user=current_user, schema=schema)
    except ReviewHandoffError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialise(handoff)


@router.post("/handoffs/{handoff_id}/extract", response_model=ReviewHandoffResponse)
def post_handoff_extract(
    handoff_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    handoff = restart_extraction(db, handoff_id)
    if not handoff:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return _serialise(handoff)


@router.get("/handoffs/reviews/waiting", response_model=ReviewWaitingCountResponse)
def get_reviews_waiting(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewWaitingCountResponse:
    return ReviewWaitingCountResponse(count=count_reviews_waiting(db, current_user))


@router.get("/handoffs/{handoff_id}", response_model=ReviewHandoffResponse)
def get_one_handoff(
    handoff_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    handoff = get_handoff(db, handoff_id)
    if not handoff:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return _serialise(handoff)


@router.patch("/handoffs/{handoff_id}", response_model=ReviewHandoffResponse)
def patch_handoff(
    handoff_id: str,
    schema: ReviewHandoffUpdate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ReviewHandoffResponse:
    handoff = get_handoff(db, handoff_id)
    if not handoff:
        raise HTTPException(status_code=404, detail="Handoff not found")
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
        raise HTTPException(status_code=400, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Handoff not found")
    return _serialise(updated)


@router.get("/handoffs", response_model=list[ReviewHandoffResponse])
def list_handoffs(
    action_id: str | None = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[ReviewHandoffResponse]:
    """List handoffs.

    For now scoped to `action_id` only — the primary entry path is via an
    action item. A broader matter/user filter can layer on later.
    """
    if not action_id:
        raise HTTPException(status_code=400, detail="action_id is required")
    return [_serialise(h) for h in list_handoffs_for_action(db, action_id)]


@router.delete("/handoffs/{handoff_id}")
def remove_handoff(
    handoff_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    from app.services.review_handoff_service import delete_handoff

    if not delete_handoff(db, handoff_id):
        raise HTTPException(status_code=404, detail="Handoff not found")
    return {"status": "ok"}


@router.post(
    "/handoffs/{handoff_id}/findings",
    response_model=ReviewFindingResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_finding(
    handoff_id: str,
    schema: ReviewFindingCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ReviewFindingResponse:
    handoff = get_handoff(db, handoff_id)
    if not handoff:
        raise HTTPException(status_code=404, detail="Handoff not found")
    finding = create_finding(db, handoff=handoff, schema=schema)
    return ReviewFindingResponse.model_validate(finding)


@router.patch(
    "/handoffs/{handoff_id}/findings/{finding_id}",
    response_model=ReviewFindingResponse,
)
def patch_finding(
    handoff_id: str,
    finding_id: str,
    schema: ReviewFindingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReviewFindingResponse:
    finding = db.get(ReviewFinding, finding_id)
    if not finding or finding.handoff_id != handoff_id:
        raise HTTPException(status_code=404, detail="Finding not found")

    payload = schema.model_dump(exclude_unset=True)
    finding = update_finding(db, user=current_user, finding_id=finding_id, payload=payload)
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    # Flip the handoff into in_review on the first reviewer touch.
    handoff = get_handoff(db, handoff_id)
    if handoff and handoff.status == "ready_for_review":
        update_handoff_status(db, handoff_id=handoff_id, status="in_review")

    return ReviewFindingResponse.model_validate(finding)


@router.delete("/handoffs/{handoff_id}/findings/{finding_id}")
def remove_finding(
    handoff_id: str,
    finding_id: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    finding = db.get(ReviewFinding, finding_id)
    if not finding or finding.handoff_id != handoff_id:
        raise HTTPException(status_code=404, detail="Finding not found")
    delete_finding(db, finding_id)
    return {"status": "ok"}


@router.post(
    "/handoffs/{handoff_id}/findings/{finding_id}/promote",
    response_model=KnowledgeBankEntryResponse,
)
async def promote_finding_to_kb(
    handoff_id: str,
    finding_id: str,
    schema: ReviewHandoffPromoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeBankEntryResponse:
    handoff = get_handoff(db, handoff_id)
    finding = db.get(ReviewFinding, finding_id)
    if not handoff or not finding or finding.handoff_id != handoff_id:
        raise HTTPException(status_code=404, detail="Finding not found")
    if finding.status not in {"approved", "edited"}:
        raise HTTPException(
            status_code=400,
            detail="Only approved or edited findings can be promoted to the KB",
        )

    final_wording = finding.reviewer_edit or finding.proposed_revision or ""
    parts: list[str] = []
    if final_wording:
        parts.append("## Standard position\n\n" + final_wording.strip())
    if finding.reasoning:
        parts.append("## Reasoning\n\n" + finding.reasoning.strip())
    if finding.original_clause:
        parts.append(
            "## Example clause (counter-example)\n\n> "
            + finding.original_clause.strip().replace("\n", "\n> ")
        )
    if finding.citations:
        cite_lines = [
            f"- {(c.get('label') or '').strip()}"
            for c in finding.citations
            if isinstance(c, dict) and c.get("label")
        ]
        if cite_lines:
            parts.append("## Citations\n\n" + "\n".join(cite_lines))
    body_markdown = "\n\n".join(parts) or "(empty)"

    title = schema.title or (finding.reasoning.split(".")[0][:120] or "Promoted finding")

    kb_schema = KnowledgeBankEntryCreate(
        team_id=None,
        matter_id=handoff.matter_id if schema.target_scope == "matter" else None,
        scope=schema.target_scope,
        entry_type=schema.entry_type,
        title=title,
        body_markdown=body_markdown,
        tags=schema.tags,
        pii_status="clean" if schema.target_scope == "matter" else "pending_review",
    )
    try:
        entry = await create_kb_entry(db, user=current_user, schema=kb_schema)
    except KnowledgeBankScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except KnowledgeBankError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    finding.promoted_kb_entry_id = entry.id
    finding.updated_at = datetime.now(UTC)
    db.commit()

    return KnowledgeBankEntryResponse.model_validate(entry)
