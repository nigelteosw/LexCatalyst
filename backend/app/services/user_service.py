from sqlalchemy import update
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
