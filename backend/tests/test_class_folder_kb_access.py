import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ClassMembership,
    KnowledgeBankEntry,
    MatterMember,
    MentorshipClass,
    ResourceMetadata,
    User,
)
from app.services.knowledge_bank_service import list_kb_entries
from app.services.resource_metadata_service import list_resource_metadata


class ClassKnowledgeBankIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            KnowledgeBankEntry.__table__,
            MatterMember.__table__, ResourceMetadata.__table__,
        ])
        self.db = Session(self.engine)
        self.user = User(id="reader", email="reader@example.test", google_id="reader")
        self.db.add(self.user)
        self.db.add_all([
            MentorshipClass(id="a", name="Alpha", status="active", created_by="reader"),
            MentorshipClass(id="b", name="Beta", status="active", created_by="reader"),
        ])
        self.db.add(ClassMembership(class_id="a", user_id="reader", status="active", role="member"))
        self.db.add_all([
            KnowledgeBankEntry(id="own-note", class_id="a", created_by="reader", created_by_role="associate", scope="private", entry_type="note", title="Own", body_markdown="Own text"),
            KnowledgeBankEntry(id="foreign-note", class_id="b", created_by="reader", created_by_role="associate", scope="private", entry_type="note", title="Secret", body_markdown="Former class text"),
            ResourceMetadata(id="own-meta", class_id="a", resource_type="document", resource_id="doc-a", owner_user_id="reader", scope="private", title="Current"),
            ResourceMetadata(id="foreign-meta", class_id="b", resource_type="document", resource_id="doc-b", owner_user_id="reader", scope="private", title="Former class"),
        ])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_private_knowledge_bank_list_excludes_previous_class_even_for_creator(self) -> None:
        rows, _ = list_kb_entries(self.db, user=self.user)
        self.assertEqual([row["id"] for row in rows], ["own-note"])

    def test_metadata_list_excludes_previous_class_even_for_creator(self) -> None:
        self.assertEqual(
            [row.id for row in list_resource_metadata(self.db, user=self.user)],
            ["own-meta"],
        )


if __name__ == "__main__":
    unittest.main()
