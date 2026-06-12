from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import ActionItem, MatterMember, User
from app.schemas import ActionItemCreate, ActionItemUpdate


def _action_query():
    return select(ActionItem).options(
        joinedload(ActionItem.assignee),
        joinedload(ActionItem.assigner),
    )


def list_action_items(
    db: Session,
    *,
    user: User,
    matter_id: str | None = None,
    status: str | None = None,
) -> list[ActionItem]:
    if user.is_admin:
        stmt = _action_query()
    else:
        user_matter_ids = list(
            db.scalars(select(MatterMember.matter_id).where(MatterMember.user_id == user.id))
        )
        visible = [
            ActionItem.assigner_id == user.id,
            ActionItem.assignee_id == user.id,
        ]
        if user_matter_ids:
            visible.append(ActionItem.matter_id.in_(user_matter_ids))
        stmt = _action_query().where(or_(*visible))

    if matter_id:
        stmt = stmt.where(ActionItem.matter_id == matter_id)
    if status:
        stmt = stmt.where(ActionItem.status == status)

    return list(db.scalars(stmt.order_by(desc(ActionItem.created_at))))


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
    item = db.get(ActionItem, item_id)
    if not item:
        return None
    if not user.is_admin and item.assigner_id != user.id and item.assignee_id != user.id:
        return None
    for field, value in schema.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    return get_action_item(db, item.id)


def delete_action_item(db: Session, *, user: User, item_id: str) -> bool:
    item = db.get(ActionItem, item_id)
    if not item:
        return False
    if not user.is_admin and item.assigner_id != user.id:
        return False
    db.delete(item)
    db.commit()
    return True
