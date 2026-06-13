"""Service health and runtime configuration endpoints."""

from fastapi import APIRouter

from app.config import get_settings
from app.providers.deepseek import SUPPORTED_CHAT_MODELS

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/config")
def config() -> dict[str, object]:
    settings = get_settings()
    return {
        "deepseek_model": settings.deepseek_model,
        "deepseek_base_url": settings.deepseek_base_url,
        "available_chat_models": list(SUPPORTED_CHAT_MODELS),
    }
