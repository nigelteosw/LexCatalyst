import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import elitigation_service as el

FIXTURES = Path(__file__).parent / "fixtures"
SEARCH_HTML = (FIXTURES / "elitigation_search.html").read_text()
JUDGMENT_HTML = (FIXTURES / "elitigation_judgment.html").read_text()


class ParseSearchResultsTests(unittest.TestCase):
    def test_parses_first_card_verbatim(self) -> None:
        first = el.parse_search_results(SEARCH_HTML, limit=5)[0]
        self.assertEqual(first.citation, "[2011] SGCA 1")
        self.assertEqual(
            first.title, "Holcim (Singapore) Pte Ltd v Precise Development Pte Ltd and another application"
        )
        self.assertEqual(first.decision_date, "2011-01-19")
        self.assertEqual(first.url, "https://www.elitigation.sg/gd/s/2011_SGCA_1")
        self.assertEqual(len(first.catchwords), 2)
        self.assertTrue(first.catchwords[0].startswith("Contract - Interpretation"))

    def test_missing_date_is_none_and_offsite_links_skipped(self) -> None:
        results = el.parse_search_results(SEARCH_HTML, limit=5)
        self.assertEqual([r.citation for r in results], ["[2011] SGCA 1", "[2023] SGHCA 13"])
        self.assertIsNone(results[1].decision_date)

    def test_respects_limit(self) -> None:
        self.assertEqual(len(el.parse_search_results(SEARCH_HTML, limit=1)), 1)


class JudgmentParagraphTests(unittest.TestCase):
    def test_extracts_numbered_paragraphs(self) -> None:
        paragraphs = el.parse_judgment_paragraphs(JUDGMENT_HTML)
        self.assertEqual([number for number, _ in paragraphs], ["1", "2", "3"])
        self.assertTrue(paragraphs[0][1].startswith("This is yet another case"))

    def test_best_paragraphs_keeps_matching_in_order(self) -> None:
        paragraphs = el.parse_judgment_paragraphs(JUDGMENT_HTML)
        best = el.best_paragraphs(paragraphs, "force majeure clause")
        self.assertEqual([number for number, _ in best], ["1", "3"])

    def test_best_paragraphs_respects_char_budget(self) -> None:
        paragraphs = [("1", "force " * 50), ("2", "force " * 50)]
        self.assertEqual(len(el.best_paragraphs(paragraphs, "force", max_chars=400)), 1)


class SearchJudgmentsTests(unittest.IsolatedAsyncioTestCase):
    async def test_sends_only_the_phrase(self) -> None:
        with patch.object(el, "_get", return_value=SEARCH_HTML) as get:
            results = await el.search_judgments("penalty clause", limit=2)
        url, params = get.call_args.args
        self.assertEqual(url, el.SEARCH_URL)
        self.assertEqual(params["SearchPhrase"], "penalty clause")
        self.assertEqual(len(results), 2)

    async def test_rejects_non_elitigation_judgment_url(self) -> None:
        judgment = el.Judgment("[2020] SGHC 1", "x", None, "https://evil.example/gd/s/2020_SGHC_1", [])
        with self.assertRaises(el.ElitigationError):
            await el.fetch_judgment_excerpt(judgment, "x")


if __name__ == "__main__":
    unittest.main()
