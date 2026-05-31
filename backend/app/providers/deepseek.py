from openai import APIError, AsyncOpenAI, OpenAIError

from app.config import get_settings

SUPPORTED_CHAT_MODELS = ("deepseek-v4-flash", "deepseek-v4-pro")


class DeepSeekError(RuntimeError):
    pass


def resolve_chat_model(model: str | None) -> str:
    settings = get_settings()
    selected_model = model or settings.deepseek_model
    if selected_model not in SUPPORTED_CHAT_MODELS:
        raise DeepSeekError(f"Unsupported DeepSeek model: {selected_model}")
    return selected_model


class DeepSeekProvider:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client: AsyncOpenAI | None = None
        if self.settings.deepseek_api_key:
            self.client = AsyncOpenAI(
                api_key=self.settings.deepseek_api_key,
                base_url=self.settings.deepseek_base_url,
            )

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
    ) -> tuple[str, dict[str, int | None]]:
        if not self.client:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        selected_model = resolve_chat_model(model)

        try:
            response = await self.client.chat.completions.create(
                model=selected_model,
                messages=messages,
                temperature=self.settings.deepseek_temperature,
            )
        except APIError as exc:
            raise DeepSeekError(f"DeepSeek API error: {exc.message}") from exc
        except OpenAIError as exc:
            raise DeepSeekError(f"DeepSeek client error: {exc}") from exc

        content = response.choices[0].message.content
        if not content:
            raise DeepSeekError("DeepSeek returned an empty response")

        usage = response.usage
        usage_payload = {
            "prompt_tokens": usage.prompt_tokens if usage else None,
            "completion_tokens": usage.completion_tokens if usage else None,
            "total_tokens": usage.total_tokens if usage else None,
        }
        return content, usage_payload

    async def stream_chat(self, messages: list[dict[str, str]], *, model: str | None = None):
        if not self.client:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        selected_model = resolve_chat_model(model)

        try:
            stream = await self.client.chat.completions.create(
                model=selected_model,
                messages=messages,
                temperature=self.settings.deepseek_temperature,
                stream=True,
            )
        except APIError as exc:
            raise DeepSeekError(f"DeepSeek API error: {exc.message}") from exc
        except OpenAIError as exc:
            raise DeepSeekError(f"DeepSeek client error: {exc}") from exc

        try:
            async for chunk in stream:
                if not chunk.choices:
                    continue

                content = chunk.choices[0].delta.content
                if content:
                    yield content
        except APIError as exc:
            raise DeepSeekError(f"DeepSeek API error: {exc.message}") from exc
        except OpenAIError as exc:
            raise DeepSeekError(f"DeepSeek client error: {exc}") from exc
