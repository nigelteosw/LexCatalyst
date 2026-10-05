"""OpenRouter adapter: the only chat provider. Every call uses a user's own key.

Prompts (which can include document excerpts, KB entries and reviewer feedback) are sent to
OpenRouter and the model provider behind the chosen model. In DEMO_MODE the firm's
DEMO_OPENROUTER_KEY may stand in for a user key (see app.services.llm_service).
"""

from openai import APIConnectionError, APIStatusError, AsyncOpenAI, OpenAIError

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5.5"
TEMPERATURE = 0.2
KEY_REJECTED_MESSAGE = (
    "OpenRouter rejected your API key. Check or replace it in Settings."
)
KEY_NO_CREDIT_MESSAGE = (
    "Your OpenRouter account is out of credit. Add credit on openrouter.ai, "
    "or pick a cheaper model."
)
MODEL_FORBIDDEN_MESSAGE = (
    "OpenRouter refused this request for the selected model (it may be restricted "
    "for your key). Try a different model."
)
MODEL_NOT_FOUND_MESSAGE = (
    "The selected model is not available on OpenRouter. Pick another model."
)
RATE_LIMITED_MESSAGE = (
    "OpenRouter is rate limiting this request. Wait a moment and try again, "
    "or switch model."
)
PROVIDER_UNAVAILABLE_MESSAGE = (
    "OpenRouter or the model provider is unavailable right now. Try again shortly, "
    "or switch model."
)
PROVIDER_UNREACHABLE_MESSAGE = (
    "Could not reach OpenRouter. Check your connection and try again."
)
KEY_MISSING_MESSAGE = "Add your OpenRouter key in Settings"
_HEADERS = {"HTTP-Referer": "https://lexcatalyst.app", "X-Title": "LexCatalyst"}


class OpenRouterError(RuntimeError):
    pass


class OpenRouterKeyMissing(OpenRouterError):
    """No usable OpenRouter key for this user."""

    def __init__(self) -> None:
        super().__init__(KEY_MISSING_MESSAGE)


_STATUS_MESSAGES = {
    401: KEY_REJECTED_MESSAGE,
    402: KEY_NO_CREDIT_MESSAGE,
    403: MODEL_FORBIDDEN_MESSAGE,
    404: MODEL_NOT_FOUND_MESSAGE,
    429: RATE_LIMITED_MESSAGE,
}


def _translate(exc: OpenAIError) -> OpenRouterError:
    if isinstance(exc, APIConnectionError):
        return OpenRouterError(PROVIDER_UNREACHABLE_MESSAGE)
    if isinstance(exc, APIStatusError):
        if exc.status_code in _STATUS_MESSAGES:
            return OpenRouterError(_STATUS_MESSAGES[exc.status_code])
        if exc.status_code >= 500:
            return OpenRouterError(PROVIDER_UNAVAILABLE_MESSAGE)
    message = getattr(exc, "message", None) or str(exc)
    return OpenRouterError(f"OpenRouter error: {message}")


class OpenRouterProvider:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        self.model = model or DEFAULT_OPENROUTER_MODEL
        self.client = AsyncOpenAI(
            api_key=api_key, base_url=OPENROUTER_BASE_URL, default_headers=_HEADERS
        )

    async def chat(
        self, messages: list[dict[str, str]]
    ) -> tuple[str, dict[str, int | None]]:
        try:
            response = await self.client.chat.completions.create(
                model=self.model, messages=messages, temperature=TEMPERATURE
            )
        except OpenAIError as exc:
            raise _translate(exc) from exc
        content = response.choices[0].message.content
        if not content:
            raise OpenRouterError("OpenRouter returned an empty response")
        usage = response.usage
        return content, {
            "prompt_tokens": usage.prompt_tokens if usage else None,
            "completion_tokens": usage.completion_tokens if usage else None,
            "total_tokens": usage.total_tokens if usage else None,
        }

    async def complete(self, messages: list[dict[str, str]]) -> str:
        content, _usage = await self.chat(messages)
        return content

    async def stream_chat(self, messages: list[dict[str, str]]):
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=TEMPERATURE,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                content = chunk.choices[0].delta.content
                if content:
                    yield content
        except OpenAIError as exc:
            raise _translate(exc) from exc

    async def stream_with_tools(self, messages: list[dict], tools: list[dict]):
        """Async generator yielding ("token", str) and ("tool_calls", dict) tuples."""
        kwargs: dict = {
            "model": self.model,
            "messages": messages,
            "temperature": TEMPERATURE,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        accumulated: dict[int, dict] = {}
        content_chunks: list[str] = []
        try:
            stream = await self.client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta
                if delta.content:
                    content_chunks.append(delta.content)
                    yield ("token", delta.content)
                for tc in delta.tool_calls or []:
                    call = accumulated.setdefault(
                        tc.index,
                        {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
                    )
                    if tc.id:
                        call["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            call["function"]["name"] += tc.function.name
                        if tc.function.arguments:
                            call["function"]["arguments"] += tc.function.arguments
                # Some models repeat the finish_reason chunk; only emit once there is
                # something accumulated, or an empty event would erase the real calls.
                if choice.finish_reason == "tool_calls" and accumulated:
                    yield (
                        "tool_calls",
                        {
                            "tool_calls": [accumulated[i] for i in sorted(accumulated)],
                            "content": "".join(content_chunks) or None,
                        },
                    )
                    accumulated = {}
        except OpenAIError as exc:
            raise _translate(exc) from exc
