"""Report legacy rows still in quarantine, or apply a reviewed ID-to-class mapping.

Run from backend/ against the database in DATABASE_URL:

    .venv/bin/python -m scripts.backfill_classes report
    .venv/bin/python -m scripts.backfill_classes apply --mapping mapping.json

The mapping file is an explicit object: {"<table>": {"<row id>": "<class id>"}}. Nothing is
inferred from the shared default team. The apply runs as one transaction and rolls back if
any link would cross classes. Report output carries counts only, never row content.
"""

import argparse
import json
import sys
from pathlib import Path

from app.database import SessionLocal
from app.services.class_migration_service import (
    ClassBackfillError,
    apply_class_backfill,
    build_class_backfill_report,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("report", help="count quarantined rows by table")
    apply = commands.add_parser("apply", help="apply a reviewed mapping file")
    apply.add_argument("--mapping", type=Path, required=True, help="JSON file: {table: {row_id: class_id}}")
    args = parser.parse_args(argv)

    with SessionLocal() as db:
        if args.command == "report":
            print(json.dumps(build_class_backfill_report(db), indent=2))
            return 0
        try:
            mapping = json.loads(args.mapping.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Cannot read mapping file: {exc}", file=sys.stderr)
            return 2
        try:
            result = apply_class_backfill(db, mapping=mapping)
        except ClassBackfillError as exc:
            print(f"Backfill rejected and rolled back: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(result, indent=2))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
