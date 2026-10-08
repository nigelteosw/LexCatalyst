"""Per-user LLM settings: the OpenRouter key, High/Mid models, favourites and per-feature tiers."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models import UserSetting
from app.services.secret_store import fingerprint
from app.providers.openrouter import (
    KeyCheck,
    OpenRouterKeyRejected,
    OpenRouterKeyUnverified,
    check_key,
)

MAX_FAVOURITES = 12
KEY_PREFIX = "sk-or-"
MIN_KEY_LENGTH = 10


class InvalidOpenRouterKey(ValueError):
    """The key is malformed or OpenRouter rejected it. The message is safe to show."""


def get_user_setting(db: Session, user_id: str) -> UserSetting | None:
    return db.get(UserSetting, user_id)


def llm_settings_payload(setting: UserSetting | None) -> dict:
    # Imported here: llm_service imports get_user_setting from this module.
    from app.services.llm_service import FEATURES, _env_default, feature_tier, key_for, tier_model

    key, source = key_for(setting)
    has_user_key = bool(setting and setting.openrouter_key_ciphertext)
    verified_at = setting.openrouter_key_verified_at if setting else None
    resolved = {}
    for feature in FEATURES:
        tier = feature_tier(setting, feature)
        resolved[feature] = {"tier": tier, "model": tier_model(setting, tier)}
    return {
        "has_key": bool(key),
        "key_last4": (setting.openrouter_key_last4 if setting and has_user_key else None),
        "key_label": (setting.openrouter_key_label if setting and has_user_key else None),
        "key_status": (setting.openrouter_key_status if setting and has_user_key else None),
        "key_verified_at": verified_at.isoformat() if verified_at else None,
        "key_source": source,
        "custom_models": {
            "high": (setting.model_high if setting else None) or None,
            "mid": (setting.model_mid if setting else None) or None,
        },
        "models": {"high": tier_model(setting, "high"), "mid": tier_model(setting, "mid")},
        "default_models": {"high": _env_default("high"), "mid": _env_default("mid")},
        "favourite_models": list(setting.favourite_models or []) if setting else [],
        "feature_tiers": {k: feature_tier(setting, k) for k in FEATURES},
        "resolved": resolved,
        "features": [
            {"key": k, "label": label, "default_tier": tier}
            for k, (label, tier) in FEATURES.items()
        ],
    }


def _check_key_format(api_key: str) -> str:
    key = api_key.strip()
    if len(key) < MIN_KEY_LENGTH or not key.startswith(KEY_PREFIX):
        raise InvalidOpenRouterKey("That doesn't look like an OpenRouter key (they start with sk-or-).")
    return key


def _verify_new_key(key: str) -> KeyCheck | None:
    """Check a key with OpenRouter before anything is stored. None if OpenRouter is unreachable."""
    try:
        return check_key(key)
    except OpenRouterKeyRejected as exc:
        raise InvalidOpenRouterKey(str(exc)) from exc
    except OpenRouterKeyUnverified:
        return None


def _record_check(setting: UserSetting, check: KeyCheck | None) -> None:
    if check is None:
        setting.openrouter_key_status = "unchecked"
        return
    setting.openrouter_key_status = "valid"
    setting.openrouter_key_label = check.label[:120] if check.label else None
    setting.openrouter_key_verified_at = datetime.now(UTC)


def update_llm_settings(
    db: Session,
    *,
    user_id: str,
    api_key: str | None,
    fields_set: set[str],
    model_high: str | None,
    model_mid: str | None,
    feature_tiers: dict[str, str] | None,
    favourite_models: list[str] | None = None,
) -> UserSetting:
    setting = db.get(UserSetting, user_id)
    if setting is None:
        setting = UserSetting(user_id=user_id, feature_tiers={}, favourite_models=[])
        db.add(setting)
    if api_key is not None:
        # Check first: a rejected key must not replace a working one.
        key = _check_key_format(api_key)
        check = _verify_new_key(key)
        if fingerprint(key) != setting.openrouter_key_fingerprint:
            setting.set_openrouter_key(key)
        _record_check(setting, check)
    if "model_high" in fields_set:
        setting.model_high = (model_high or "").strip() or None
    if "model_mid" in fields_set:
        setting.model_mid = (model_mid or "").strip() or None
    if feature_tiers is not None:
        setting.feature_tiers = dict(feature_tiers)
    if favourite_models is not None:
        setting.favourite_models = _dedupe(favourite_models)[:MAX_FAVOURITES]
    db.commit()
    db.refresh(setting)
    return setting


def verify_saved_key(db: Session, *, user_id: str) -> UserSetting | None:
    """Re-check the user's saved key with OpenRouter and record the result."""
    setting = db.get(UserSetting, user_id)
    if setting is None or not setting.openrouter_key_ciphertext:
        return setting
    key = setting.openrouter_api_key
    if key is None:
        setting.openrouter_key_status = "invalid"
    else:
        try:
            _record_check(setting, check_key(key))
        except OpenRouterKeyRejected:
            setting.openrouter_key_status = "invalid"
            setting.openrouter_key_verified_at = datetime.now(UTC)
        except OpenRouterKeyUnverified:
            setting.openrouter_key_status = "unchecked"
    db.commit()
    db.refresh(setting)
    return setting


def clear_openrouter_key(db: Session, *, user_id: str) -> UserSetting | None:
    setting = db.get(UserSetting, user_id)
    if setting is None:
        return None
    setting.clear_openrouter_key()
    db.commit()
    db.refresh(setting)
    return setting


def _dedupe(ids: list[str]) -> list[str]:
    seen: list[str] = []
    for model_id in (i.strip() for i in ids):
        if model_id and model_id not in seen:
            seen.append(model_id)
    return seen
