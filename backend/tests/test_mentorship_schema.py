import unittest

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    MentorFeedback,
    MentorPairing,
    MentorshipClass,
    ReviewAnnotation,
    ReviewHandoff,
    ReviewLesson,
    User,
)


class MentorshipSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, MentorPairing.__table__,
            MentorFeedback.__table__, ReviewHandoff.__table__, ReviewAnnotation.__table__,
            ReviewLesson.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id="mentor", email="m@example.test", google_id="m"),
            User(id="mentee", email="e@example.test", google_id="e"),
            MentorshipClass(id="class-a", name="A", status="active", created_by="mentor"),
        ])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_new_tables_have_non_null_class_id(self) -> None:
        for table_name in ("mentor_pairings", "mentor_feedback"):
            with self.subTest(table=table_name):
                self.assertFalse(Base.metadata.tables[table_name].columns["class_id"].nullable)

    def test_pairing_rejects_self_pairing(self) -> None:
        self.db.add(MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentor", created_by="mentor"))
        with self.assertRaises(IntegrityError):
            self.db.commit()

    def test_active_pairing_is_unique_but_ended_pairing_can_be_recreated(self) -> None:
        self.db.add(MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee", created_by="mentor"))
        self.db.commit()
        self.db.add(MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee", created_by="mentor"))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

        ended = self.db.query(MentorPairing).one()
        ended.ended_at = ended.created_at
        self.db.commit()
        self.db.add(MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee", created_by="mentor"))
        self.db.commit()

    def test_feedback_annotation_id_is_unique(self) -> None:
        self.db.add(ReviewHandoff(id="round-1", class_id="class-a", document_id="doc", submitted_by="mentee", status="returned"))
        self.db.add(ReviewAnnotation(id="ann-1", handoff_id="round-1", document_id="doc", page_no=1, kind="comment", anchor_quote="x"))
        self.db.commit()
        self.db.add(MentorFeedback(class_id="class-a", audience="mentee", mentee_user_id="mentee", source="review_round", annotation_id="ann-1", note="a", created_by="mentor", author_name="M"))
        self.db.commit()
        self.db.add(MentorFeedback(class_id="class-a", audience="mentee", mentee_user_id="mentee", source="review_round", annotation_id="ann-1", note="b", created_by="mentor", author_name="M"))
        with self.assertRaises(IntegrityError):
            self.db.commit()

    def test_lesson_handoff_id_is_nullable(self) -> None:
        self.assertTrue(ReviewLesson.__table__.columns["handoff_id"].nullable)


if __name__ == "__main__":
    unittest.main()
