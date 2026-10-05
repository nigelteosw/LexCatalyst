"""Precedent: the firm's past drafting of the highlighted clause. Signed-in users only."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import PrecedentSearchRequest, PrecedentSearchResponse
from app.services.audit_service import record_retrieval
from app.services.precedent_service import precedent_payload, search_precedents

router = APIRouter(tags=["precedent"])


@router.post("/precedent/search", response_model=PrecedentSearchResponse)
async def precedent_search(
    body: PrecedentSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    clause_type, results = await search_precedents(db, user=current_user, text=body.text)
    record_retrieval(
        db,
        user_id=current_user.id,
        kind="precedent_search",
        query=body.text,
        returned_ids=[r.id for r in results],
    )
    return precedent_payload(clause_type, results)
