"""FastAPI app entrypoint.

Routes live in `app/routers/<domain>.py`. This file is intentionally tiny —
it builds the app, wires middleware, and mounts the routers. Add new
domains by creating a router module and registering it in
`app/routers/__init__.py:all_routers`.

Background workers run in a dedicated thread with their own asyncio
loop. This is important: workers issue synchronous SQLAlchemy calls
(`db.execute`, `db.commit`) which would otherwise block the FastAPI
event loop and stall API requests when the queues are busy. Running
in a separate thread keeps the API loop responsive even when the
worker is fully saturated.
"""

import asyncio
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.database import create_db_tables
from app.routers import all_routers
from app.worker import run_worker

app = FastAPI(title="LexCatalyst API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _run_worker_thread() -> None:
    """Run the worker on a dedicated event loop so its sync DB calls don't
    block the FastAPI loop. Survives worker crashes by logging and exiting
    the thread; supervision is the caller's job."""
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        loop.run_until_complete(run_worker())
    except Exception as exc:  # noqa: BLE001 - last-resort log
        print(f"Worker thread exited with error: {exc!r}")
    finally:
        try:
            loop.close()
        except Exception:  # noqa: BLE001
            pass


@app.on_event("startup")
async def startup() -> None:
    settings = get_settings()
    if settings.auto_create_tables:
        try:
            create_db_tables()
        except SQLAlchemyError as exc:
            print(f"Database startup skipped: {exc}")

    threading.Thread(
        target=_run_worker_thread,
        name="lex-worker",
        daemon=True,
    ).start()


for router in all_routers:
    app.include_router(router)
