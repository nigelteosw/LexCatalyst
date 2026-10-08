import logging
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

_log = logging.getLogger(__name__)


def sync_metadata_safe(db: Session, sync_fn, *args, **kwargs) -> None:
    """Run a metadata sync in its own mini-transaction after the primary commit.
    Failures are logged and swallowed — the index is best-effort, never load-bearing."""
    try:
        sync_fn(db, *args, **kwargs)
        db.commit()
    except Exception as exc:
        db.rollback()
        _log.warning("Metadata sync skipped (%s): %s", getattr(sync_fn, "__name__", sync_fn), exc)

from app.models import (
    ActionItem,
    Document,
    KnowledgeBankEntry,
    MatterMember,
    ResourceMetadata,
    ReviewHandoff,
    TeamMember,
    User,
)

RESOURCE_DOCUMENT = "document"
RESOURCE_KB_ENTRY = "knowledge_bank_entry"
RESOURCE_ACTION_ITEM = "action_item"
RESOURCE_REVIEW_HANDOFF = "review_handoff"


def resource_metadata_access_filter(user: User):
    if user.is_admin:
        return ResourceMetadata.id.is_not(None)
    return or_(
        ResourceMetadata.scope == "firm_wide",
        ResourceMetadata.owner_user_id == user.id,
        ResourceMetadata.created_by == user.id,
        (
            (ResourceMetadata.team_id.is_not(None))
            & exists(
                select(TeamMember.id).where(
                    TeamMember.team_id == ResourceMetadata.team_id,
                    TeamMember.user_id == user.id,
                )
            )
        ),
        (
            (ResourceMetadata.matter_id.is_not(None))
            & exists(
                select(MatterMember.id).where(
                    MatterMember.matter_id == ResourceMetadata.matter_id,
                    MatterMember.user_id == user.id,
                )
            )
        ),
    )


def list_resource_metadata(
    db: Session,
    *,
    user: User,
    resource_type: str | None = None,
    matter_id: str | None = None,
    team_id: str | None = None,
    scope: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ResourceMetadata]:
    stmt = select(ResourceMetadata).where(resource_metadata_access_filter(user))
    if resource_type:
        stmt = stmt.where(ResourceMetadata.resource_type == resource_type)
    if matter_id:
        stmt = stmt.where(ResourceMetadata.matter_id == matter_id)
    if team_id:
        stmt = stmt.where(ResourceMetadata.team_id == team_id)
    if scope:
        stmt = stmt.where(ResourceMetadata.scope == scope)
    stmt = stmt.order_by(ResourceMetadata.updated_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(stmt))


def get_accessible_resource_metadata(
    db: Session,
    *,
    user: User,
    resource_type: str,
    resource_id: str,
) -> ResourceMetadata | None:
    return db.scalar(
        select(ResourceMetadata).where(
            ResourceMetadata.resource_type == resource_type,
            ResourceMetadata.resource_id == resource_id,
            resource_metadata_access_filter(user),
        )
    )


def upsert_resource_metadata(
    db: Session,
    *,
    resource_type: str,
    resource_id: str,
    title: str | None,
    owner_user_id: str | None,
    created_by: str | None,
    team_id: str | None,
    matter_id: str | None,
    scope: str | None,
    source_document_id: str | None,
    status: str | None,
    metadata_json: dict | None = None,
    commit: bool = False,
) -> ResourceMetadata:
    metadata = db.scalar(
        select(ResourceMetadata).where(
            ResourceMetadata.resource_type == resource_type,
            ResourceMetadata.resource_id == resource_id,
        )
    )
    if metadata is None:
        metadata = ResourceMetadata(
            resource_type=resource_type,
            resource_id=resource_id,
        )
        db.add(metadata)

    metadata.resource_type = resource_type
    metadata.resource_id = resource_id
    metadata.title = title
    metadata.owner_user_id = owner_user_id
    metadata.created_by = created_by
    metadata.team_id = team_id
    metadata.matter_id = matter_id
    metadata.scope = scope
    metadata.source_document_id = source_document_id
    metadata.status = status
    metadata.metadata_json = metadata_json or {}

    if commit:
        db.commit()
        db.refresh(metadata)
    return metadata


def delete_resource_metadata(
    db: Session,
    *,
    resource_type: str,
    resource_id: str,
    commit: bool = False,
) -> None:
    metadata = db.scalar(
        select(ResourceMetadata).where(
            ResourceMetadata.resource_type == resource_type,
            ResourceMetadata.resource_id == resource_id,
        )
    )
    if metadata is not None:
        db.delete(metadata)
    if commit:
        db.commit()


def sync_document_metadata(
    db: Session,
    document: Document,
    *,
    commit: bool = False,
) -> ResourceMetadata:
    return upsert_resource_metadata(
        db,
        resource_type=RESOURCE_DOCUMENT,
        resource_id=document.id,
        title=document.filename,
        owner_user_id=document.user_id,
        created_by=document.user_id,
        team_id=document.team_id,
        matter_id=document.matter_id,
        scope="matter" if document.matter_id else "private",
        source_document_id=document.id,
        status=document.status,
        commit=commit,
    )


def sync_kb_metadata(
    db: Session,
    entry: KnowledgeBankEntry,
    *,
    commit: bool = False,
) -> ResourceMetadata:
    return upsert_resource_metadata(
        db,
        resource_type=RESOURCE_KB_ENTRY,
        resource_id=entry.id,
        title=entry.title,
        owner_user_id=entry.created_by,
        created_by=entry.created_by,
        team_id=entry.team_id,
        matter_id=entry.matter_id,
        scope=entry.scope,
        source_document_id=entry.source_document_id,
        status=entry.status,
        metadata_json={
            "entry_type": entry.entry_type,
            "pii_status": entry.pii_status,
            "source_entry_id": entry.source_entry_id,
        },
        commit=commit,
    )



def sync_action_metadata(
    db: Session,
    item: ActionItem,
    *,
    commit: bool = False,
) -> ResourceMetadata:
    return upsert_resource_metadata(
        db,
        resource_type=RESOURCE_ACTION_ITEM,
        resource_id=item.id,
        title=item.title,
        owner_user_id=item.assigner_id,
        created_by=item.assigner_id,
        team_id=None,
        matter_id=item.matter_id,
        scope="matter" if item.matter_id else "firm_wide",
        source_document_id=None,
        status=item.status,
        metadata_json={
            "assignee_id": item.assignee_id,
            "priority": item.priority,
            "active_handoff_id": item.active_handoff_id,
        },
        commit=commit,
    )


def sync_handoff_metadata(
    db: Session,
    handoff: ReviewHandoff,
    *,
    commit: bool = False,
) -> ResourceMetadata:
    title = "Review handoff"
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action and action.title:
            title = action.title
    return upsert_resource_metadata(
        db,
        resource_type=RESOURCE_REVIEW_HANDOFF,
        resource_id=handoff.id,
        title=title,
        owner_user_id=handoff.submitted_by,
        created_by=handoff.submitted_by,
        team_id=None,
        matter_id=handoff.matter_id,
        scope="matter" if handoff.matter_id else "private",
        source_document_id=handoff.document_id,
        status=handoff.status,
        metadata_json={
            "action_id": handoff.action_id,
            "reviewer_id": handoff.reviewer_id,
            "completed_at": handoff.completed_at.isoformat()
            if handoff.completed_at
            else None,
        },
        commit=commit,
    )
