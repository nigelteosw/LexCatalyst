"""Per-user LLM settings: the OpenRouter key, High/Mid models and per-feature tiers."""

from sqlalchemy.orm import Session

from app.models import UserSetting


def get_user_setting(db: Session, user_id: str) -> UserSetting | None:
    return db.get(UserSetting, user_id)


def llm_settings_payload(setting: UserSetting | None) -> dict:
    # Imported here: llm_service imports get_user_setting from this module.
    from app.services.llm_service import FEATURES, feature_tier, key_for, tier_model

    key, source = key_for(setting)
    user_key = setting.openrouter_api_key if setting else None
    return {
        "has_key": bool(key),
        "key_last4": user_key[-4:] if user_key else None,
        "key_source": source,
        "custom_models": {
            "high": (setting.model_high if setting else None) or None,
            "mid": (setting.model_mid if setting else None) or None,
        },
        "models": {"high": tier_model(setting, "high"), "mid": tier_model(setting, "mid")},
        "feature_tiers": {k: feature_tier(setting, k) for k in FEATURES},
        "features": [
            {"key": k, "label": label, "default_tier": tier}
            for k, (label, tier) in FEATURES.items()
        ],
    }


def update_llm_settings(
    db: Session,
    *,
    user_id: str,
    api_key: str | None,
    fields_set: set[str],
    model_high: str | None,
    model_mid: str | None,
    feature_tiers: dict[str, str] | None,
) -> UserSetting:
    setting = db.get(UserSetting, user_id)
    if setting is None:
        setting = UserSetting(user_id=user_id, feature_tiers={})
        db.add(setting)
    if api_key is not None:
        setting.openrouter_api_key = api_key.strip()
    if "model_high" in fields_set:
        setting.model_high = (model_high or "").strip() or None
    if "model_mid" in fields_set:
        setting.model_mid = (model_mid or "").strip() or None
    if feature_tiers is not None:
        setting.feature_tiers = dict(feature_tiers)
    db.commit()
    db.refresh(setting)
    return setting


def clear_openrouter_key(db: Session, *, user_id: str) -> UserSetting | None:
    setting = db.get(UserSetting, user_id)
    if setting is None:
        return None
    setting._openrouter_api_key = None
    db.commit()
    db.refresh(setting)
    return setting
