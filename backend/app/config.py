from functools import lru_cache
from os import getenv

from dotenv import load_dotenv
from pydantic import BaseModel, model_validator

load_dotenv()


class Settings(BaseModel):
    database_url: str = getenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/lexcatalyst",
    )
    
    @model_validator(mode="after")
    def fix_database_url(self) -> "Settings":
        if self.database_url.startswith("postgres://"):
            self.database_url = self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif self.database_url.startswith("postgresql://"):
            self.database_url = self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self
    deepseek_api_key: str | None = getenv("DEEPSEEK_API_KEY")
    deepseek_base_url: str = getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
    deepseek_temperature: float = float(getenv("DEEPSEEK_TEMPERATURE", "0.2"))

    # Auth Settings
    google_client_id: str | None = getenv("GOOGLE_CLIENT_ID")
    jwt_secret_key: str = getenv("JWT_SECRET_KEY", "change-me-at-least-32-chars-long")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    cors_origins: list[str] = getenv(
        "CORS_ORIGINS", 
        "http://127.0.0.1:5173,http://localhost:5173"
    ).split(",")


@lru_cache
def get_settings() -> Settings:
    return Settings()
