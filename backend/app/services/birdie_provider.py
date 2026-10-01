"""Chooses the LLM behind Birdie: the user's own OpenRouter key, else the firm DeepSeek default."""

from sqlalchemy.orm import Session

from app.models import User
from app.providers.deepseek import DeepSeekProvider
from app.providers.openrouter import OpenRouterProvider
from app.services.user_settings_service import get_user_setting

BIRDIE_DEEPSEEK_MODEL = "deepseek-v4-flash"


class DeepSeekBirdie:
    def __init__(self) -> None:
        self._provider = DeepSeekProvider()

    def stream_chat(self, messages: list[dict[str, str]]):
        return self._provider.stream_chat(messages, model=BIRDIE_DEEPSEEK_MODEL)

    async def complete(self, messages: list[dict[str, str]]) -> str:
        content, _usage = await self._provider.chat(messages, model=BIRDIE_DEEPSEEK_MODEL)
        return content


def get_birdie_provider(db: Session, user: User) -> DeepSeekBirdie | OpenRouterProvider:
    setting = get_user_setting(db, user.id)
    key = setting.openrouter_api_key if setting else None
    if key:
        return OpenRouterProvider(key, setting.openrouter_model)
    return DeepSeekBirdie()
