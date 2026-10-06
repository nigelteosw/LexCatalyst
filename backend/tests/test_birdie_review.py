import unittest
from types import SimpleNamespace

from app.services import birdie_review_service as r

DRAFT = (
    "3.2 The Seller will pay 90% of the Consideration.\n"
    "7. [JUNIOR TO DRAFT]\n"
    "10.1 The Seller will bear costs and/or expenses.\n"
    "3.2 repeated clause text will appear again."
)


def _item(**kw):
    base = {"type": "replace", "category": "style", "reason": "Style guide 2.1.",
            "anchor_text": "will pay", "suggested_text": "shall pay", "clause_ref": "3.2",
            "source_ref": None}
    base.update(kw)
    return base


def _build(items, sources=None, cases=None, blob=""):
    return r.build_suggestions(items, text=DRAFT, sources=sources or {}, cases=cases or [], source_blob=blob)


class ParseTests(unittest.TestCase):
    def test_parses_fenced_json(self) -> None:
        raw = '```json\n{"suggestions": [{"type": "comment"}, "junk"]}\n```'
        self.assertEqual(r.parse_suggestions(raw), [{"type": "comment"}])

    def test_garbage_returns_empty(self) -> None:
        self.assertEqual(r.parse_suggestions("no json"), [])
        self.assertEqual(r.parse_suggestions('{"suggestions": "x"}'), [])


class AnchorTests(unittest.TestCase):
    def test_exact_and_whitespace_flexible(self) -> None:
        start, end = r.find_anchor(DRAFT, "will   pay\n90%")
        self.assertEqual(DRAFT[start:end], "will pay 90%"[:0] or DRAFT[start:end])
        self.assertTrue(DRAFT[start:end].startswith("will pay"))

    def test_missing_anchor(self) -> None:
        self.assertIsNone(r.find_anchor(DRAFT, "not in the draft"))
        self.assertIsNone(r.find_anchor(DRAFT, "   "))

    def test_prefers_occurrence_after_clause_heading(self) -> None:
        start, _ = r.find_anchor(DRAFT, "will", "10.1")
        self.assertGreater(start, DRAFT.index("10.1"))


class BuildTests(unittest.TestCase):
    def test_valid_style_fix_is_kept_with_real_offsets(self) -> None:
        items, stats = _build([_item()])
        self.assertEqual(len(items), 1)
        s = items[0]
        self.assertEqual(DRAFT[s["anchor_start"]:s["anchor_end"]], "will pay")
        self.assertEqual(stats["dropped_anchor"], 0)

    def test_drops_unanchored(self) -> None:
        items, stats = _build([_item(anchor_text="invented words")])
        self.assertEqual(items, [])
        self.assertEqual(stats["dropped_anchor"], 1)

    def test_drops_overlap(self) -> None:
        items, _ = _build([_item(), _item(anchor_text="will pay 90%", suggested_text="shall pay 90 per cent")])
        self.assertEqual(len(items), 1)

    def test_unsourced_substance_becomes_question(self) -> None:
        item = _item(type="insert", category="substance", anchor_text="[JUNIOR TO DRAFT]",
                     suggested_text="7.1 Claims expire after twenty-four (24) months.", clause_ref="7")
        items, stats = _build([item])
        self.assertEqual(items[0]["type"], "comment")
        self.assertEqual(items[0]["category"], "question")
        self.assertIsNone(items[0]["suggested_text"])
        self.assertEqual(stats["downgraded"], 1)

    def test_sourced_substance_is_kept_with_source(self) -> None:
        src = {"S1": {"kind": "kb", "id": "k1", "title": "Style Guide", "path": "/knowledge-bank/k1"}}
        item = _item(type="insert", category="substance", anchor_text="[JUNIOR TO DRAFT]",
                     suggested_text="7.1 Claims expire after twenty-four (24) months.",
                     source_ref="S1", clause_ref="7")
        items, _ = _build([item], sources=src)
        self.assertEqual(items[0]["type"], "insert")
        self.assertEqual(items[0]["source"]["id"], "k1")

    def test_unknown_source_ref_is_not_trusted(self) -> None:
        item = _item(type="insert", category="substance", anchor_text="[JUNIOR TO DRAFT]",
                     suggested_text="Text.", source_ref="S9", clause_ref="7")
        items, _ = _build([item], sources={})
        self.assertEqual(items[0]["type"], "comment")

    def test_undefined_term_replace_is_dropped(self) -> None:
        item = _item(anchor_text="will pay", suggested_text="shall pay on each Material Contract")
        items, stats = _build([item])
        self.assertEqual(items, [])
        self.assertEqual(stats["dropped_term"], 1)

    def test_defined_term_from_draft_is_fine(self) -> None:
        text_item = _item(anchor_text="will bear", suggested_text="shall bear", clause_ref="10.1")
        items, _ = _build([text_item])
        self.assertEqual(len(items), 1)

    def test_uncited_case_is_dropped(self) -> None:
        item = _item(suggested_text="shall pay as held in [2020] SGCA 12", anchor_text="will pay")
        items, stats = _build([item], cases=[])
        self.assertEqual(items, [])
        self.assertEqual(stats["dropped_citation"], 1)

    def test_comment_needs_no_suggested_text(self) -> None:
        item = _item(type="comment", category="question", anchor_text="costs and/or expenses",
                     suggested_text=None, clause_ref="10.1")
        items, _ = _build([item])
        self.assertEqual(items[0]["type"], "comment")


def _review(suggestions):
    return SimpleNamespace(source_text=DRAFT, suggestions=suggestions)


def _sug(kind, anchor, suggested, status):
    start = DRAFT.index(anchor)
    return SimpleNamespace(type=kind, anchor_start=start, anchor_end=start + len(anchor),
                           suggested_text=suggested, status=status)


class CurrentTextTests(unittest.TestCase):
    def test_only_accepted_edits_apply(self) -> None:
        review = _review([
            _sug("replace", "will pay", "shall pay", "accepted"),
            _sug("replace", "costs and/or expenses", "costs and expenses", "rejected"),
            _sug("comment", "90%", None, "accepted"),
        ])
        out = r.current_text(review)
        self.assertIn("shall pay 90%", out)
        self.assertIn("costs and/or expenses", out)

    def test_placeholder_insert_replaces_placeholder(self) -> None:
        review = _review([_sug("insert", "[JUNIOR TO DRAFT]", "7.1 Drafted.", "accepted")])
        out = r.current_text(review)
        self.assertIn("7. 7.1 Drafted.", out)
        self.assertNotIn("[JUNIOR TO DRAFT]", out)

    def test_non_placeholder_insert_goes_after_anchor(self) -> None:
        review = _review([_sug("insert", "7.", "NEW", "accepted")])
        self.assertIn("7.\nNEW", r.current_text(review))

    def test_multiple_edits_keep_offsets_correct(self) -> None:
        review = _review([
            _sug("replace", "will pay", "shall pay", "accepted"),
            _sug("replace", "90%", "90 per cent", "accepted"),
            _sug("replace", "costs and/or expenses", "costs and expenses", "accepted"),
        ])
        out = r.current_text(review)
        self.assertIn("The Seller shall pay 90 per cent of the Consideration.", out)
        self.assertIn("costs and expenses.", out)

    def test_nothing_accepted_returns_source(self) -> None:
        self.assertEqual(r.current_text(_review([_sug("replace", "will pay", "x", "pending")])), DRAFT)


class SourceTests(unittest.TestCase):
    def test_sources_are_numbered_and_linkable(self) -> None:
        precedent = SimpleNamespace(
            source_type="document", id="c1", excerpt="Clause 7 text", document_title="Meranti SPA",
            matter_ref="M-1", date="2025-09-09", status="executed", document_id="d1",
        )
        kb = SimpleNamespace(id="k1", entry_type="style_guide", title="Style Guide", body_markdown="Use shall.")
        case = SimpleNamespace(citation="[2020] SGCA 12", title="A v B", url="https://www.elitigation.sg/gd/s/2020_SGCA_12",
                               decision_date="2020-01-01", paragraphs=[("1", "text")])
        sources, block = r._collect_sources([precedent], [kb], [case])
        self.assertEqual(list(sources), ["S1", "S2", "S3"])
        self.assertEqual(sources["S1"]["path"], "/documents/d1")
        self.assertEqual(sources["S2"]["kind"], "style_guide")
        self.assertEqual(sources["S3"]["url"], case.url)
        self.assertIn("[S1] (document) Meranti SPA", block)


SPA = """THIS AGREEMENT is dated [●] 2026.
1. DEFINITIONS AND INTERPRETATION
1.1  In this Agreement the terms below have the meanings given to them in this clause one.
2. SALE AND PURCHASE
2.1  The Seller shall sell, and the Buyer shall purchase, the Sale Shares free from all Encumbrances.
7. LIMITATION OF SELLER'S LIABILITY
[JUNIOR TO DRAFT: Limitation of Seller's liability. We act for the Buyer. Cover: time limits for Claims.]
13. GOVERNING LAW AND DISPUTE RESOLUTION
13.1  This Agreement shall be governed by the laws of Singapore and the parties submit to its courts.
"""


class RetrievalTests(unittest.TestCase):
    def test_splits_top_level_clauses_and_skips_stubs(self) -> None:
        heads = [h for h, _ in r.split_clauses(SPA)]
        self.assertEqual(heads[0], "1. Definitions And Interpretation")
        self.assertIn("7. Limitation Of Seller'S Liability", heads)
        self.assertIn("13. Governing Law And Dispute Resolution", heads)

    def test_no_headings_gives_no_clauses(self) -> None:
        self.assertEqual(r.split_clauses("Just a paragraph of text."), [])

    def test_draft_does_not_cite_itself(self) -> None:
        self.assertTrue(r._same_document("04_SPA_Tidewater_WIP.docx", "04_SPA_Tidewater_WIP.docx - Google Docs"))
        self.assertTrue(r._same_document("04_SPA_Tidewater_WIP", "04_SPA_Tidewater_WIP.DOCX"))
        self.assertFalse(r._same_document("Meranti SPA", "04_SPA_Tidewater_WIP.docx"))
        self.assertFalse(r._same_document("Meranti SPA", None))


if __name__ == "__main__":
    unittest.main()


class LessonSourceTests(unittest.TestCase):
    def test_lessons_are_numbered_sources(self) -> None:
        lessons = [{"title": "Exact deadlines (from Sarah Chen, v1.pdf)", "body": "Give the date.",
                    "date": "2026-10-06"}]
        sources, block = r._collect_sources([], [], [], lessons)
        self.assertEqual(sources["S1"]["kind"], "lesson")
        self.assertIn("[S1] (lesson) Exact deadlines", block)
        self.assertIn("Give the date.", block)
