"""CLI: ``python -m app.demo_seed --presenter you@example.com`` (see ``make seed-demo``)."""

import argparse
import asyncio
import json
import sys

from sqlalchemy import select

from app.database import SessionLocal
from app.models import User
from app.services.demo_seed_service import seed_demo


async def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the LexCatalyst demo firm")
    parser.add_argument("--presenter", required=True, help="Email of the presenter (must have signed in once)")
    args = parser.parse_args()

    with SessionLocal() as db:
        presenter = db.scalar(select(User).where(User.email.ilike(args.presenter)))
        if presenter is None:
            print(f"No user with email {args.presenter!r}. Sign in with Google once first.", file=sys.stderr)
            return 1
        summary = await seed_demo(db, presenter=presenter)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
