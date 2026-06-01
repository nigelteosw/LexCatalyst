from openai import APIError, AsyncOpenAI, OpenAIError

from app.config import get_settings


class EmbeddingError(RuntimeError):
    pass


class OpenAIEmbeddingProvider:
    def __init__(self) -> None:
        settings = get_settings()
        self.api_key = settings.openai_api_key
        self.model = settings.openai_embedding_model
        self.dimensions = settings.openai_embedding_dimensions
        self.client = AsyncOpenAI(api_key=self.api_key) if self.api_key else None

    async def embed_texts(self, texts: list[str], *, batch_size: int = 64) -> list[list[float]]:
        if not self.client:
            raise EmbeddingError("OPENAI_API_KEY is not configured")
        if not texts:
            return []

        embeddings: list[list[float]] = []
        for index in range(0, len(texts), batch_size):
            batch = texts[index : index + batch_size]
            try:
                response = await self.client.embeddings.create(
                    model=self.model,
                    input=batch,
                    dimensions=self.dimensions,
                )
            except (APIError, OpenAIError) as exc:
                raise EmbeddingError(f"OpenAI embedding request failed: {exc}") from exc

            embeddings.extend(
                item.embedding for item in sorted(response.data, key=lambda data: data.index)
            )

        if len(embeddings) != len(texts):
            raise EmbeddingError("OpenAI returned an unexpected number of embeddings")
        return embeddings


async def embed_texts(texts: list[str]) -> list[list[float]]:
    return await OpenAIEmbeddingProvider().embed_texts(texts)
