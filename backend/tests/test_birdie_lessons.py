import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.providers.openrouter import DEFAULT_OPENROUTER_MODEL, OpenRouterProvider
from app.services import lesson_service
from app.services.birdie_provider import DeepSeekBirdie, get_birdie_provider
from app.services.lesson_service import LessonDistillError, is_feedback, parse_lessons
from app.services.user_settings_service import birdie_settings_payload


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
            lesson_service, "get_birdie_provider"
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
            lesson_service, "get_birdie_provider", return_value=llm
        ), patch.object(lesson_service, "lock_handoff", return_value=handoff):
            result = asyncio.run(
                lesson_service.distill_lessons(db, user=SimpleNamespace(id="junior"), handoff_id="h")
            )
        self.assertEqual(result, stored_after)
        llm.complete.assert_awaited_once()
        db.add_all.assert_called_once()
        db.commit.assert_called_once()


class ProviderSelectionTests(unittest.TestCase):
    def test_user_key_selects_openrouter(self) -> None:
        setting = SimpleNamespace(openrouter_api_key="sk-or-test-1234", openrouter_model="x/y")
        with patch("app.services.birdie_provider.get_user_setting", return_value=setting):
            provider = get_birdie_provider(MagicMock(), SimpleNamespace(id="u"))
        self.assertIsInstance(provider, OpenRouterProvider)
        self.assertEqual(provider.model, "x/y")

    def test_default_model_when_unset(self) -> None:
        setting = SimpleNamespace(openrouter_api_key="sk-or-test-1234", openrouter_model=None)
        with patch("app.services.birdie_provider.get_user_setting", return_value=setting):
            provider = get_birdie_provider(MagicMock(), SimpleNamespace(id="u"))
        self.assertEqual(provider.model, DEFAULT_OPENROUTER_MODEL)

    def test_no_key_falls_back_to_deepseek(self) -> None:
        with patch("app.services.birdie_provider.get_user_setting", return_value=None):
            provider = get_birdie_provider(MagicMock(), SimpleNamespace(id="u"))
        self.assertIsInstance(provider, DeepSeekBirdie)


class SettingsPayloadTests(unittest.TestCase):
    def test_never_exposes_the_key(self) -> None:
        setting = SimpleNamespace(openrouter_api_key="sk-or-secret-abcd", openrouter_model=None)
        payload = birdie_settings_payload(setting)
        self.assertEqual(payload["key_last4"], "abcd")
        self.assertTrue(payload["has_openrouter_key"])
        self.assertNotIn("sk-or-secret", str(payload))

    def test_no_row(self) -> None:
        payload = birdie_settings_payload(None)
        self.assertFalse(payload["has_openrouter_key"])
        self.assertIsNone(payload["effective_model"])


if __name__ == "__main__":
    unittest.main()
