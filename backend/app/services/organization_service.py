from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from app.dependencies import require_matter_member
from app.models import (
    KnowledgeBankEntry,
    ClassMembership,
    Matter,
    MatterMember,
    ResourceMetadata,
    Team,
    TeamMember,
    User,
)
from app.schemas import MatterCreate, MatterMemberCreate, MatterUpdate
from app.services.mentorship_class_service import require_class_context, ClassAccessError

DEFAULT_TEAM_NAME = "LexCatalyst Legal"


def ensure_default_team(db: Session, user: User) -> Team:
    context = require_class_context(db, user)
    if user.default_team_id:
        team = db.get(Team, user.default_team_id)
        if team and team.class_id == context.class_id:
            return team

    team = db.scalar(select(Team).where(Team.class_id == context.class_id, Team.name == DEFAULT_TEAM_NAME))
    if not team:
        team = Team(class_id=context.class_id, name=DEFAULT_TEAM_NAME, practice_area="General practice")
        db.add(team)
        db.flush()

    membership = db.scalar(
        select(TeamMember).where(
            TeamMember.team_id == team.id,
            TeamMember.user_id == user.id,
        )
    )
    if not membership:
        db.add(TeamMember(team_id=team.id, user_id=user.id, role=user.firm_role))

    user.default_team_id = team.id
    db.commit()
    db.refresh(team)
    return team


def list_teams(db: Session, user: User) -> list[Team]:
    context = require_class_context(db, user)
    stmt = select(Team).where(Team.class_id == context.class_id).order_by(Team.name)
    stmt = stmt.where(
        select(TeamMember.id)
        .where(TeamMember.team_id == Team.id, TeamMember.user_id == user.id)
        .exists()
    )
    return list(db.scalars(stmt))


def list_matters(db: Session, user: User, status: str | None = None) -> list[Matter]:
    context = require_class_context(db, user)
    stmt = select(Matter).options(joinedload(Matter.team)).where(Matter.class_id == context.class_id)
    if status:
        stmt = stmt.where(Matter.status == status)
    stmt = stmt.where(
        select(MatterMember.id)
        .where(MatterMember.matter_id == Matter.id, MatterMember.user_id == user.id)
        .exists()
    )
    return list(db.scalars(stmt.order_by(Matter.updated_at.desc())))


def get_matter(db: Session, matter_id: str) -> Matter | None:
    stmt = (
        select(Matter)
        .options(joinedload(Matter.team))
        .where(Matter.id == matter_id)
    )
    return db.scalar(stmt)


def create_matter(db: Session, user: User, schema: MatterCreate) -> Matter:
    context = require_class_context(db, user)
    default_team = ensure_default_team(db, user)
    team_id = schema.team_id or default_team.id
    team = db.get(Team, team_id)
    if not team or team.class_id != context.class_id:
        raise ClassAccessError("Team not found", 404)
    matter = Matter(
        class_id=context.class_id,
        team_id=team_id,
        title=schema.title,
        case_number=schema.case_number,
        client_name=schema.client_name,
    )
    db.add(matter)
    db.flush()
    db.add(
        MatterMember(
            matter_id=matter.id,
            user_id=user.id,
            role=user.firm_role,
            granted_by=user.id,
        )
    )
    db.commit()
    return get_matter(db, matter.id) or matter


def update_matter(
    db: Session,
    matter_id: str,
    schema: MatterUpdate,
) -> Matter | None:
    matter = db.get(Matter, matter_id)
    if not matter:
        return None

    for field, value in schema.model_dump(exclude_unset=True).items():
        setattr(matter, field, value)
    db.commit()
    return get_matter(db, matter.id)


def list_matter_members(db: Session, matter_id: str) -> list[MatterMember]:
    stmt = (
        select(MatterMember)
        .where(MatterMember.matter_id == matter_id)
        .order_by(MatterMember.granted_at)
    )
    return list(db.scalars(stmt))


def add_matter_member(
    db: Session,
    *,
    matter_id: str,
    granted_by: str,
    schema: MatterMemberCreate,
) -> MatterMember:
    actor = db.get(User, granted_by)
    if actor is None:
        raise ClassAccessError("Matter not found", 404)
    require_matter_member(db, actor, matter_id)
    context = require_class_context(db, actor)
    if not db.scalar(select(ClassMembership.id).where(
        ClassMembership.class_id == context.class_id,
        ClassMembership.user_id == schema.user_id,
        ClassMembership.status == "active",
    )):
        raise ClassAccessError("User not found", 404)
    membership = db.scalar(
        select(MatterMember).where(
            MatterMember.matter_id == matter_id,
            MatterMember.user_id == schema.user_id,
        )
    )
    if membership:
        membership.role = schema.role
    else:
        membership = MatterMember(
            matter_id=matter_id,
            user_id=schema.user_id,
            role=schema.role,
            granted_by=granted_by,
        )
        db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def remove_matter_member(db: Session, matter_id: str, user_id: str) -> bool:
    membership = db.scalar(
        select(MatterMember).where(
            MatterMember.matter_id == matter_id,
            MatterMember.user_id == user_id,
        )
    )
    if not membership:
        return False
    db.delete(membership)
    db.commit()
    return True


def delete_matter(db: Session, matter_id: str) -> bool:
    """Hard-delete a matter. Linked records fall back to General.

    FKs with ON DELETE SET NULL clear matter_id on chats, documents, KB
    entries, actions and reviews. Matter-scoped KB entries and resource metadata become
    private so they are not exposed more widely than before.
    """
    matter = db.get(Matter, matter_id)
    if not matter:
        return False
    db.execute(
        update(KnowledgeBankEntry)
        .where(KnowledgeBankEntry.matter_id == matter_id, KnowledgeBankEntry.scope == "matter")
        .values(scope="private")
    )
    db.execute(
        update(ResourceMetadata)
        .where(ResourceMetadata.matter_id == matter_id, ResourceMetadata.scope == "matter")
        .values(scope="private")
    )
    db.delete(matter)
    db.commit()
    return True
