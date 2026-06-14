from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import MatterMember, TeamMember, User


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


def create_dummy_users(db: Session, count: int = 5) -> list[User]:
    """Create a batch of dummy users for testing/demo.
    
    Dummy users are identified by 'dummy:' prefix in their google_id.
    """
    from uuid import uuid4
    
    names = [
        "James Sterling", "Elena Rodriguez", "Marcus Thorne", "Sarah Jenkins",
        "David Cho", "Maya Patel", "Robert Vance", "Isabella Rossi",
        "Thomas Wright", "Olivia Chen"
    ]
    roles = ["associate", "senior_associate", "partner"]
    
    new_users = []
    for i in range(min(count, len(names))):
        u = User(
            email=f"dummy.{i+1}@lexcatalyst.local",
            full_name=names[i],
            google_id=f"dummy:{uuid4()}",
            firm_role=roles[i % len(roles)],
            is_admin=False
        )
        db.add(u)
        new_users.append(u)
    
    db.commit()
    for u in new_users:
        db.refresh(u)
    return new_users


def delete_dummy_users(db: Session) -> int:
    """Delete all users with the 'dummy:' google_id prefix."""
    from sqlalchemy import delete
    
    stmt = delete(User).where(User.google_id.like("dummy:%"))
    result = db.execute(stmt)
    db.commit()
    return result.rowcount
