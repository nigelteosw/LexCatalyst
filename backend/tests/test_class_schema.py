import unittest
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.database import Base
from app import models  # noqa: F401


class ClassSchemaTests(unittest.TestCase):
    def test_class_migration_is_current_head(self) -> None:
        backend_dir = Path(__file__).resolve().parents[1]
        script = ScriptDirectory.from_config(Config(str(backend_dir / "alembic.ini")))
        self.assertEqual(script.get_current_head(), "b5c6d7e8f9a0")

    def test_class_membership_invite_and_content_roots_have_class_boundary(self) -> None:
        for table_name in (
            "mentorship_classes",
            "class_memberships",
            "class_invites",
            "class_join_attempts",
            "class_audit_events",
        ):
            self.assertIn(table_name, Base.metadata.tables)

        for table_name in (
            "teams",
            "matters",
            "documents",
            "document_folders",
            "chat_threads",
            "memories",
            "kb_entries",
            "resource_metadata",
            "action_items",
            "review_handoffs",
            "review_lessons",
            "birdie_reviews",
            "dream_jobs",
            "retrieval_audit_events",
        ):
            with self.subTest(table=table_name):
                column = Base.metadata.tables[table_name].columns["class_id"]
                self.assertFalse(column.nullable)

    def test_only_one_active_class_membership_per_user(self) -> None:
        table = Base.metadata.tables["class_memberships"]
        self.assertTrue(
            any(
                index.unique and "active" in str(index.dialect_options["postgresql"].get("where", ""))
                for index in table.indexes
            )
        )
