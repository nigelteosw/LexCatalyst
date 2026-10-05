"""Birdie's shared Workboard tool surface (web and extension).

Unlike the firm-wide board, Birdie only reads/manages the acting user's
currently assigned tickets. No manager/assigner bypass is permitted.
"""
import json
from datetime import datetime, timezone
from typing import Literal

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.dependencies import is_partner_or_admin, require_matter_member
from app.models import ActionItem, Matter, MatterMember, User
from app.schemas import ActionItemCreate, ActionItemResponse, ActionPriority, ActionStatus
from app.services.action_service import create_action_item
from app.services.resource_metadata_service import (
    RESOURCE_ACTION_ITEM, delete_resource_metadata, sync_action_metadata, sync_metadata_safe,
)


class ToolInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class TicketQuery(ToolInput):
    scope: Literal['current', 'all'] = 'current'
    status: ActionStatus | None = None


class TicketId(ToolInput):
    ticket_id: str = Field(min_length=1, max_length=36)


class TicketCreate(ToolInput):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    matter_id: str | None = Field(default=None, max_length=36)
    priority: ActionPriority = 'medium'
    due_date: AwareDatetime | None = None


class TicketChanges(ToolInput):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    status: ActionStatus | None = None
    assignee_id: str | None = Field(default=None, min_length=1, max_length=36)
    priority: ActionPriority | None = None
    due_date: AwareDatetime | None = None

    @model_validator(mode='after')
    def validate_changes(self):
        if not self.model_fields_set:
            raise ValueError('Provide at least one field to change')
        for name in ('title', 'status', 'assignee_id', 'priority'):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f'{name} cannot be null')
        return self


class TicketUpdate(TicketId):
    changes: TicketChanges


class AssigneeQuery(ToolInput):
    query: str = Field(min_length=1, max_length=200)


def _tool(name: str, description: str, schema: type[BaseModel]) -> dict:
    parameters = schema.model_json_schema()
    definitions = parameters.pop('$defs', {})

    def inline(value):
        if isinstance(value, dict):
            if '$ref' in value:
                return inline(definitions[value['$ref'].split('/')[-1]])
            return {k: inline(v) for k, v in value.items()}
        if isinstance(value, list):
            return [inline(v) for v in value]
        return value

    return {'type': 'function', 'function': {
        'name': name, 'description': description, 'parameters': inline(parameters),
    }}


WORKBOARD_TOOLS = [
    _tool('list_workboard_tickets', 'Read live tickets currently assigned to you, including IDs, descriptions and status. Default scope=current is the current matter (General if none). Use scope=all only when the user explicitly requests tickets across matters. Results are bounded; total/truncated identify partial lists.', TicketQuery),
    _tool('get_workboard_progress', 'Read live progress counts for your assigned tickets, including completed, outstanding, overdue and status totals. Default scope=current; scope=all requires an explicit across-matters request. Counts cover every matching ticket.', TicketQuery),
    _tool('get_workboard_ticket', 'Read a specific ticket currently assigned to you. Obtain its ID from a live lookup; never guess an ID.', TicketId),
    _tool('create_workboard_ticket', 'Create a new ticket assigned to you. Omit matter_id to use the current matter; null explicitly selects General. Never create tickets unless the user requests creation.', TicketCreate),
    _tool('update_workboard_ticket', 'Edit your assigned ticket title/description, move status, change priority/due date, or reassign to a verified colleague ID. Omitted fields stay unchanged. Reassignment immediately ends your access. Only perform changes explicitly requested by the user. Review-linked tickets require the review workflow for status/reassignment.', TicketUpdate),
    _tool('delete_workboard_ticket', 'Delete your assigned ticket only on an explicit user request. Review-linked tickets cannot be deleted here.', TicketId),
    _tool('find_workboard_assignees', 'Find colleagues by name or email to resolve a reassignment target. If multiple people match, ask the user which one; never guess an ID.', AssigneeQuery),
]


def _require_matter(db: Session, user: User, matter_id: str | None) -> None:
    if matter_id is not None:
        if db.get(Matter, matter_id) is None:
            raise ValueError('Matter not found or access denied')
        require_matter_member(db, user, matter_id)


def _owned_filter(db: Session, user: User, matter_id: str | None, scope: str):
    conditions = [ActionItem.assignee_id == user.id]
    if scope == 'current':
        _require_matter(db, user, matter_id)
        conditions.append(ActionItem.matter_id == matter_id)
    if not is_partner_or_admin(user):
        memberships = select(MatterMember.matter_id).where(MatterMember.user_id == user.id)
        conditions.append(or_(ActionItem.matter_id.is_(None), ActionItem.matter_id.in_(memberships)))
    return conditions


def _owned_ticket(db: Session, user: User, ticket_id: str, *, lock: bool = False) -> ActionItem:
    stmt = select(ActionItem).where(ActionItem.id == ticket_id, ActionItem.assignee_id == user.id)
    if lock:
        # Refresh cached rows after acquiring the lock: an earlier reassignment
        # must revoke access even when this Session has previously read the item.
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    item = db.scalar(stmt)
    if item is None:
        raise ValueError('Ticket not found or not currently assigned to you')
    _require_matter(db, user, item.matter_id)
    return item


def _ticket_payload(item: ActionItem) -> dict:
    return ActionItemResponse.model_validate(item).model_dump(mode='json')


def _execute(name: str, args: dict, *, db: Session, user: User, matter_id: str | None) -> dict:
    if name in ('list_workboard_tickets', 'get_workboard_progress'):
        query = TicketQuery.model_validate_json(json.dumps(args))
        conditions = _owned_filter(db, user, matter_id, query.scope)
        if query.status:
            conditions.append(ActionItem.status == query.status)
        counts = dict(db.execute(select(ActionItem.status, func.count()).where(*conditions).group_by(ActionItem.status)).all())
        total = sum(counts.values())
        if name == 'get_workboard_progress':
            overdue = db.scalar(select(func.count()).select_from(ActionItem).where(
                *conditions, ActionItem.status != 'done', ActionItem.due_date < datetime.now(timezone.utc),
            )) or 0
            return {'scope': query.scope, 'matter_id': matter_id if query.scope == 'current' else None,
                    'total': total, 'by_status': counts, 'completed': counts.get('done', 0),
                    'outstanding': total - counts.get('done', 0), 'overdue': overdue}
        items = list(db.scalars(select(ActionItem).where(*conditions).order_by(ActionItem.updated_at.desc(), ActionItem.id).limit(50)))
        return {'tickets': [_ticket_payload(i) for i in items], 'total': total, 'truncated': total > len(items)}

    if name == 'find_workboard_assignees':
        query = AssigneeQuery.model_validate_json(json.dumps(args))
        # Directory access follows the existing signed-in firm directory policy.
        users = list(db.scalars(select(User).where(or_(
            User.full_name.icontains(query.query.strip(), autoescape=True),
            User.email.icontains(query.query.strip(), autoescape=True),
        )).order_by(User.full_name, User.email).limit(20)))
        return {'users': [{'id': u.id, 'name': u.full_name, 'email': u.email} for u in users]}

    if name == 'create_workboard_ticket':
        schema = TicketCreate.model_validate_json(json.dumps(args))
        target_matter = schema.matter_id if 'matter_id' in schema.model_fields_set else matter_id
        _require_matter(db, user, target_matter)
        payload = schema.model_dump(exclude={'matter_id'})
        item = create_action_item(db, user=user, schema=ActionItemCreate(
            **payload, assignee_id=user.id, matter_id=target_matter,
        ))
        return {'ticket': _ticket_payload(item), 'changed': True}

    if name == 'get_workboard_ticket':
        schema = TicketId.model_validate_json(json.dumps(args))
        return {'ticket': _ticket_payload(_owned_ticket(db, user, schema.ticket_id))}

    if name == 'update_workboard_ticket':
        schema = TicketUpdate.model_validate_json(json.dumps(args))
        item = _owned_ticket(db, user, schema.ticket_id, lock=True)
        changes = schema.changes.model_dump(exclude_unset=True)
        if item.active_handoff_id and {'status', 'assignee_id'} & changes.keys():
            raise ValueError('This ticket is linked to a review. Use the review workflow to move or reassign it.')
        if 'assignee_id' in changes:
            target = db.get(User, changes['assignee_id'])
            if target is None:
                raise ValueError('Assignee not found')
            _require_matter(db, target, item.matter_id)
        for field, value in changes.items():
            setattr(item, field, value)
        db.commit()
        sync_metadata_safe(db, sync_action_metadata, item)
        return {'ticket': _ticket_payload(item), 'changed': True}

    if name == 'delete_workboard_ticket':
        schema = TicketId.model_validate_json(json.dumps(args))
        item = _owned_ticket(db, user, schema.ticket_id, lock=True)
        if item.active_handoff_id:
            raise ValueError('This ticket is linked to a review. Resolve the review before deleting it.')
        delete_resource_metadata(db, resource_type=RESOURCE_ACTION_ITEM, resource_id=item.id)
        db.delete(item)
        db.commit()
        return {'ticket_id': schema.ticket_id, 'changed': True}

    raise ValueError('Unknown Workboard tool')


def execute_workboard_tool(name: str, args: dict, *, db: Session, user: User, matter_id: str | None) -> dict:
    """Validate model arguments and enforce access independently of the prompt."""
    try:
        return _execute(name, args, db=db, user=user, matter_id=matter_id)
    except ValidationError as exc:
        db.rollback()
        return {'error': 'Invalid tool arguments', 'details': [e['msg'] for e in exc.errors()]}
    except (ValueError, HTTPException) as exc:
        db.rollback()
        return {'error': str(exc.detail) if isinstance(exc, HTTPException) else str(exc)}
