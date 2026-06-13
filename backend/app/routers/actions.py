"""Firm-wide Jira-style action board."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, is_senior_or_above
from app.models import User
from app.schemas import ActionItemCreate, ActionItemResponse, ActionItemUpdate
from app.services.action_service import (
    create_action_item,
    delete_action_item,
    list_action_items,
    update_action_item,
)

router = APIRouter(tags=["actions"])


@router.get("/actions", response_model=list[ActionItemResponse])
def get_actions(
    matter_id: str | None = None,
    item_status: str | None = None,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[ActionItemResponse]:
    """Firm-wide board. Bounded to the most recent 500 tickets.

    Assignee and tag filters are intentionally not query params — the
    frontend applies them in memory off the cached page so filter chips
    don't trigger a roundtrip.
    """
    items = list_action_items(db, matter_id=matter_id, status=item_status)
    return [ActionItemResponse.model_validate(item) for item in items]


@router.post("/actions", response_model=ActionItemResponse, status_code=status.HTTP_201_CREATED)
def post_action(
    schema: ActionItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActionItemResponse:
    if not is_senior_or_above(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Partner or senior associate access required",
        )
    item = create_action_item(db, user=current_user, schema=schema)
    return ActionItemResponse.model_validate(item)


@router.patch("/actions/{item_id}", response_model=ActionItemResponse)
def patch_action(
    item_id: str,
    schema: ActionItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ActionItemResponse:
    item = update_action_item(db, user=current_user, item_id=item_id, schema=schema)
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found or access denied")
    return ActionItemResponse.model_validate(item)


@router.delete("/actions/{item_id}")
def delete_action(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    if not delete_action_item(db, user=current_user, item_id=item_id):
        raise HTTPException(status_code=404, detail="Action item not found or access denied")
    return {"status": "ok"}
