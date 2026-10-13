import asyncio
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ActionItem, ClassAuditEvent, ClassMembership, Document, Matter, MatterMember, MentorFeedback,
    MentorPairing, MentorshipClass, ReviewAnnotation, ReviewAnnotationReply, ReviewHandoff, ReviewLesson, User,
)
from app.services import lesson_service
from app.services.feedback_service import snapshot_round_feedback
from app.services.lesson_service import (
    LessonDistillError, LessonNotFound, NothingToDistill, distill_lessons, distill_round_lessons,
    list_lessons, parse_lessons, themes_for_mentee,
)
from app.services.mentorship_class_service import ClassContext


def _llm(raw: str) -> SimpleNamespace:
    return SimpleNamespace(complete=AsyncMock(return_value=raw))


class MentorshipLessonTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__, ClassAuditEvent.__table__,
            MentorPairing.__table__, MentorFeedback.__table__, ReviewLesson.__table__, Matter.__table__,
            MatterMember.__table__, Document.__table__, ActionItem.__table__, ReviewHandoff.__table__,
            ReviewAnnotation.__table__, ReviewAnnotationReply.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id="owner", email="o@example.test", google_id="o", full_name="Olive Owner"),
            User(id="mentor", email="m@example.test", google_id="m", full_name="Mo Mentor"),
            User(id="mentee", email="e@example.test", google_id="e", full_name="Mel Mentee"),
            User(id="other", email="x@example.test", google_id="x", full_name="Oz Other"),
            User(id="member", email="p@example.test", google_id="p"),
            MentorshipClass(id="class-a", name="A", status="active", created_by="owner"),
            ClassMembership(class_id="class-a", user_id="owner", role="owner", status="active"),
            ClassMembership(class_id="class-a", user_id="mentor", role="mentor", status="active"),
            ClassMembership(class_id="class-a", user_id="mentee", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="other", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="member", role="member", status="active"),
            MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee", created_by="owner"),
        ])
        self.db.commit()
        self.mentor_user = self.db.get(User, "mentor")
        self.mentee_user = self.db.get(User, "mentee")
        self.member_user = self.db.get(User, "member")
        self.mentor_ctx = ClassContext(user_id="mentor", class_id="class-a", role="mentor")
        self.mentee_ctx = ClassContext(user_id="mentee", class_id="class-a", role="member")

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _feedback(self, feedback_id: str, *, mentee: str = "mentee", note: str = "Define your terms") -> None:
        self.db.add(MentorFeedback(
            id=feedback_id, class_id="class-a", audience="mentee", mentee_user_id=mentee,
            author_user_id="mentor", author_name="Mo Mentor", source="guidance", note=note, created_by="mentor",
        ))
        self.db.commit()

    def _lesson(self, *, title: str, theme: str, created_at: datetime | None = None, mentee: str = "mentee") -> None:
        values = dict(class_id="class-a", mentee_user_id=mentee, title=title, body="b", theme=theme)
        if created_at is not None:
            values["created_at"] = created_at
        self.db.add(ReviewLesson(**values))
        self.db.commit()

    def _distill(self, user, llm, **kwargs):
        with patch.object(lesson_service, "get_llm", return_value=llm):
            return asyncio.run(distill_lessons(self.db, user=user, **kwargs))

    def test_distill_defaults_to_undistilled_mentee_feedback_only(self) -> None:
        self._feedback("fb-old")
        self._feedback("fb-new", note="Use short sentences")
        self.db.add(ReviewLesson(class_id="class-a", mentee_user_id="mentee", title="Old", body="b",
                                 theme="General", source_feedback_ids=["fb-old"]))
        self.db.commit()
        llm = _llm('[{"title": "Short sentences", "body": "Keep them short.", "theme": "Style", "source_feedback_ids": ["fb-new"]}]')

        self._distill(self.mentee_user, llm)

        prompt = llm.complete.await_args.args[0][-1]["content"]
        self.assertIn("fb-new", prompt)
        self.assertNotIn("fb-old", prompt)

    def test_distill_with_no_feedback_raises_nothing_to_distill(self) -> None:
        with self.assertRaises(NothingToDistill):
            self._distill(self.mentee_user, _llm("[]"))

    def test_distill_rejects_feedback_ids_the_caller_cannot_read(self) -> None:
        self._feedback("fb-other", mentee="other")
        llm = _llm("[]")
        with self.assertRaises(LessonNotFound):
            self._distill(self.mentor_user, llm, mentee_user_id="mentee", feedback_ids=["fb-other"])
        llm.complete.assert_not_awaited()

    def test_distill_by_active_mentor_stores_lessons_for_the_mentee(self) -> None:
        self._feedback("fb-1")
        llm = _llm('[{"title": "Define terms", "body": "Define before use.", "theme": "Defined terms", "source_feedback_ids": ["fb-1"]}]')

        created = self._distill(self.mentor_user, llm, mentee_user_id="mentee")

        self.assertEqual([l.title for l in created], ["Define terms"])
        stored = self.db.scalars(select(ReviewLesson).where(ReviewLesson.title == "Define terms")).one()
        self.assertEqual(stored.mentee_user_id, "mentee")
        self.assertEqual(stored.source_feedback_ids, ["fb-1"])
        self.assertIsNone(stored.handoff_id)

    def test_distill_by_unrelated_member_is_not_found(self) -> None:
        self._feedback("fb-1")
        llm = _llm("[]")
        with self.assertRaises(LessonNotFound):
            self._distill(self.member_user, llm, mentee_user_id="mentee")
        llm.complete.assert_not_awaited()

    def test_invalid_model_json_writes_no_rows(self) -> None:
        self._feedback("fb-1")
        with self.assertRaises(LessonDistillError):
            self._distill(self.mentee_user, _llm("sorry, no"))
        self.assertEqual(self.db.query(ReviewLesson).count(), 0)

    def test_model_citing_foreign_ids_drops_them_and_keeps_valid_lesson(self) -> None:
        self._feedback("fb-1")
        llm = _llm('[{"title": "Define terms", "body": "Define.", "theme": "Terms", "source_feedback_ids": ["fb-1", "fb-999"]}]')
        created = self._distill(self.mentee_user, llm)
        self.assertEqual(created[0].source_feedback_ids, ["fb-1"])

    def test_theme_is_normalised_and_capped(self) -> None:
        raw = '[{"title": "t", "body": "b", "theme": "  defined   terms  "}, {"title": "u", "body": "b", "theme": "%s"}]' % ("x" * 60)
        lessons = parse_lessons(raw, set())
        self.assertEqual(lessons[0]["theme"], "Defined Terms")
        self.assertEqual(len(lessons[1]["theme"]), 40)

        blank = parse_lessons('[{"title": "t", "body": "b"}]', set())
        self.assertEqual(blank[0]["theme"], "General")

    def test_round_distill_is_idempotent(self) -> None:
        self.db.add(Document(id="doc", class_id="class-a", user_id="mentee", filename="draft.docx",
                             content_type="application/docx", storage_key="k"))
        self.db.add(ReviewHandoff(id="round-1", class_id="class-a", document_id="doc",
                                  submitted_by="mentee", reviewer_id="mentor", status="returned"))
        self.db.add(ReviewAnnotation(id="ann-1", handoff_id="round-1", document_id="doc", page_no=1,
                                     kind="comment", anchor_quote="cap", author_user_id="mentor", note="Cap it"))
        self.db.commit()
        snapshot_round_feedback(self.db, self.db.get(ReviewHandoff, "round-1"))
        self.db.commit()
        llm = _llm('[{"title": "Cap it", "body": "Always cap.", "theme": "Caps", "source_feedback_ids": ["ann-1"]}]')

        with patch.object(lesson_service, "get_llm", return_value=llm):
            first = asyncio.run(distill_round_lessons(self.db, user=self.mentee_user, handoff_id="round-1"))
            second = asyncio.run(distill_round_lessons(self.db, user=self.mentee_user, handoff_id="round-1"))

        self.assertEqual(len(first), 1)
        self.assertEqual([l.id for l in second], [l.id for l in first])
        llm.complete.assert_awaited_once()
        self.assertEqual(first[0].source_feedback_ids, [self.db.scalar(select(MentorFeedback.id))])

    def test_themes_group_counts_titles_and_respect_days_window(self) -> None:
        now = datetime.now(UTC)
        self._lesson(title="A1", theme="Defined Terms", created_at=now - timedelta(days=1))
        self._lesson(title="A2", theme="Defined Terms", created_at=now - timedelta(days=2))
        self._lesson(title="B1", theme="Passive Voice", created_at=now - timedelta(days=3))
        self._lesson(title="Old", theme="Passive Voice", created_at=now - timedelta(days=100))

        themes = themes_for_mentee(self.db, context=self.mentor_ctx, mentee_user_id="mentee")

        self.assertEqual([(t.theme, t.count) for t in themes], [("Defined Terms", 2), ("Passive Voice", 1)])
        self.assertEqual(themes[0].titles, ["A1", "A2"])

    def test_themes_and_lessons_require_read_access_to_the_mentee(self) -> None:
        self._lesson(title="A1", theme="Terms")
        member_ctx = ClassContext(user_id="member", class_id="class-a", role="member")
        self.assertEqual(themes_for_mentee(self.db, context=member_ctx, mentee_user_id="mentee"), [])
        self.assertEqual(list_lessons(self.db, context=member_ctx, mentee_user_id="mentee"), [])
        self.assertEqual(len(list_lessons(self.db, context=self.mentor_ctx, mentee_user_id="mentee")), 1)


if __name__ == "__main__":
    unittest.main()
