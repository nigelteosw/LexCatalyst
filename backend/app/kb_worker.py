"""Backward-compatible entrypoint for the combined worker."""

import asyncio

from app.worker import run_worker


if __name__ == "__main__":
    asyncio.run(run_worker())
