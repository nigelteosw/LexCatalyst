from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import MatterMember, TeamMember, User

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
    # Third respondent so wellbeing trends clear the minimum anonymity cohort (3).
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


def list_firm_users(db: Session) -> list[User]:
    """Every user in the firm, ordered by name then email.

    Used to populate assignee pickers and members views. No RBAC — anyone
    authenticated can see the firm roster, the same way they would in a
    real firm's internal directory.
    """
    stmt = select(User).order_by(User.full_name, User.email)
    return list(db.scalars(stmt))


def create_dummy_users(db: Session, count: int = len(DUMMY_USERS)) -> list[User]:
    """Create or refresh the named demo users without producing duplicates."""
    from app.services.organization_service import ensure_default_team

    users: list[User] = []
    for seed in DUMMY_USERS[: max(0, min(count, len(DUMMY_USERS)))]:
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

        ensure_default_team(db, user)
        users.append(user)

    return users


def delete_dummy_users(db: Session) -> int:
    """Delete all users with the 'dummy:' google_id prefix."""
    stmt = delete(User).where(User.google_id.like("dummy:%"))
    result = db.execute(stmt)
    db.commit()
    return result.rowcount
