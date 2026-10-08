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
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.database import SessionLocal, create_db_tables
from app.models import Document, DreamJob, KnowledgeBankEntry
from app.routers import all_routers
from app.worker import run_worker


def _run_worker_thread(stop_requested: threading.Event) -> None:
    """Run the worker on a dedicated event loop so its sync DB calls don't
    block the FastAPI loop. Restart the loop after unexpected top-level
    failures while the API process remains healthy."""
    while not stop_requested.is_set():
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            loop.run_until_complete(run_worker(stop_requested))
        except Exception as exc:  # noqa: BLE001 - last-resort supervision
            print(f"Worker loop exited with error: {exc!r}")
        finally:
            try:
                loop.close()
            except Exception:  # noqa: BLE001
                pass

        if not stop_requested.is_set():
            print("Restarting embedded worker after unexpected exit")
            stop_requested.wait(1)


def _release_active_claims() -> None:
    """Reset processing_started_at for in-flight jobs so the next deployment reclaims them immediately.

    Called unconditionally on shutdown: if a job finished cleanly its status is no longer
    'processing', so the update is a no-op for that row. Only truly abandoned jobs are reset.
    """
    now = datetime.now(UTC)
    db = SessionLocal()
    try:
        db.execute(
            update(Document)
            .where(Document.status == "processing")
            .values(processing_started_at=None, updated_at=now)
        )
        db.execute(
            update(KnowledgeBankEntry)
            .where(KnowledgeBankEntry.status == "processing")
            .values(processing_started_at=None, updated_at=now)
        )
        # DreamJob has no updated_at column.
        db.execute(
            update(DreamJob)
            .where(DreamJob.status == "processing")
            .values(processing_started_at=None)
        )
        db.commit()
        print("Shutdown: released active claims for immediate reclaim by next deployment")
    except Exception as exc:  # noqa: BLE001
        print(f"Shutdown: failed to release active claims: {exc!r}")
        db.rollback()
    finally:
        db.close()


def _run_startup_tasks() -> None:
    settings = get_settings()
    if settings.auto_create_tables:
        try:
            create_db_tables()
        except SQLAlchemyError as exc:
            print(f"Database startup skipped: {exc}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _run_startup_tasks()
    stop_requested = threading.Event()
    worker_thread = threading.Thread(
        target=_run_worker_thread,
        args=(stop_requested,),
        name="lex-worker",
        daemon=True,
    )
    worker_thread.start()

    try:
        yield
    finally:
        stop_requested.set()
        await asyncio.to_thread(worker_thread.join, 30)
        if worker_thread.is_alive():
            print("Worker did not finish within 30s; active claims will be released for immediate reclaim")
        await asyncio.to_thread(_release_active_claims)


app = FastAPI(title="LexCatalyst API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


for router in all_routers:
    app.include_router(router)
