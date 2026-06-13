"""FastAPI app entrypoint.

Routes live in `app/routers/<domain>.py`. This file is intentionally tiny —
it builds the app, wires middleware, and mounts the routers. Add new
domains by creating a router module and registering it in
`app/routers/__init__.py:all_routers`.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.database import create_db_tables
from app.routers import all_routers

app = FastAPI(title="LexCatalyst API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    settings = get_settings()
    if not settings.auto_create_tables:
        return
    try:
        create_db_tables()
    except SQLAlchemyError as exc:
        print(f"Database startup skipped: {exc}")


for router in all_routers:
    app.include_router(router)
