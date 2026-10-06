import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import birdie_service as b

BISHAN = SimpleNamespace(id="11111111-1111-1111-1111-111111111111", title="Tan family — Bishan condominium purchase", case_number="DEMO-SG-PROP-001")
RESALE = SimpleNamespace(id="22222222-2222-2222-2222-222222222222", title="Lim family — HDB resale purchase", case_number="DEMO-SG-PROP-002")
ITEM_ID = "33333333-3333-3333-3333-333333333333"


class FakeDb:
    def get(self, _model, ident):
        return SimpleNamespace(matter_id=BISHAN.id) if ident == ITEM_ID else None


def infer(message, url=None, title=None):
    ctx = SimpleNamespace(url=url, title=title) if url else None
    with patch.object(b, "list_matters", return_value=[BISHAN, RESALE]):
        return b.infer_matter_id(FakeDb(), SimpleNamespace(), message=message, web_context=ctx)


class InferMatterTests(unittest.TestCase):
    def test_unique_title_word_picks_matter(self) -> None:
        self.assertEqual(infer("Where are we on the Bishan purchase?"), BISHAN.id)

    def test_shared_words_do_not_match(self) -> None:
        self.assertIsNone(infer("Where are we on this purchase?"))

    def test_two_matters_named_is_ambiguous(self) -> None:
        self.assertIsNone(infer("Compare Bishan and HDB resale"))

    def test_app_links(self) -> None:
        self.assertEqual(infer("where are we?", url=f"https://x.dev/matters/{RESALE.id}"), RESALE.id)
        self.assertEqual(infer("where are we?", url=f"https://x.dev/actions/{ITEM_ID}"), BISHAN.id)

    def test_page_title_counts(self) -> None:
        self.assertEqual(infer("check this", url="https://docs.google.com/d/1", title="Bishan letter"), BISHAN.id)
