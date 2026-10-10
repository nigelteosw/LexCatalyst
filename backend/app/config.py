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
    environment: str = getenv("ENVIRONMENT", "development")
    database_url: str = getenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst",
    )
    auto_create_tables: bool = getenv_bool("AUTO_CREATE_TABLES", False)

    @property
    def is_development(self) -> bool:
        return self.environment.strip().lower() in {"development", "dev", "local", "test"}

    @model_validator(mode="after")
    def validate_settings(self) -> "Settings":
        if self.database_url.startswith("postgres://"):
            self.database_url = self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif self.database_url.startswith("postgresql://"):
            self.database_url = self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        if len(self.jwt_secret_key.strip()) < 32:
            raise ValueError("JWT_SECRET_KEY must be configured with at least 32 characters")
        self.admin_emails = [e.strip() for e in self.admin_emails if e.strip()]
        if not self.is_development:
            if len((self.class_invite_secret or "").strip()) < 32:
                raise ValueError("CLASS_INVITE_SECRET must be set with at least 32 characters outside development")
            if not self.admin_emails:
                raise ValueError(
                    "ADMIN_EMAILS must be set explicitly outside development"
                )
            if not (self.field_encryption_key or "").strip():
                raise ValueError(
                    "FIELD_ENCRYPTION_KEY must be set explicitly outside development"
                )
            if not (self.openrouter_key_encryption_key or "").strip():
                raise ValueError(
                    "OPENROUTER_KEY_ENCRYPTION_KEY must be set explicitly outside development"
                )
        return self

    # Optional env defaults for each tier when a user hasn't picked a model.
    openrouter_default_high: str | None = getenv("OPENROUTER_DEFAULT_HIGH")
    openrouter_default_mid: str | None = getenv("OPENROUTER_DEFAULT_MID")
    # Demo only: stands in for a user's OpenRouter key when DEMO_MODE=true. Never use with real client data.
    demo_openrouter_key: str | None = getenv("DEMO_OPENROUTER_KEY")

    openai_api_key: str | None = getenv("OPENAI_API_KEY")
    openai_embedding_model: str = getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    openai_embedding_dimensions: int = int(getenv("OPENAI_EMBEDDING_DIMENSIONS", "1536"))

    cloudflare_r2_bucket_name: str | None = getenv("CLOUDFLARE_R2_BUCKET_NAME")
    cloudflare_r2_endpoint_url: str | None = getenv("CLOUDFLARE_R2_ENDPOINT_URL")
    cloudflare_r2_access_key_id: str | None = getenv("CLOUDFLARE_R2_ACCESS_KEY_ID")
    cloudflare_r2_secret_access_key: str | None = getenv("CLOUDFLARE_R2_SECRET_ACCESS_KEY")

    # Auth Settings
    google_client_id: str | None = getenv("GOOGLE_CLIENT_ID")
    jwt_secret_key: str = getenv("JWT_SECRET_KEY", "")
    class_invite_secret: str | None = getenv("CLASS_INVITE_SECRET")
    jwt_algorithm: str = "HS256"
    # Dedicated key for at-rest field encryption. Kept separate from JWT_SECRET_KEY so that
    # rotating the JWT secret does not destroy every encrypted column.
    field_encryption_key: str | None = getenv("FIELD_ENCRYPTION_KEY")
    # Seals users' OpenRouter keys (app.services.secret_store). Separate from FIELD_ENCRYPTION_KEY.
    # Previous secrets stay listed (comma-separated) until values are re-sealed.
    openrouter_key_encryption_key: str | None = getenv("OPENROUTER_KEY_ENCRYPTION_KEY")
    openrouter_key_encryption_keys_old: list[str] = [
        k for k in getenv("OPENROUTER_KEY_ENCRYPTION_KEYS_OLD", "").split(",") if k.strip()
    ]
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    cors_origins: list[str] = getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,https://lexcatalyst.pages.dev",
    ).split(",")

    # Demo mode: lets an admin switch into seeded dummy users and load demo data. Off by default.
    demo_mode: bool = getenv_bool("DEMO_MODE", False)

    admin_emails: list[str] = [
        e for e in getenv("ADMIN_EMAILS", "").split(",") if e.strip()
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
