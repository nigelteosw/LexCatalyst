import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.schemas import PageContext
from app.services import birdie_service as b

USER = SimpleNamespace(id="u1")


class ResolvePageContextTests(unittest.TestCase):
    def test_client_titles_are_ignored(self) -> None:
        ctx = PageContext(view="documents", document_name="Forged title")
        page = b.resolve_page_context(None, USER, ctx)
        self.assertNotIn("Forged title", page.prompt)
        self.assertIsNone(page.title)

    def test_document_text_and_matter_come_from_the_database(self) -> None:
        doc = SimpleNamespace(filename="SPA.docx", matter_id="m1")
        with patch.object(b, "get_document_full_text", return_value=(doc, "Clause 4: completion in 8 weeks")) as get:
            page = b.resolve_page_context(None, USER, PageContext(view="documents", document_id="d1"))
        get.assert_called_once()
        self.assertEqual(get.call_args.kwargs["user_id"], "u1")
        self.assertIn('"SPA.docx"', page.prompt)
        self.assertIn("completion in 8 weeks", page.prompt)
        self.assertEqual(page.matter_id, "m1")

    def test_inaccessible_document_resolves_to_nothing(self) -> None:
        with patch.object(b, "get_document_full_text", return_value=None):
            page = b.resolve_page_context(None, USER, PageContext(view="documents", document_id="d1"))
        self.assertIsNone(page.title)
        self.assertIsNone(page.matter_id)

    def test_ticket_requires_assignee_or_assigner(self) -> None:
        item = SimpleNamespace(title="Chase seller", matter_id="m1", description="x", assignee_id="u2", assigner_id="u3")
        with patch.object(b, "get_action_item", return_value=item):
            page = b.resolve_page_context(None, USER, PageContext(view="actions", action_id="a1"))
        self.assertIsNone(page.title)


if __name__ == "__main__":
    unittest.main()
