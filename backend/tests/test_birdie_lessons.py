import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import lesson_service
from app.services.lesson_service import LessonDistillError, is_feedback, parse_lessons


def _handoff(submitted_by="junior"):
    return SimpleNamespace(submitted_by=submitted_by)


def _ann(*, author="senior", note="Cap it", suggested=None, previous=None, id="a1"):
    return SimpleNamespace(
        id=id,
        author_user_id=author,
        note=note,
        suggested_text=suggested,
        previous_annotation_id=previous,
        page_no=1,
        anchor_quote="uncapped indemnity",
    )


class IsFeedbackTests(unittest.TestCase):
    def test_reviewer_comment_with_note_counts(self) -> None:
        self.assertTrue(is_feedback(_ann(), _handoff()))

    def test_suggestion_without_note_counts(self) -> None:
        self.assertTrue(is_feedback(_ann(note=None, suggested="Cap at fees"), _handoff()))

    def test_own_marks_do_not_count(self) -> None:
        self.assertFalse(is_feedback(_ann(author="junior"), _handoff()))

    def test_empty_comment_does_not_count(self) -> None:
        self.assertFalse(is_feedback(_ann(note="  ", suggested=None), _handoff()))

    def test_carried_forward_copy_does_not_count(self) -> None:
        self.assertFalse(is_feedback(_ann(previous="old"), _handoff()))

    def test_deleted_author_still_counts(self) -> None:
        self.assertTrue(is_feedback(_ann(author=None), _handoff()))


class ParseLessonsTests(unittest.TestCase):
    def test_parses_fenced_json_and_drops_unknown_sources(self) -> None:
        raw = (
            "```json\n"
            '[{"title": "Cap indemnities", "body": "Cap at fees.", '
            '"source_annotation_ids": ["a1", "ghost"]}]\n```'
        )
        lessons = parse_lessons(raw, {"a1"})
        self.assertEqual(lessons[0]["source_annotation_ids"], ["a1"])

    def test_caps_at_four_lessons(self) -> None:
        raw = (
            "["
            + ",".join('{"title": "t%d", "body": "b"}' % i for i in range(6))
            + "]"
        )
        self.assertEqual(len(parse_lessons(raw, set())), 4)

    def test_rejects_non_json(self) -> None:
        with self.assertRaises(LessonDistillError):
            parse_lessons("sorry, no", {"a1"})

    def test_rejects_lessons_without_body(self) -> None:
        with self.assertRaises(LessonDistillError):
            parse_lessons('[{"title": "x"}]', {"a1"})


class DistillTests(unittest.TestCase):
    def test_unknown_round_is_not_found(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None
        with self.assertRaises(lesson_service.LessonNotFound):
            asyncio.run(
                lesson_service.distill_lessons(db, user=SimpleNamespace(id="junior"), handoff_id="h")
            )

    def test_round_without_feedback_is_not_found(self) -> None:
        handoff = SimpleNamespace(
            submitted_by="junior",
            annotations=[_ann(author="junior")],
            document=SimpleNamespace(filename="nda.pdf"),
        )
        db = MagicMock()
        db.scalar.return_value = handoff
        with self.assertRaises(lesson_service.LessonNotFound):
            asyncio.run(
                lesson_service.distill_lessons(db, user=SimpleNamespace(id="junior"), handoff_id="h")
            )

    def test_stored_lessons_skip_the_provider(self) -> None:
        handoff = SimpleNamespace(
            submitted_by="junior",
            annotations=[_ann()],
            document=SimpleNamespace(filename="nda.pdf"),
        )
        db = MagicMock()
        db.scalar.return_value = handoff
        stored = [SimpleNamespace(id="l1")]
        with patch.object(lesson_service, "_stored_lessons", return_value=stored), patch.object(
            lesson_service, "get_llm"
        ) as provider:
            result = asyncio.run(
                lesson_service.distill_lessons(db, user=SimpleNamespace(id="junior"), handoff_id="h")
            )
        self.assertEqual(result, stored)
        provider.assert_not_called()

    def test_distils_once_and_stores(self) -> None:
        handoff = SimpleNamespace(
            submitted_by="junior",
            annotations=[_ann()],
            document=SimpleNamespace(filename="nda.pdf"),
        )
        db = MagicMock()
        db.scalar.return_value = handoff
        llm = SimpleNamespace(
            complete=AsyncMock(
                return_value='[{"title": "Cap it", "body": "Always cap.", "source_annotation_ids": ["a1"]}]'
            )
        )
        stored_after = [SimpleNamespace(id="l1")]
        calls = iter([[], [], stored_after])
        with patch.object(lesson_service, "_stored_lessons", side_effect=lambda *_: next(calls)), patch.object(
            lesson_service, "get_llm", return_value=llm
        ), patch.object(lesson_service, "lock_handoff", return_value=handoff):
            result = asyncio.run(
                lesson_service.distill_lessons(db, user=SimpleNamespace(id="junior"), handoff_id="h")
            )
        self.assertEqual(result, stored_after)
        llm.complete.assert_awaited_once()
        db.add_all.assert_called_once()
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
