from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_db_tables() -> None:
    import app.models  # noqa: F401

    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    Base.metadata.create_all(bind=engine)

    if engine.dialect.name == "postgresql":
        # GIN trigram indexes accelerate ILIKE '%term%' substring searches
        # on the KB keyword fallback path. Without them those
        # queries fall back to seq scans as tables grow.
        with engine.begin() as connection:
            for stmt in (
                "CREATE INDEX IF NOT EXISTS ix_kb_entries_title_trgm "
                "ON kb_entries USING gin (title gin_trgm_ops)",
                "CREATE INDEX IF NOT EXISTS ix_kb_entries_body_trgm "
                "ON kb_entries USING gin (body_markdown gin_trgm_ops)",
            ):
                connection.execute(text(stmt))
