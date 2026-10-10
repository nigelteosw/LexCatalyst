import unittest

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.services.class_migration_service import (
    ClassBackfillError,
    QUARANTINE_CLASS_ID,
    apply_class_backfill,
    build_class_backfill_report,
)


class ClassMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        with self.engine.begin() as conn:
            conn.execute(text("CREATE TABLE mentorship_classes (id TEXT PRIMARY KEY, status TEXT NOT NULL)"))
            conn.execute(text("CREATE TABLE teams (id TEXT PRIMARY KEY, class_id TEXT NOT NULL)"))
            conn.execute(text("CREATE TABLE matters (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, team_id TEXT NOT NULL)"))
            conn.execute(text("CREATE TABLE documents (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, matter_id TEXT)"))
            conn.execute(text("INSERT INTO mentorship_classes VALUES (:id, 'archived')"), {"id": QUARANTINE_CLASS_ID})
            conn.execute(text("INSERT INTO mentorship_classes VALUES ('class-a', 'active'), ('class-b', 'active')"))
            conn.execute(text("INSERT INTO teams VALUES ('team-1', :id)"), {"id": QUARANTINE_CLASS_ID})
            conn.execute(text("INSERT INTO matters VALUES ('matter-1', :id, 'team-1')"), {"id": QUARANTINE_CLASS_ID})
            conn.execute(text("INSERT INTO documents VALUES ('doc-1', :id, 'matter-1')"), {"id": QUARANTINE_CLASS_ID})
        self.db = Session(self.engine)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_report_counts_quarantined_rows_without_revealing_content(self) -> None:
        report = build_class_backfill_report(self.db)
        self.assertEqual(report["quarantined"], {"teams": 1, "matters": 1, "documents": 1})
        self.assertNotIn("doc-1", str(report))

    def test_backfill_keeps_linked_rows_in_one_class(self) -> None:
        result = apply_class_backfill(self.db, mapping={
            "teams": {"team-1": "class-a"},
            "matters": {"matter-1": "class-a"},
            "documents": {"doc-1": "class-a"},
        })
        self.assertEqual(result["moved"], 3)
        self.assertEqual(build_class_backfill_report(self.db)["quarantined"], {})

    def test_backfill_rejects_cross_class_parent_and_rolls_back(self) -> None:
        with self.assertRaises(ClassBackfillError):
            apply_class_backfill(self.db, mapping={
                "teams": {"team-1": "class-a"},
                "matters": {"matter-1": "class-b"},
                "documents": {"doc-1": "class-b"},
            })
        self.assertEqual(self.db.execute(text("SELECT class_id FROM teams WHERE id='team-1'")).scalar_one(), QUARANTINE_CLASS_ID)

    def test_unknown_id_never_counts_as_moved(self) -> None:
        with self.assertRaises(ClassBackfillError):
            apply_class_backfill(self.db, mapping={"teams": {"missing": "class-a"}})
