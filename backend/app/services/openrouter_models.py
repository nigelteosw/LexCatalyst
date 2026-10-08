"""Model list for the Settings picker, from OpenRouter's public catalogue (no key needed).

Cached in memory for an hour. If OpenRouter is unreachable we serve a short built-in list so the
picker still works; users can always type any model id.
"""

import logging
import time

import requests

from app.providers.openrouter import DEFAULT_OPENROUTER_MODEL

_log = logging.getLogger(__name__)

MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE_SECONDS = 3600
_cache: tuple[float, list[dict]] | None = None



def _fallback(model_id: str, name: str) -> dict:
    return {
        "id": model_id,
        "name": name,
        "provider": model_id.split("/", 1)[0],
        "context_length": None,
        "prompt_price_per_million": None,
        "completion_price_per_million": None,
        "supports_tools": True,
    }


FALLBACK_MODELS = [
    _fallback(DEFAULT_OPENROUTER_MODEL, "Anthropic: Claude Sonnet 5.5"),
    _fallback("anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5"),
    _fallback("openai/gpt-4o-mini", "OpenAI: GPT-4o mini"),
]


def _per_million(price: str | None) -> float | None:
    try:
        return round(float(price) * 1_000_000, 2) if price is not None else None
    except (TypeError, ValueError):
        return None


def _parse(payload: dict) -> list[dict]:
    models = []
    for item in payload.get("data", []):
        model_id = item.get("id")
        if not model_id or model_id.endswith(":batch"):
            continue
        if "text" not in (item.get("architecture") or {}).get("output_modalities", ["text"]):
            continue
        pricing = item.get("pricing") or {}
        models.append(
            {
                "id": model_id,
                "name": item.get("name") or model_id,
                "provider": model_id.split("/", 1)[0],
                "context_length": item.get("context_length"),
                "prompt_price_per_million": _per_million(pricing.get("prompt")),
                "completion_price_per_million": _per_million(pricing.get("completion")),
                # LexChat and Birdie run tool loops, so the picker flags models without tools.
                "supports_tools": "tools" in (item.get("supported_parameters") or []),
            }
        )
    models.sort(key=lambda m: m["name"].lower())
    return models


def list_openrouter_models() -> list[dict]:
    global _cache
    now = time.monotonic()
    if _cache and now - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    try:
        response = requests.get(MODELS_URL, timeout=10)
        response.raise_for_status()
        models = _parse(response.json())
        if not models:
            raise ValueError("empty model list")
    except Exception as exc:  # network or schema problems must not break Settings
        _log.warning("OpenRouter model list unavailable: %s", exc)
        return _cache[1] if _cache else FALLBACK_MODELS
    _cache = (now, models)
    return models
