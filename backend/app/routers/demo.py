"""Demo mode: switch into seeded dummy users and (re)load demo data.

Every route returns 404 unless DEMO_MODE is on and the caller is an admin, so the surface is
invisible when disabled. Only seeded ``dummy:`` users can ever be switched into.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import create_access_token
from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.demo_seed_service import seed_demo

router = APIRouter(tags=["demo"])

SWITCH_TOKEN_TTL = timedelta(hours=12)


def require_demo_admin(current_user: User = Depends(get_current_user)) -> User:
    if not get_settings().demo_mode or not current_user.is_admin:
        raise HTTPException(status_code=404, detail="Not found")
    return current_user


class SwitchRequest(BaseModel):
    user_id: str


def _public(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "firm_role": user.firm_role,
        "is_admin": user.is_admin,
    }


@router.get("/demo/users")
def demo_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_demo_admin),
) -> list[dict]:
    users = db.scalars(
        select(User).where(User.google_id.like("dummy:%")).order_by(User.full_name)
    )
    return [_public(u) for u in users]


@router.post("/demo/switch")
def demo_switch(
    body: SwitchRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_demo_admin),
) -> dict:
    target = db.get(User, body.user_id)
    if target is None or not target.google_id.startswith("dummy:"):
        raise HTTPException(status_code=404, detail="Not found")
    token = create_access_token({"sub": target.id}, expires_delta=SWITCH_TOKEN_TTL)
    return {"access_token": token, "token_type": "bearer", "user": _public(target)}


@router.post("/demo/seed")
async def demo_seed(
    db: Session = Depends(get_db),
    admin: User = Depends(require_demo_admin),
) -> dict:
    return await seed_demo(db, presenter=admin)
