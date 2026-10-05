"""Per-user LLM settings. Every route reads and writes only the signed-in user's row."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import LlmSettingsResponse, LlmSettingsUpdate, OpenRouterModelResponse
from app.services import user_settings_service as svc
from app.services.llm_service import FEATURES, TIERS
from app.services.openrouter_models import list_openrouter_models

router = APIRouter(tags=["settings"])


@router.get("/settings/llm", response_model=LlmSettingsResponse)
def get_llm_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return svc.llm_settings_payload(svc.get_user_setting(db, current_user.id))


@router.put("/settings/llm", response_model=LlmSettingsResponse)
def put_llm_settings(
    body: LlmSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if body.feature_tiers is not None:
        for feature, tier in body.feature_tiers.items():
            if feature not in FEATURES or tier not in TIERS:
                raise HTTPException(status_code=422, detail=f"Invalid feature tier: {feature}={tier}")
    setting = svc.update_llm_settings(
        db,
        user_id=current_user.id,
        api_key=body.openrouter_api_key,
        fields_set=body.model_fields_set,
        model_high=body.model_high,
        model_mid=body.model_mid,
        feature_tiers=body.feature_tiers,
    )
    return svc.llm_settings_payload(setting)


@router.delete("/settings/llm/openrouter-key", response_model=LlmSettingsResponse)
def delete_openrouter_key(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return svc.llm_settings_payload(svc.clear_openrouter_key(db, user_id=current_user.id))


@router.get("/settings/llm/models", response_model=list[OpenRouterModelResponse])
def get_openrouter_models(_current_user: User = Depends(get_current_user)) -> list[dict]:
    """Models offered in the Settings pickers (OpenRouter's public list, cached for an hour)."""
    return list_openrouter_models()
