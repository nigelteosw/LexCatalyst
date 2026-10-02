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

FALLBACK_MODELS = [
    {"id": DEFAULT_OPENROUTER_MODEL, "name": "Anthropic: Claude Sonnet 5.5", "context_length": None, "prompt_price_per_million": None},
    {"id": "anthropic/claude-opus-5.5", "name": "Anthropic: Claude Opus 5.5", "context_length": None, "prompt_price_per_million": None},
    {"id": "openai/gpt-4o-mini", "name": "OpenAI: GPT-4o mini", "context_length": None, "prompt_price_per_million": None},
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
        models.append(
            {
                "id": model_id,
                "name": item.get("name") or model_id,
                "context_length": item.get("context_length"),
                "prompt_price_per_million": _per_million((item.get("pricing") or {}).get("prompt")),
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
