"""Database-backed document, Knowledge Bank, and Dream worker.

Each queue runs ``WORKER_CONCURRENCY`` (or per-queue override) claim+process
slots in parallel. Slots use ``SELECT ... FOR UPDATE SKIP LOCKED`` to claim
distinct rows, so multiple worker replicas and multiple in-process slots
coexist safely. A heartbeat task logs queue depth periodically so a
backlog is visible without manual SQL.
"""

import asyncio
import os
from datetime import UTC, datetime
from typing import Awaitable, Callable

from sqlalchemy import or_, select
from sqlalchemy.sql import func

from app.database import SessionLocal
from app.models import Document, DreamJob, KnowledgeBankEntry
from app.services.document_service import (
    STALE_CLAIM_AFTER as DOC_STALE_AFTER,
    claim_pending_document,
    process_document,
)
from app.services.dream_service import (
    STALE_CLAIM_AFTER as DREAM_STALE_AFTER,
    claim_pending_dream_job,
    process_dream_job,
)
from app.services.kb_ingestion_service import (
    STALE_CLAIM_AFTER as KB_STALE_AFTER,
    claim_pending_kb_entry,
    process_kb_summary,
)

POLL_INTERVAL_SECONDS = float(
    os.getenv("WORKER_POLL_SECONDS", os.getenv("KB_WORKER_POLL_SECONDS", "2"))
)
DEFAULT_CONCURRENCY = max(1, int(os.getenv("WORKER_CONCURRENCY", "3")))
DOC_CONCURRENCY = max(1, int(os.getenv("DOC_WORKER_CONCURRENCY", str(DEFAULT_CONCURRENCY))))
KB_CONCURRENCY = max(1, int(os.getenv("KB_WORKER_CONCURRENCY", str(DEFAULT_CONCURRENCY))))
DREAM_CONCURRENCY = max(1, int(os.getenv("DREAM_WORKER_CONCURRENCY", "1")))
HEARTBEAT_INTERVAL_SECONDS = float(os.getenv("WORKER_HEARTBEAT_SECONDS", "30"))


ClaimFn = Callable[..., "str | None"]
ProcessFn = Callable[[str], Awaitable[None]]


async def _slot_loop(name: str, slot_id: int, claim: ClaimFn, process: ProcessFn) -> None:
    while True:
        db = SessionLocal()
        try:
            job_id = claim(db)
        except Exception as exc:  # noqa: BLE001 - keep the slot alive
            db.rollback()
            print(f"{name} worker slot {slot_id} claim failed: {exc!r}")
            job_id = None
        finally:
            db.close()

        if job_id:
            print(f"{name} worker slot {slot_id} processing {job_id}")
            try:
                await process(job_id)
            except Exception as exc:  # noqa: BLE001 - isolate queue failures
                print(
                    f"{name} worker slot {slot_id} job {job_id} failed "
                    f"unexpectedly: {exc!r}"
                )
            continue

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def _run_queue(name: str, claim: ClaimFn, process: ProcessFn, concurrency: int) -> None:
    slots = [
        asyncio.create_task(_slot_loop(name, i, claim, process))
        for i in range(concurrency)
    ]
    await asyncio.gather(*slots)


def _claimable_count(model, stale_after) -> int:
    """Count rows currently claimable: new pending or stale in-progress."""
    db = SessionLocal()
    try:
        stale_before = datetime.now(UTC) - stale_after
        return int(
            db.scalar(
                select(func.count(model.id)).where(
                    model.status == "processing",
                    or_(
                        model.processing_started_at.is_(None),
                        model.processing_started_at < stale_before,
                    ),
                )
            )
            or 0
        )
    finally:
        db.close()


async def _heartbeat_loop() -> None:
    while True:
        try:
            doc_depth = _claimable_count(Document, DOC_STALE_AFTER)
            kb_depth = _claimable_count(KnowledgeBankEntry, KB_STALE_AFTER)
            dream_depth = _claimable_count(DreamJob, DREAM_STALE_AFTER)
            print(
                f"Worker heartbeat: doc_slots={DOC_CONCURRENCY} "
                f"doc_queue_depth={doc_depth} "
                f"kb_slots={KB_CONCURRENCY} "
                f"kb_queue_depth={kb_depth} "
                f"dream_slots={DREAM_CONCURRENCY} "
                f"dream_queue_depth={dream_depth}"
            )
        except Exception as exc:  # noqa: BLE001 - never let heartbeat kill the worker
            print(f"Worker heartbeat failed: {exc!r}")
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)


async def run_worker() -> None:
    print(
        f"LexCatalyst worker started "
        f"(doc_concurrency={DOC_CONCURRENCY}, kb_concurrency={KB_CONCURRENCY}, "
        f"dream_concurrency={DREAM_CONCURRENCY}, "
        f"heartbeat={HEARTBEAT_INTERVAL_SECONDS}s)"
    )
    await asyncio.gather(
        _run_queue("Document", claim_pending_document, process_document, DOC_CONCURRENCY),
        _run_queue("Knowledge Bank", claim_pending_kb_entry, process_kb_summary, KB_CONCURRENCY),
        _run_queue("Dream", claim_pending_dream_job, process_dream_job, DREAM_CONCURRENCY),
        _heartbeat_loop(),
    )


if __name__ == "__main__":
    asyncio.run(run_worker())
