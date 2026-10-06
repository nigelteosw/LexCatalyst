"""Birdie draft reviews from the extension. Owner-only; a matter_id needs matter access."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_matter_member
from app.models import BirdieReview, User
from app.providers.openrouter import OpenRouterKeyMissing
from app.schemas import (
    BirdieReviewCreate,
    BirdieReviewResponse,
    BirdieSuggestionDecision,
    BirdieSuggestionReplyCreate,
    BirdieSuggestionReplyResponse,
    BirdieSuggestionResponse,
)
from app.services import birdie_review_service as svc
from app.services.llm_service import get_llm

router = APIRouter(tags=["birdie"])


def _review_response(review: BirdieReview) -> BirdieReviewResponse:
    data = BirdieReviewResponse.model_validate(
        {
            "id": review.id,
            "source_url": review.source_url,
            "title": review.title,
            "status": review.status,
            "error": review.error,
            "model": review.model,
            "stats": review.stats or {},
            "source_text": review.source_text,
            "current_text": svc.current_text(review),
            "created_at": review.created_at,
            "suggestions": [
                BirdieSuggestionResponse.model_validate(s, from_attributes=True)
                for s in review.suggestions
            ],
        }
    )
    return data


def _owned_review(db: Session, review_id: str, user: User) -> BirdieReview:
    review = svc.get_review(db, review_id, user.id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.post("/birdie/reviews", response_model=BirdieReviewResponse, status_code=202)
async def create_review(
    body: BirdieReviewCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BirdieReviewResponse:
    if body.matter_id:
        require_matter_member(db, current_user, body.matter_id)
    try:  # fail before any work if the user has no OpenRouter key
        llm = get_llm(db, current_user.id, feature="birdie_review", tier=body.tier, model=body.model)
    except OpenRouterKeyMissing as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    review = svc.create_review(
        db, user=current_user, url=body.url, title=body.title, text=body.text,
        matter_id=body.matter_id, model=llm.model,
    )
    background.add_task(svc.run_review, review.id)
    return _review_response(review)


@router.get("/birdie/reviews", response_model=BirdieReviewResponse | None)
def latest_review(
    url: str = Query(min_length=1, max_length=2048),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BirdieReviewResponse | None:
    review = svc.latest_review_for_url(db, url, current_user.id)
    return _review_response(review) if review else None


@router.delete("/birdie/reviews")
def reset_reviews(
    url: str = Query(min_length=1, max_length=2048),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Start over on a page: deletes only the caller's own reviews of that URL."""
    return {"deleted": svc.reset_reviews_for_url(db, url, current_user.id)}


@router.get("/birdie/reviews/{review_id}", response_model=BirdieReviewResponse)
def get_review(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BirdieReviewResponse:
    return _review_response(_owned_review(db, review_id, current_user))


@router.post("/birdie/reviews/{review_id}/accept-style", response_model=BirdieReviewResponse)
def accept_style(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BirdieReviewResponse:
    review = _owned_review(db, review_id, current_user)
    svc.accept_style_fixes(db, review, current_user.id)
    db.refresh(review)
    return _review_response(review)


@router.patch("/birdie/suggestions/{suggestion_id}", response_model=BirdieReviewResponse)
def decide_suggestion(
    suggestion_id: str,
    body: BirdieSuggestionDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BirdieReviewResponse:
    suggestion = svc.get_suggestion(db, suggestion_id, current_user.id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    svc.decide(db, suggestion, current_user.id, body.status)
    return _review_response(_owned_review(db, suggestion.review_id, current_user))


@router.post(
    "/birdie/suggestions/{suggestion_id}/replies",
    response_model=BirdieSuggestionReplyResponse,
    status_code=201,
)
def reply_to_suggestion(
    suggestion_id: str,
    body: BirdieSuggestionReplyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BirdieSuggestionReplyResponse:
    suggestion = svc.get_suggestion(db, suggestion_id, current_user.id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return BirdieSuggestionReplyResponse.model_validate(
        svc.add_reply(db, suggestion, current_user.id, body.body), from_attributes=True
    )
