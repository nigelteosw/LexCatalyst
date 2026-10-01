"""Per-user settings. Every route reads and writes only the signed-in user's row."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import BirdieSettingsResponse, BirdieSettingsUpdate
from app.services import user_settings_service as svc

router = APIRouter(tags=["settings"])


@router.get("/settings/birdie", response_model=BirdieSettingsResponse)
def get_birdie_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return svc.birdie_settings_payload(svc.get_user_setting(db, current_user.id))


@router.put("/settings/birdie", response_model=BirdieSettingsResponse)
def put_birdie_settings(
    body: BirdieSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    setting = svc.update_birdie_settings(
        db,
        user_id=current_user.id,
        api_key=body.openrouter_api_key,
        model=body.openrouter_model,
        model_provided="openrouter_model" in body.model_fields_set,
    )
    return svc.birdie_settings_payload(setting)


@router.delete("/settings/birdie/openrouter-key", response_model=BirdieSettingsResponse)
def delete_openrouter_key(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return svc.birdie_settings_payload(svc.clear_openrouter_key(db, user_id=current_user.id))
