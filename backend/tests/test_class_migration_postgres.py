"""Real-Postgres migration tests for the mentorship class boundary.

Each test creates its own throwaway database on the server named by TEST_DATABASE_URL
(for example postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres), runs the
real Alembic chain against it, and drops it afterwards. The server's existing databases
are never touched. Without TEST_DATABASE_URL the tests skip, and the skip is a release
gate, not a pass.
"""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from scripts.backfill_classes import main as backfill_main
from app.services.class_migration_service import (
    CLASS_LINKS,
    QUARANTINE_CLASS_ID,
    apply_class_backfill,
    build_class_backfill_report,
)

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PRE_CLASS_REVISION = "c9d0e1f2a3b4"
CLASS_HEAD_REVISION = "head"
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")


@unittest.skipUnless(TEST_DATABASE_URL, "TEST_DATABASE_URL not set: Postgres migration gate not run")
class ClassMigrationPostgresTests(unittest.TestCase):
    def setUp(self) -> None:
        base = make_url(TEST_DATABASE_URL)
        self.db_name = f"lexcatalyst_classmig_{uuid.uuid4().hex[:12]}"
        admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{self.db_name}"'))
        admin.dispose()
        self.admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
        self.url = base.set(database=self.db_name).render_as_string(hide_password=False)
        self.engine = create_engine(self.url)

    def tearDown(self) -> None:
        self.engine.dispose()
        with self.admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{self.db_name}" WITH (FORCE)'))
        self.admin.dispose()

    def migrate(self, revision: str) -> None:
        env = {**os.environ, "DATABASE_URL": self.url}
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", revision],
            cwd=BACKEND_ROOT, env=env, check=True, capture_output=True, text=True,
        )

    def seed_legacy(self) -> None:
        """Rows as they exist before the class boundary: no class_id anywhere."""
        with self.engine.begin() as conn:
            conn.execute(text("INSERT INTO users (id, email, google_id) VALUES ('owner', 'owner@example.test', 'owner')"))
            conn.execute(text("INSERT INTO teams (id, name) VALUES ('team-1', 'Shared')"))
            conn.execute(text("INSERT INTO matters (id, team_id, case_number, title) VALUES ('matter-1', 'team-1', 'CN-1', 'Matter')"))
            conn.execute(text(
                "INSERT INTO documents (id, user_id, team_id, matter_id, filename, content_type, storage_key, status) "
                "VALUES ('doc-1', 'owner', 'team-1', 'matter-1', 'a.pdf', 'application/pdf', 'key-1', 'ready')"
            ))

    def add_active_classes(self, *class_ids: str) -> None:
        with self.engine.begin() as conn:
            for class_id in class_ids:
                conn.execute(
                    text("INSERT INTO mentorship_classes (id, name, status) VALUES (:id, :id, 'active')"),
                    {"id": class_id},
                )

    def test_upgrade_quarantines_legacy_rows_and_enrolls_nobody(self) -> None:
        self.migrate(PRE_CLASS_REVISION)
        self.seed_legacy()
        self.migrate(CLASS_HEAD_REVISION)

        with self.engine.connect() as conn:
            classes = dict(conn.execute(text("SELECT id, status FROM mentorship_classes")).all())
            memberships = conn.execute(text("SELECT count(*) FROM class_memberships")).scalar_one()
            doc_class = conn.execute(text("SELECT class_id FROM documents WHERE id = 'doc-1'")).scalar_one()
        self.assertEqual(classes, {QUARANTINE_CLASS_ID: "archived"})
        self.assertEqual(memberships, 0)
        self.assertEqual(doc_class, QUARANTINE_CLASS_ID)

    def test_database_rejects_document_pointing_at_another_class_matter(self) -> None:
        self.migrate(PRE_CLASS_REVISION)
        self.seed_legacy()
        self.migrate(CLASS_HEAD_REVISION)
        self.add_active_classes("class-a", "class-b")
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE teams SET class_id = 'class-a' WHERE id = 'team-1'"))
            conn.execute(text("UPDATE matters SET class_id = 'class-a' WHERE id = 'matter-1'"))
            conn.execute(text("UPDATE documents SET class_id = 'class-a' WHERE id = 'doc-1'"))

        with self.assertRaises(IntegrityError):
            with self.engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO documents (id, class_id, user_id, matter_id, filename, content_type, storage_key, status) "
                    "VALUES ('doc-x', 'class-b', 'owner', 'matter-1', 'b.pdf', 'application/pdf', 'key-x', 'ready')"
                ))

    def test_rerunning_reviewed_backfill_is_idempotent(self) -> None:
        self.migrate(PRE_CLASS_REVISION)
        self.seed_legacy()
        self.migrate(CLASS_HEAD_REVISION)
        self.add_active_classes("class-a")
        mapping = {
            "teams": {"team-1": "class-a"},
            "matters": {"matter-1": "class-a"},
            "documents": {"doc-1": "class-a"},
        }
        with Session(self.engine) as db:
            first = apply_class_backfill(db, mapping=mapping)
        with Session(self.engine) as db:
            second = apply_class_backfill(db, mapping=mapping)
            report = build_class_backfill_report(db)

        self.assertEqual(first["moved"], 3)
        self.assertEqual(second["moved"], 0)
        # The seeded firm-wide default team is never mapped by the reviewed backfill, so it stays
        # quarantined; every row the mapping named has moved out.
        self.assertEqual(report["quarantined"], {"teams": 1})

    def test_every_class_link_has_a_same_class_foreign_key(self) -> None:
        self.migrate(CLASS_HEAD_REVISION)
        inspector = inspect(self.engine)
        missing = []
        for child, ref, parent in CLASS_LINKS:
            fks = inspector.get_foreign_keys(child)
            if not any(
                fk["referred_table"] == parent
                and fk["constrained_columns"] == ["class_id", ref]
                and fk["referred_columns"] == ["class_id", "id"]
                for fk in fks
            ):
                missing.append(f"{child}.{ref} -> {parent}")
        self.assertEqual(missing, [])

    def test_deleting_a_matter_still_falls_back_to_general(self) -> None:
        self.migrate(PRE_CLASS_REVISION)
        self.seed_legacy()
        self.migrate(CLASS_HEAD_REVISION)
        self.add_active_classes("class-a")
        with self.engine.begin() as conn:
            conn.execute(text("UPDATE teams SET class_id = 'class-a' WHERE id = 'team-1'"))
            conn.execute(text("UPDATE matters SET class_id = 'class-a' WHERE id = 'matter-1'"))
            conn.execute(text("UPDATE documents SET class_id = 'class-a' WHERE id = 'doc-1'"))
        with self.engine.begin() as conn:
            conn.execute(text("DELETE FROM matters WHERE id = 'matter-1'"))
        with self.engine.connect() as conn:
            row = conn.execute(text("SELECT matter_id, class_id FROM documents WHERE id = 'doc-1'")).one()
        self.assertEqual(row, (None, "class-a"))

    def run_cli(self, *args: str) -> tuple[int, str]:
        out = io.StringIO()
        with mock.patch("scripts.backfill_classes.SessionLocal", sessionmaker(bind=self.engine)):
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                code = backfill_main(list(args))
        return code, out.getvalue()

    def write_mapping(self, mapping: dict) -> str:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        self.addCleanup(os.unlink, handle.name)
        json.dump(mapping, handle)
        handle.close()
        return handle.name

    def test_cli_report_then_apply_moves_rows_and_rejects_bad_mapping(self) -> None:
        self.migrate(PRE_CLASS_REVISION)
        self.seed_legacy()
        self.migrate(CLASS_HEAD_REVISION)
        self.add_active_classes("class-a", "class-b")

        code, report = self.run_cli("report")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(report)["quarantined"]["documents"], 1)

        bad = self.write_mapping({
            "teams": {"team-1": "class-a"},
            "matters": {"matter-1": "class-b"},
            "documents": {"doc-1": "class-b"},
        })
        code, _ = self.run_cli("apply", "--mapping", bad)
        self.assertEqual(code, 1)
        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT count(*) FROM documents WHERE class_id = :q"), {"q": QUARANTINE_CLASS_ID}).scalar_one(), 1)

        good = self.write_mapping({
            "teams": {"team-1": "class-a"},
            "matters": {"matter-1": "class-a"},
            "documents": {"doc-1": "class-a"},
        })
        code, out = self.run_cli("apply", "--mapping", good)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["moved"], 3)


if __name__ == "__main__":
    unittest.main()
