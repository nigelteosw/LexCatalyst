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

    async def stream_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        *,
        model: str | None = None,
    ):
        """
        Async generator yielding:
          ("token", str)          — a streamed content chunk
          ("tool_calls", list)    — complete tool calls when finish_reason == "tool_calls"
        """
        if not self.client:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        selected_model = resolve_chat_model(model)
        kwargs: dict = {
            "model": selected_model,
            "messages": messages,
            "temperature": self.settings.deepseek_temperature,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        try:
            stream = await self.client.chat.completions.create(**kwargs)
        except APIError as exc:
            raise DeepSeekError(f"DeepSeek API error: {exc.message}") from exc
        except OpenAIError as exc:
            raise DeepSeekError(f"DeepSeek client error: {exc}") from exc

        # key: tool-call index → accumulated call dict
        accumulated: dict[int, dict] = {}

        try:
            async for chunk in stream:
                if not chunk.choices:
                    continue

                choice = chunk.choices[0]
                delta = choice.delta
                finish_reason = choice.finish_reason

                if delta.content:
                    yield ("token", delta.content)

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in accumulated:
                            accumulated[idx] = {
                                "id": "",
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }
                        if tc.id:
                            accumulated[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                accumulated[idx]["function"]["name"] += tc.function.name
                            if tc.function.arguments:
                                accumulated[idx]["function"]["arguments"] += tc.function.arguments

                if finish_reason == "tool_calls":
                    tool_calls = [accumulated[i] for i in sorted(accumulated.keys())]
                    yield ("tool_calls", tool_calls)
                    accumulated = {}

        except APIError as exc:
            raise DeepSeekError(f"DeepSeek API error: {exc.message}") from exc
        except OpenAIError as exc:
            raise DeepSeekError(f"DeepSeek client error: {exc}") from exc
