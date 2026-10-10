from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import ClassMembership, MatterMember, TeamMember, User
from app.services.mentorship_class_service import require_class_context

DUMMY_USERS = (
    {
        "email": "sarah.chen@lexcatalyst.local",
        "full_name": "Sarah Chen",
        "google_id": "dummy:sarah-chen",
        "firm_role": "senior_associate",
    },
    {
        "email": "jane.pereira@lexcatalyst.local",
        "full_name": "Jane Pereira",
        "google_id": "dummy:jane-pereira",
        "firm_role": "associate",
    },
    {
        "email": "marcus.webb@lexcatalyst.local",
        "full_name": "Marcus Webb",
        "google_id": "dummy:marcus-webb",
        "firm_role": "associate",
    },
)


def update_user_role(db: Session, *, user: User, firm_role: str) -> User:
    if firm_role == "admin":
        user.is_admin = True
        user.firm_role = "partner"  # Admins are effectively partners for permissions
    else:
        user.is_admin = False
        user.firm_role = firm_role

    db.execute(
        update(TeamMember)
        .where(TeamMember.user_id == user.id)
        .values(role=user.firm_role)
    )
    db.execute(
        update(MatterMember)
        .where(MatterMember.user_id == user.id)
        .values(role=user.firm_role)
    )
    db.commit()
    db.refresh(user)
    return user


def list_firm_users(db: Session, *, user: User) -> list[User]:
    """Only active members of the caller's mentorship team."""
    from app.models import ClassMembership
    from app.services.mentorship_class_service import require_class_context

    context = require_class_context(db, user)
    stmt = (
        select(User)
        .join(ClassMembership, ClassMembership.user_id == User.id)
        .where(ClassMembership.class_id == context.class_id, ClassMembership.status == "active")
        .order_by(User.full_name, User.email)
    )
    return list(db.scalars(stmt))


def create_dummy_users(db: Session, count: int = len(DUMMY_USERS), *, actor: User) -> list[User]:
    """Create separate synthetic accounts inside the actor's approved class."""
    from app.services.organization_service import ensure_default_team

    users: list[User] = []
    context = require_class_context(db, actor)
    for template in DUMMY_USERS[: max(0, min(count, len(DUMMY_USERS)))]:
        local, domain = template["email"].split("@", 1)
        seed = {**template, "email": f"{local}.{context.class_id}@{domain}",
                "google_id": f"{template['google_id']}:{context.class_id}"}
        user = db.scalar(
            select(User).where(
                (User.google_id == seed["google_id"]) | (User.email == seed["email"])
            )
        )
        if not user:
            user = User(**seed, is_admin=False)
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.email = seed["email"]
            user.full_name = seed["full_name"]
            user.google_id = seed["google_id"]
            user.firm_role = seed["firm_role"]
            user.is_admin = False
            db.commit()
            db.refresh(user)

        membership = db.scalar(select(ClassMembership).where(
            ClassMembership.class_id == context.class_id, ClassMembership.user_id == user.id,
        ))
        if membership is None:
            db.add(ClassMembership(class_id=context.class_id, user_id=user.id, role="member", status="active"))
        else:
            membership.status = "active"
            membership.role = "member"
            membership.removed_at = None
        db.commit()
        ensure_default_team(db, user)
        users.append(user)

    return users


def delete_dummy_users(db: Session, *, actor: User) -> int:
    """Delete only synthetic users created for the actor's class."""
    context = require_class_context(db, actor)
    stmt = delete(User).where(User.google_id.like(f"dummy:%:{context.class_id}"))
    result = db.execute(stmt)
    db.commit()
    return result.rowcount
