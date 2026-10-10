import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from sqlalchemy.dialects import postgresql

from app.services.resource_metadata_service import (
    RESOURCE_DOCUMENT,
    RESOURCE_KB_ENTRY,
    resource_metadata_access_filter,
    sync_document_metadata,
    sync_kb_metadata,
)


class ResourceMetadataTests(unittest.TestCase):
    def test_sync_document_metadata_creates_row(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None
        document = SimpleNamespace(
            id="doc-1",
            class_id="class-1",
            filename="Agreement.pdf",
            user_id="user-1",
            team_id="team-1",
            matter_id="matter-1",
            status="ready",
        )

        sync_document_metadata(db, document)

        metadata = db.add.call_args.args[0]
        self.assertEqual(metadata.resource_type, RESOURCE_DOCUMENT)
        self.assertEqual(metadata.resource_id, "doc-1")
        self.assertEqual(metadata.title, "Agreement.pdf")
        self.assertEqual(metadata.scope, "matter")
        self.assertEqual(metadata.source_document_id, "doc-1")

    def test_sync_kb_metadata_updates_existing_row(self) -> None:
        db = MagicMock()
        existing = SimpleNamespace(class_id="class-1")
        db.scalar.return_value = existing
        entry = SimpleNamespace(
            id="kb-1",
            class_id="class-1",
            title="Share purchase checklist",
            created_by="user-1",
            team_id=None,
            matter_id=None,
            scope="private",
            source_document_id=None,
            status="ready",
            entry_type="knowledge_bank",
            pii_status="clean",
            source_entry_id=None,
        )

        sync_kb_metadata(db, entry)

        db.add.assert_not_called()
        self.assertEqual(existing.resource_type, RESOURCE_KB_ENTRY)
        self.assertEqual(existing.resource_id, "kb-1")
        self.assertEqual(existing.title, "Share purchase checklist")
        self.assertEqual(existing.metadata_json["entry_type"], "knowledge_bank")

    def test_access_filter_includes_team_and_matter_membership(self) -> None:
        user = SimpleNamespace(id="user-1", is_admin=False)
        sql = str(
            resource_metadata_access_filter(user).compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        ).lower()

        self.assertIn("resource_metadata.scope = 'firm_wide'", sql)
        self.assertIn("resource_metadata.owner_user_id = 'user-1'", sql)
        self.assertIn("team_members", sql)
        self.assertIn("matter_members", sql)
        self.assertIn("class_memberships", sql)


if __name__ == "__main__":
    unittest.main()
