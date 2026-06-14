from functools import lru_cache
from os import getenv

from dotenv import load_dotenv
from pydantic import BaseModel, model_validator

load_dotenv()


def getenv_bool(name: str, default: bool = False) -> bool:
    value = getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    database_url: str = getenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst",
    )
    auto_create_tables: bool = getenv_bool("AUTO_CREATE_TABLES", False)

    @model_validator(mode="after")
    def fix_database_url(self) -> "Settings":
        if self.database_url.startswith("postgres://"):
            self.database_url = self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif self.database_url.startswith("postgresql://"):
            self.database_url = self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self

    deepseek_api_key: str | None = getenv("DEEPSEEK_API_KEY")
    deepseek_base_url: str = getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
    deepseek_temperature: float = float(getenv("DEEPSEEK_TEMPERATURE", "0.2"))

    openai_api_key: str | None = getenv("OPENAI_API_KEY")
    openai_embedding_model: str = getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    openai_embedding_dimensions: int = int(getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))

    cloudflare_r2_bucket_name: str | None = getenv("CLOUDFLARE_R2_BUCKET_NAME")
    cloudflare_r2_endpoint_url: str | None = getenv("CLOUDFLARE_R2_ENDPOINT_URL")
    cloudflare_r2_access_key_id: str | None = getenv("CLOUDFLARE_R2_ACCESS_KEY_ID")
    cloudflare_r2_secret_access_key: str | None = getenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY")

    # Auth Settings
    google_client_id: str | None = getenv("GOOGLE_CLIENT_ID")
    jwt_secret_key: str = getenv("JWT_SECRET_KEY", "change-me-at-least-32-chars-long")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    cors_origins: list[str] = getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,https://lexcatalyst.pages.dev",
    ).split(",")

    admin_emails: list[str] = getenv(
        "ADMIN_EMAILS",
        "nigelteosw@gmail.com",
    ).split(",")


@lru_cache
def get_settings() -> Settings:
    return Settings()
