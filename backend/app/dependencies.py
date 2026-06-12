from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import KnowledgeBankEntry, MatterMember, TeamMember, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/google")

PARTNER_ROLES = {"partner"}
SENIOR_ROLES = {"partner", "senior_associate"}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    settings = get_settings()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    return user


def is_partner_or_admin(user: User) -> bool:
    return user.is_admin or user.firm_role in PARTNER_ROLES


def is_senior_or_above(user: User) -> bool:
    return user.is_admin or user.firm_role in SENIOR_ROLES


def require_partner_or_admin(user: User) -> None:
    if not is_partner_or_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Partner or admin access required")


def _is_matter_member(db: Session, user_id: str, matter_id: str) -> bool:
    return db.scalar(
        select(MatterMember.id).where(
            MatterMember.matter_id == matter_id,
            MatterMember.user_id == user_id,
        )
    ) is not None


def _is_team_member(db: Session, user_id: str, team_id: str) -> bool:
    return db.scalar(
        select(TeamMember.id).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
        )
    ) is not None


def check_kb_read(db: Session, user: User, entry: KnowledgeBankEntry) -> bool:
    if user.is_admin:
        return True
    if entry.scope == "firm_wide":
        return True
    if entry.scope == "private":
        return entry.created_by == user.id
    if entry.scope == "team" and entry.team_id:
        return _is_team_member(db, user.id, entry.team_id)
    if entry.scope == "matter" and entry.matter_id:
        return _is_matter_member(db, user.id, entry.matter_id)
    return False


def check_kb_write(db: Session, user: User, entry: KnowledgeBankEntry) -> bool:
    if user.is_admin:
        return True
    if entry.scope == "firm_wide":
        return user.firm_role in PARTNER_ROLES
    if entry.scope == "private":
        return entry.created_by == user.id
    if entry.scope == "team" and entry.team_id:
        return _is_team_member(db, user.id, entry.team_id)
    if entry.scope == "matter" and entry.matter_id:
        return _is_matter_member(db, user.id, entry.matter_id)
    return False


def require_kb_read(db: Session, user: User, entry: KnowledgeBankEntry) -> None:
    if not check_kb_read(db, user, entry):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def require_kb_write(db: Session, user: User, entry: KnowledgeBankEntry) -> None:
    if not check_kb_write(db, user, entry):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def can_create_firm_wide(user: User) -> bool:
    return is_partner_or_admin(user)
