"""OpenRouter adapter for Birdie, using a user's own key.

When a user supplies a key, Birdie prompts (which can include document excerpts, KB entries and
reviewer feedback) are sent to OpenRouter and the model provider behind the chosen model.
"""

from openai import APIStatusError, AsyncOpenAI, OpenAIError

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5.5"
KEY_REJECTED_MESSAGE = (
    "Your OpenRouter key was rejected or ran out of credit — check Settings."
)


class OpenRouterError(RuntimeError):
    pass


def _translate(exc: OpenAIError) -> OpenRouterError:
    if isinstance(exc, APIStatusError) and exc.status_code in (401, 402, 403, 429):
        return OpenRouterError(KEY_REJECTED_MESSAGE)
    message = getattr(exc, "message", None) or str(exc)
    return OpenRouterError(f"OpenRouter error: {message}")


class OpenRouterProvider:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        self.model = model or DEFAULT_OPENROUTER_MODEL
        self.client = AsyncOpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)

    async def stream_chat(self, messages: list[dict[str, str]]):
        try:
            stream = await self.client.chat.completions.create(
                model=self.model, messages=messages, stream=True
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                content = chunk.choices[0].delta.content
                if content:
                    yield content
        except OpenAIError as exc:
            raise _translate(exc) from exc

    async def complete(self, messages: list[dict[str, str]]) -> str:
        try:
            response = await self.client.chat.completions.create(
                model=self.model, messages=messages
            )
        except OpenAIError as exc:
            raise _translate(exc) from exc
        content = response.choices[0].message.content
        if not content:
            raise OpenRouterError("OpenRouter returned an empty response")
        return content
