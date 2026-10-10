"""Service health and runtime configuration endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.user_service import create_dummy_users, delete_dummy_users

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config")
def config() -> dict[str, object]:
    settings = get_settings()
    return {
        "demo_mode": settings.demo_mode,
    }


@router.post("/system/dummy-users")
def post_dummy_users(
    count: int = 2,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    if not get_settings().demo_mode:
        raise HTTPException(status_code=404, detail="Not found")
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    users = create_dummy_users(db, count=count, actor=current_user)
    return {
        "status": "ok",
        "count": len(users),
        "users": [{"id": u.id, "email": u.email, "full_name": u.full_name} for u in users]
    }


@router.delete("/system/dummy-users")
def delete_dummy_users_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, object]:
    if not get_settings().demo_mode:
        raise HTTPException(status_code=404, detail="Not found")
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    count = delete_dummy_users(db, actor=current_user)
    return {"status": "ok", "deleted_count": count}
