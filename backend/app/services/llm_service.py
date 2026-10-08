"""Which OpenRouter key and model serve each LLM call.

Key: the user's own key, else DEMO_OPENROUTER_KEY (only when DEMO_MODE=true), else
OpenRouterKeyMissing. Model: an explicit model id, else an explicit tier, else the tier the user
chose for the feature (or the feature default), mapped to the user's High/Mid model.
"""

from typing import Literal

from sqlalchemy.orm import Session

from app.config import get_settings
from app.providers.openrouter import (
    DEFAULT_OPENROUTER_MODEL,
    OpenRouterKeyMissing,
    OpenRouterProvider,
)
from app.services.user_settings_service import get_user_setting

Tier = Literal["high", "mid"]
TIERS: tuple[Tier, ...] = ("high", "mid")
DEFAULT_HIGH_MODEL = "anthropic/claude-opus-5.5"

# Single source of truth for per-feature tier settings: key -> (label, default tier).
FEATURES: dict[str, tuple[str, Tier]] = {
    "lexchat": ("LexChat", "mid"),
    "birdie": ("Birdie", "mid"),
    "birdie_review": ("Birdie draft review (extension)", "high"),
    "lessons": ("Birdie lessons from review feedback", "mid"),
    "dream": ("Memory consolidation (Dream)", "high"),
    "kb_summary": ("Knowledge Bank redaction scan", "mid"),
    "kb_format": ("Knowledge Bank document formatting", "mid"),
    "thread_summary": ("Chat thread summaries", "mid"),
    "memory": ("Memory extraction", "mid"),
}


def _env_default(tier: Tier) -> str:
    settings = get_settings()
    if tier == "high":
        return settings.openrouter_default_high or DEFAULT_HIGH_MODEL
    return settings.openrouter_default_mid or DEFAULT_OPENROUTER_MODEL


def feature_tier(setting, feature: str) -> Tier:
    chosen = (setting.feature_tiers or {}).get(feature) if setting else None
    return chosen if chosen in TIERS else FEATURES[feature][1]


def tier_model(setting, tier: Tier) -> str:
    custom = getattr(setting, f"model_{tier}", None) if setting else None
    return custom or _env_default(tier)


def key_for(setting) -> tuple[str | None, str | None]:
    """Return (api_key, source) where source is "user", "demo" or None."""
    user_key = setting.openrouter_api_key if setting else None
    if user_key:
        return user_key, "user"
    settings = get_settings()
    if settings.demo_mode and settings.demo_openrouter_key:
        return settings.demo_openrouter_key, "demo"
    return None, None


def resolve_model(
    db: Session,
    user_id: str,
    *,
    feature: str,
    tier: Tier | None = None,
    model: str | None = None,
) -> str:
    if model:
        return model
    setting = get_user_setting(db, user_id)
    return tier_model(setting, tier or feature_tier(setting, feature))


def get_llm(
    db: Session,
    user_id: str,
    *,
    feature: str,
    tier: Tier | None = None,
    model: str | None = None,
) -> OpenRouterProvider:
    """Provider bound to the resolved model. Raises OpenRouterKeyMissing without a key."""
    setting = get_user_setting(db, user_id)
    api_key, _source = key_for(setting)
    if not api_key:
        raise OpenRouterKeyMissing()
    chosen = model or tier_model(setting, tier or feature_tier(setting, feature))
    return OpenRouterProvider(api_key, chosen)
