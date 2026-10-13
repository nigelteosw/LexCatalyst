import unittest
from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ClassMembership, MentorFeedback, MentorPairing, MentorshipClass, ReviewLesson, User,
)
from app.services.lesson_service import format_mentorship_context


class MentorshipContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__, MentorPairing.__table__,
            MentorFeedback.__table__, ReviewLesson.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id="owner", email="o@example.test", google_id="o", full_name="Olive Owner"),
            User(id="mentor", email="m@example.test", google_id="m", full_name="Mo Mentor"),
            User(id="mentee", email="e@example.test", google_id="e", full_name="Mel Mentee"),
            User(id="other", email="x@example.test", google_id="x", full_name="Oz Other"),
            User(id="loner", email="l@example.test", google_id="l"),
            MentorshipClass(id="class-a", name="A", status="active", created_by="owner"),
            MentorshipClass(id="class-b", name="B", status="active", created_by="loner"),
            ClassMembership(class_id="class-a", user_id="owner", role="owner", status="active"),
            ClassMembership(class_id="class-a", user_id="mentor", role="mentor", status="active"),
            ClassMembership(class_id="class-a", user_id="mentee", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="other", role="member", status="active"),
            MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee", created_by="owner"),
        ])
        self.db.commit()
        self.mentee = self.db.get(User, "mentee")
        self.mentor = self.db.get(User, "mentor")
        self.other = self.db.get(User, "other")
        self.loner = self.db.get(User, "loner")

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _lesson(self, title: str, *, mentee: str = "mentee", class_id: str = "class-a") -> None:
        self.db.add(ReviewLesson(class_id=class_id, mentee_user_id=mentee, title=title, body="Body " + title, theme="Terms"))
        self.db.commit()

    def _feedback(self, note: str, *, audience: str = "mentee", mentee: str | None = "mentee",
                  author: str = "mentor", deleted: bool = False) -> None:
        self.db.add(MentorFeedback(
            class_id="class-a", audience=audience, mentee_user_id=mentee, author_user_id=author,
            author_name="Mo Mentor", source="guidance", note=note, created_by=author,
            deleted_at=datetime.now(UTC) if deleted else None,
        ))
        self.db.commit()

    def test_context_includes_own_lessons_feedback_and_team_guidance(self) -> None:
        self._lesson("Define terms")
        self._feedback("Define your terms before use")
        self._feedback("Team uses plain English", audience="team", mentee=None, author="owner")

        text = format_mentorship_context(self.db, user=self.mentee)

        self.assertIn("Lessons from the user's mentors:", text)
        self.assertIn("[Terms] Define terms", text)
        self.assertIn("Recent feedback from the user's mentors on their work:", text)
        self.assertIn("Define your terms before use", text)
        self.assertIn("Team guidance:", text)
        self.assertIn("Team uses plain English", text)

    def test_context_excludes_other_users_lessons(self) -> None:
        self._lesson("Secret lesson for someone else", mentee="other")
        text = format_mentorship_context(self.db, user=self.mentee)
        self.assertNotIn("Secret lesson for someone else", text)

    def test_mentor_only_user_gets_team_guidance_only(self) -> None:
        self._feedback("Mentee-only note", mentee="mentee", author="mentor")
        self._feedback("Team note", audience="team", mentee=None, author="owner")

        text = format_mentorship_context(self.db, user=self.mentor)

        self.assertNotIn("Mentee-only note", text)
        self.assertIn("Team note", text)
        self.assertNotIn("Lessons from the user's mentors:", text)

    def test_context_empty_without_class(self) -> None:
        self._feedback("Team note", audience="team", mentee=None, author="owner")
        self.assertEqual(format_mentorship_context(self.db, user=self.loner), "")

    def test_context_omits_soft_deleted_feedback(self) -> None:
        self._feedback("Deleted note", deleted=True)
        text = format_mentorship_context(self.db, user=self.mentee)
        self.assertNotIn("Deleted note", text)


if __name__ == "__main__":
    unittest.main()
