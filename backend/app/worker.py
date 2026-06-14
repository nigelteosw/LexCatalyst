"""Database-backed document, Knowledge Bank, and Dream worker.

Each queue has one claim slot, while a fixed global capacity limits total
work across all queues. Slots use ``SELECT ... FOR UPDATE SKIP LOCKED`` to
claim distinct rows. A heartbeat task logs queue depth periodically.

The review-handoff extraction queue has been removed. Handoffs now transition
directly to ready_for_review on creation (visual PDF redlining flow).
"""

import asyncio
import threading
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
from app.worker_types import WorkerClaim

POLL_INTERVAL_SECONDS = 2.0
GLOBAL_CONCURRENCY = 2
DOC_CONCURRENCY = 1
KB_CONCURRENCY = 1
DREAM_CONCURRENCY = 1
HEARTBEAT_INTERVAL_SECONDS = 30.0


ClaimFn = Callable[..., WorkerClaim | None]
ProcessFn = Callable[[WorkerClaim], Awaitable[None]]


async def _sleep_until_stopped(
    stop_requested: threading.Event | None,
    seconds: float,
) -> bool:
    remaining = seconds
    while remaining > 0:
        if stop_requested is not None and stop_requested.is_set():
            return True
        interval = min(remaining, 0.25)
        await asyncio.sleep(interval)
        remaining -= interval
    return stop_requested is not None and stop_requested.is_set()


async def _slot_loop(
    name: str,
    slot_id: int,
    claim: ClaimFn,
    process: ProcessFn,
    capacity: asyncio.Semaphore,
    stop_requested: threading.Event | None,
) -> None:
    while stop_requested is None or not stop_requested.is_set():
        claimed_job = False
        async with capacity:
            if stop_requested is not None and stop_requested.is_set():
                return
            db = SessionLocal()
            try:
                worker_claim = claim(db)
            except Exception as exc:  # noqa: BLE001 - keep the slot alive
                db.rollback()
                print(f"{name} worker slot {slot_id} claim failed: {exc!r}")
                worker_claim = None
            finally:
                db.close()

            if worker_claim:
                claimed_job = True
                print(f"{name} worker slot {slot_id} processing {worker_claim.job_id}")
                try:
                    await process(worker_claim)
                except Exception as exc:  # noqa: BLE001 - isolate queue failures
                    print(
                        f"{name} worker slot {slot_id} job {worker_claim.job_id} failed "
                        f"unexpectedly: {exc!r}"
                    )

        if not claimed_job and await _sleep_until_stopped(
            stop_requested,
            POLL_INTERVAL_SECONDS,
        ):
            return


async def _run_queue(
    name: str,
    claim: ClaimFn,
    process: ProcessFn,
    concurrency: int,
    capacity: asyncio.Semaphore,
    stop_requested: threading.Event | None,
) -> None:
    slots = [
        asyncio.create_task(
            _slot_loop(name, i, claim, process, capacity, stop_requested)
        )
        for i in range(concurrency)
    ]
    await asyncio.gather(*slots)


def _claimable_count(model, stale_after, *, status: str = "processing") -> int:
    """Count rows currently claimable: new pending or stale in-progress."""
    db = SessionLocal()
    try:
        stale_before = datetime.now(UTC) - stale_after
        started_attr = getattr(model, "processing_started_at", None)
        stmt = select(func.count(model.id)).where(model.status == status)
        if started_attr is not None:
            stmt = stmt.where(
                or_(started_attr.is_(None), started_attr < stale_before),
            )
        return int(db.scalar(stmt) or 0)
    finally:
        db.close()


async def _heartbeat_loop(stop_requested: threading.Event | None) -> None:
    while stop_requested is None or not stop_requested.is_set():
        try:
            doc_depth = _claimable_count(Document, DOC_STALE_AFTER)
            kb_depth = _claimable_count(KnowledgeBankEntry, KB_STALE_AFTER)
            dream_depth = _claimable_count(DreamJob, DREAM_STALE_AFTER)
            print(
                f"Worker heartbeat: doc_slots={DOC_CONCURRENCY} "
                f"global_capacity={GLOBAL_CONCURRENCY} "
                f"doc_queue_depth={doc_depth} "
                f"kb_slots={KB_CONCURRENCY} "
                f"kb_queue_depth={kb_depth} "
                f"dream_slots={DREAM_CONCURRENCY} "
                f"dream_queue_depth={dream_depth}"
            )
        except Exception as exc:  # noqa: BLE001 - never let heartbeat kill the worker
            print(f"Worker heartbeat failed: {exc!r}")
        if await _sleep_until_stopped(stop_requested, HEARTBEAT_INTERVAL_SECONDS):
            return


async def run_worker(stop_requested: threading.Event | None = None) -> None:
    capacity = asyncio.Semaphore(GLOBAL_CONCURRENCY)
    print(
        f"LexCatalyst worker started "
        f"(global_concurrency={GLOBAL_CONCURRENCY}, "
        f"doc_concurrency={DOC_CONCURRENCY}, kb_concurrency={KB_CONCURRENCY}, "
        f"dream_concurrency={DREAM_CONCURRENCY}, "
        f"heartbeat={HEARTBEAT_INTERVAL_SECONDS}s)"
    )
    await asyncio.gather(
        _run_queue(
            "Document",
            claim_pending_document,
            process_document,
            DOC_CONCURRENCY,
            capacity,
            stop_requested,
        ),
        _run_queue(
            "Knowledge Bank",
            claim_pending_kb_entry,
            process_kb_summary,
            KB_CONCURRENCY,
            capacity,
            stop_requested,
        ),
        _run_queue(
            "Dream",
            claim_pending_dream_job,
            process_dream_job,
            DREAM_CONCURRENCY,
            capacity,
            stop_requested,
        ),
        _heartbeat_loop(stop_requested),
    )


if __name__ == "__main__":
    asyncio.run(run_worker())
