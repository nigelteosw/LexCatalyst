import unittest
import asyncio
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ClassMembership, Document, DocumentFolder, Matter, MatterMember,
    MentorshipClass, Team, User,
)
from app.services.document_service import can_access_document, create_pending_document, document_access_filter
from app.services.mentorship_class_service import ClassAccessError


class ClassDocumentAccessTests(unittest.TestCase):
    def test_filter_requires_active_membership_in_document_class(self) -> None:
        sql = str(document_access_filter("reader").compile(dialect=postgresql.dialect()))
        self.assertIn("class_memberships", sql)
        self.assertIn("documents.class_id", sql)
        self.assertIn("mentorship_classes.status", sql)

    def test_owner_cannot_read_document_bound_to_another_class(self) -> None:
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            Team.__table__, Matter.__table__, MatterMember.__table__,
            DocumentFolder.__table__, Document.__table__,
        ])
        with Session(engine) as db:
            db.add(User(id="reader", email="reader@example.test", google_id="reader"))
            db.add_all([
                MentorshipClass(id="a", name="A", status="active", created_by="reader"),
                MentorshipClass(id="b", name="B", status="active", created_by="reader"),
            ])
            db.add(ClassMembership(class_id="a", user_id="reader", status="active", role="member"))
            db.add(Document(id="foreign", class_id="b", user_id="reader", filename="private.pdf", content_type="application/pdf"))
            db.commit()
            document = db.get(Document, "foreign")
            self.assertFalse(can_access_document(db, user_id="reader", document=document))
        engine.dispose()

    def test_upload_rejects_foreign_matter_before_storing_file(self) -> None:
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            Team.__table__, Matter.__table__, MatterMember.__table__,
            DocumentFolder.__table__, Document.__table__,
        ])
        with Session(engine) as db:
            db.add(User(id="reader", email="reader@example.test", google_id="reader"))
            db.add_all([
                MentorshipClass(id="a", name="A", status="active", created_by="reader"),
                MentorshipClass(id="b", name="B", status="active", created_by="reader"),
            ])
            db.add(ClassMembership(class_id="a", user_id="reader", status="active", role="member"))
            db.add(Team(id="team-b", class_id="b", name="Foreign"))
            db.add(Matter(id="matter-b", class_id="b", team_id="team-b", title="Foreign", case_number="B-1"))
            db.commit()
            with patch("app.services.document_service.upload_document_file") as upload:
                with self.assertRaises(ClassAccessError):
                    asyncio.run(create_pending_document(
                        db, user_id="reader", filename="test.pdf", content_type="application/pdf",
                        file_bytes=b"%PDF", matter_id="matter-b",
                    ))
                upload.assert_not_called()
        engine.dispose()
