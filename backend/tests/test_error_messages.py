import unittest
from unittest.mock import MagicMock

from openai import APIConnectionError, APIStatusError

from app.providers.openrouter import _translate
from app.services.error_reporting import unexpected_error_detail


def _status_error(code: int, message: str = "boom") -> APIStatusError:
    response = MagicMock()
    response.status_code = code
    response.headers = {}
    return APIStatusError(message, response=response, body=None)


class OpenRouterErrorTranslationTests(unittest.TestCase):
    def test_each_status_gets_its_own_actionable_message(self) -> None:
        cases = {
            401: "key",
            402: "credit",
            403: "model",
            404: "model",
            429: "rate",
            503: "unavailable",
        }
        seen = set()
        for code, keyword in cases.items():
            message = str(_translate(_status_error(code)))
            self.assertIn(keyword, message.lower(), f"{code}: {message}")
            seen.add(message)
        # 401 and 402 used to share one message; they must differ now.
        self.assertGreater(len(seen), 4)

    def test_connection_errors_say_the_provider_is_unreachable(self) -> None:
        exc = APIConnectionError(request=MagicMock())
        self.assertIn("reach", str(_translate(exc)).lower())

    def test_unknown_errors_keep_the_provider_message(self) -> None:
        self.assertIn("weird thing", str(_translate(_status_error(400, "weird thing"))))


class UnexpectedErrorDetailTests(unittest.TestCase):
    def test_includes_reference_and_hides_internals(self) -> None:
        detail = unexpected_error_detail("LexChat", NameError("TOOLS"))
        self.assertIn("LexChat", detail)
        self.assertRegex(detail, r"reference [0-9a-f]{8}")
        self.assertNotIn("TOOLS", detail)
        self.assertNotIn("NameError", detail)

    def test_references_are_unique(self) -> None:
        a = unexpected_error_detail("LexChat", RuntimeError("x"))
        b = unexpected_error_detail("LexChat", RuntimeError("x"))
        self.assertNotEqual(a, b)
