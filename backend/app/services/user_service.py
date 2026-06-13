from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import MatterMember, TeamMember, User


def update_user_role(db: Session, *, user: User, firm_role: str) -> User:
    user.firm_role = firm_role
    db.execute(
        update(TeamMember)
        .where(TeamMember.user_id == user.id)
        .values(role=firm_role)
    )
    db.execute(
        update(MatterMember)
        .where(MatterMember.user_id == user.id)
        .values(role=firm_role)
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
