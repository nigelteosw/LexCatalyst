"""Per-user settings: the optional personal OpenRouter key and model for Birdie."""

from sqlalchemy.orm import Session

from app.models import UserSetting
from app.providers.openrouter import DEFAULT_OPENROUTER_MODEL


def get_user_setting(db: Session, user_id: str) -> UserSetting | None:
    return db.get(UserSetting, user_id)


def birdie_settings_payload(setting: UserSetting | None) -> dict:
    key = setting.openrouter_api_key if setting else None
    has_key = bool(key)
    model = (setting.openrouter_model if setting else None) or None
    return {
        "has_openrouter_key": has_key,
        "key_last4": key[-4:] if key else None,
        "openrouter_model": model,
        "effective_model": (model or DEFAULT_OPENROUTER_MODEL) if has_key else None,
    }


def update_birdie_settings(
    db: Session,
    *,
    user_id: str,
    api_key: str | None,
    model: str | None,
    model_provided: bool,
) -> UserSetting:
    setting = db.get(UserSetting, user_id)
    if setting is None:
        setting = UserSetting(user_id=user_id)
        db.add(setting)
    if api_key is not None:
        setting.openrouter_api_key = api_key.strip()
    if model_provided:
        setting.openrouter_model = (model or "").strip() or None
    db.commit()
    db.refresh(setting)
    return setting


def clear_openrouter_key(db: Session, *, user_id: str) -> UserSetting | None:
    setting = db.get(UserSetting, user_id)
    if setting is None:
        return None
    setting._openrouter_api_key = None
    setting.openrouter_model = None  # a model without a key is meaningless
    db.commit()
    db.refresh(setting)
    return setting
