import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ActionItem, ClassMembership, Document, Matter, MatterMember,
    MentorshipClass, ReviewHandoff, ReviewLesson, User,
)
from app.schemas import ReviewHandoffCreate
from app.services.lesson_service import list_feedback_rounds
from app.services.review_handoff_service import (
    ReviewHandoffError, can_view_handoff_document, count_reviews_waiting,
    create_handoff, has_handoff_access,
)


class ClassReviewIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            Matter.__table__, MatterMember.__table__, Document.__table__,
            ActionItem.__table__, ReviewHandoff.__table__,
        ])
        self.db = Session(self.engine)
        self.user = User(id="reader", email="reader@example.test", google_id="reader", is_admin=True)
        self.db.add(self.user)
        self.db.add_all([
            MentorshipClass(id="a", name="Current", status="active", created_by="reader"),
            MentorshipClass(id="b", name="Former", status="active", created_by="reader"),
        ])
        self.db.add(ClassMembership(class_id="a", user_id="reader", status="active", role="member"))
        self.db.add_all([
            Document(id="doc-a", class_id="a", user_id="reader", filename="current.pdf", content_type="application/pdf", storage_key="a"),
            Document(id="doc-b", class_id="b", user_id="reader", filename="former.pdf", content_type="application/pdf", storage_key="b"),
        ])
        self.db.add(ReviewHandoff(id="round-b", class_id="b", document_id="doc-b", submitted_by="reader", reviewer_id="reader", status="ready_for_review"))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_admin_cannot_read_or_count_former_team_review(self) -> None:
        handoff = self.db.get(ReviewHandoff, "round-b")
        self.assertFalse(has_handoff_access(self.db, user=self.user, handoff=handoff))
        self.assertFalse(can_view_handoff_document(self.db, user=self.user, document_id="doc-b"))
        self.assertEqual(count_reviews_waiting(self.db, self.user), 0)

    def test_owner_cannot_attach_former_team_document(self) -> None:
        with self.assertRaisesRegex(ReviewHandoffError, "Document not found"):
            create_handoff(self.db, user=self.user, schema=ReviewHandoffCreate(document_id="doc-b"))

    def test_review_rejects_reviewer_outside_team(self) -> None:
        outsider = User(id="outsider", email="outsider@example.test", google_id="outsider")
        self.db.add(outsider)
        self.db.commit()
        with self.assertRaisesRegex(ReviewHandoffError, "Reviewer not found"):
            create_handoff(self.db, user=self.user, schema=ReviewHandoffCreate(document_id="doc-a", reviewer_id="outsider"))

    def test_birdie_feedback_query_excludes_former_team(self) -> None:
        from app.models import ReviewAnnotation
        ReviewAnnotation.__table__.create(self.engine)
        ReviewLesson.__table__.create(self.engine)
        self.db.get(ReviewHandoff, "round-b").status = "returned"
        self.db.add(ReviewAnnotation(
            id="feedback-b", handoff_id="round-b", document_id="doc-b",
            page_no=1, kind="comment", anchor_quote="Clause", anchor_rects=[], note="Former team confidential feedback",
            status="open", author_user_id="reviewer",
        ))
        self.db.add(User(id="reviewer", email="reviewer@example.test", google_id="reviewer"))
        self.db.commit()
        self.assertEqual(list_feedback_rounds(self.db, user=self.user), [])


if __name__ == "__main__":
    unittest.main()
