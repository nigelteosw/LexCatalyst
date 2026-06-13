"""Dedicated database-backed Knowledge Bank ingestion worker."""

import asyncio
import os

from app.database import SessionLocal
from app.services.kb_ingestion_service import (
    claim_pending_kb_entry,
    process_kb_summary,
)

POLL_INTERVAL_SECONDS = float(os.getenv("KB_WORKER_POLL_SECONDS", "2"))


async def run_worker() -> None:
    print("Knowledge Bank worker started")
    while True:
        db = SessionLocal()
        try:
            entry_id = claim_pending_kb_entry(db)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            print(f"Knowledge Bank worker claim failed: {exc!r}")
            entry_id = None
        finally:
            db.close()

        if entry_id:
            print(f"Knowledge Bank worker processing {entry_id}")
            await process_kb_summary(entry_id)
            continue

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(run_worker())
