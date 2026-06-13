"""Firm-wide Jira-style action board.

Visibility model:
  - **List/read**: every authenticated user sees every action item. The
    point of the board is workload transparency across the team.
  - **Create / reassign / delete**: gated to seniors+ at the route layer.
  - **Status update**: the assignee can move their own ticket through the
    kanban; seniors+ can move any ticket.
"""

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, joinedload

from app.dependencies import is_senior_or_above
from app.models import ActionItem, User
from app.schemas import ActionItemCreate, ActionItemUpdate


def _action_query():
    return select(ActionItem).options(
        joinedload(ActionItem.assignee),
        joinedload(ActionItem.assigner),
    )


def list_action_items(
    db: Session,
    *,
    matter_id: str | None = None,
    status: str | None = None,
    assignee_id: str | None = None,
    tag: str | None = None,
) -> list[ActionItem]:
    """List all action items in the firm with optional filters.

    Filters are stackable. None of them are RBAC; the board is visible to
    every authenticated user by design.
    """
    stmt = _action_query()
    if matter_id:
        stmt = stmt.where(ActionItem.matter_id == matter_id)
    if status:
        stmt = stmt.where(ActionItem.status == status)
    if assignee_id:
        stmt = stmt.where(ActionItem.assignee_id == assignee_id)

    items = list(db.scalars(stmt.order_by(desc(ActionItem.created_at))))
    if tag:
        wanted = tag.strip().lower()
        items = [
            item for item in items
            if any(t.lower() == wanted for t in (item.tags or []))
        ]
    return items


def get_action_item(db: Session, item_id: str) -> ActionItem | None:
    return db.scalar(_action_query().where(ActionItem.id == item_id))


def create_action_item(
    db: Session,
    *,
    user: User,
    schema: ActionItemCreate,
) -> ActionItem:
    item = ActionItem(
        title=schema.title,
        description=schema.description,
        assignee_id=schema.assignee_id,
        assigner_id=user.id,
        matter_id=schema.matter_id,
        due_date=schema.due_date,
        priority=schema.priority,
        tags=_normalise_tags(schema.tags),
    )
    db.add(item)
    db.commit()
    return get_action_item(db, item.id) or item


def update_action_item(
    db: Session,
    *,
    user: User,
    item_id: str,
    schema: ActionItemUpdate,
) -> ActionItem | None:
    """Update an action item.

    - The assignee can update *only* the status field (kanban movement).
    - Seniors+ and admins can update any field.
    - Other users get a 403 (None return → caller maps to 404/403).
    """
    item = db.get(ActionItem, item_id)
    if not item:
        return None

    is_assignee = item.assignee_id == user.id
    is_manager = is_senior_or_above(user)
    if not (is_assignee or is_manager):
        return None

    payload = schema.model_dump(exclude_unset=True)

    # An assignee who is not also a manager can only flip the status.
    if is_assignee and not is_manager:
        allowed_fields = {"status"}
        rejected = set(payload) - allowed_fields
        if rejected:
            # Silently strip rather than 403; the kanban drag-and-drop
            # only ever sends `status`, so this is a defensive guard.
            payload = {k: v for k, v in payload.items() if k in allowed_fields}

    if "tags" in payload:
        payload["tags"] = _normalise_tags(payload["tags"] or [])

    for field, value in payload.items():
        setattr(item, field, value)
    db.commit()
    return get_action_item(db, item.id)


def delete_action_item(db: Session, *, user: User, item_id: str) -> bool:
    item = db.get(ActionItem, item_id)
    if not item:
        return False
    if not (is_senior_or_above(user) or user.is_admin):
        return False
    db.delete(item)
    db.commit()
    return True


def _normalise_tags(tags: list[str]) -> list[str]:
    """Trim, dedupe (case-insensitive), preserve insertion order."""
    seen: set[str] = set()
    out: list[str] = []
    for tag in tags:
        if not isinstance(tag, str):
            continue
        cleaned = tag.strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out
