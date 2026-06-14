"""Google OAuth login and current-user routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_or_create_user, verify_google_token
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import FirmUserResponse, UserResponse, UserSettingsUpdate
from app.services.user_service import list_firm_users, update_user_role

router = APIRouter(tags=["auth"])


class GoogleAuthRequest(BaseModel):
    credential: str


@router.post("/auth/google")
async def auth_google(request: GoogleAuthRequest, db: Session = Depends(get_db)):
    try:
        google_info = verify_google_token(request.credential)
        user = get_or_create_user(db, google_info)
        access_token = create_access_token(data={"sub": user.id})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "firm_role": user.firm_role,
                "is_admin": user.is_admin,
            },
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
def update_me(
    schema: UserSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    try:
        user = update_user_role(db, user=current_user, firm_role=schema.firm_role)
        return UserResponse.model_validate(user)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="User settings are unavailable") from exc


@router.get("/users", response_model=list[FirmUserResponse])
def firm_users(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[FirmUserResponse]:
    """Roster of everyone in the firm. Powers assignee pickers."""
    return [FirmUserResponse.model_validate(u) for u in list_firm_users(db)]


@router.patch("/users/{user_id}/role", response_model=FirmUserResponse)
def update_other_user_role(
    user_id: str,
    schema: UserSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FirmUserResponse:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    target_user = db.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user = update_user_role(db, user=target_user, firm_role=schema.firm_role)
    return FirmUserResponse.model_validate(user)
