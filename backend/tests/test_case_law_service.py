import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import case_law_service as cl
from app.services.elitigation_service import Judgment, JudgmentExcerpt

HOLCIM = cl.CaseSource(
    citation="[2011] SGCA 1",
    title="Holcim (Singapore) Pte Ltd v Precise Development Pte Ltd",
    decision_date="2011-01-19",
    url="https://www.elitigation.sg/gd/s/2011_SGCA_1",
    paragraphs=[("3", "A force majeure clause must be construed according to its precise terms.")],
)


class ParseSearchPhraseTests(unittest.TestCase):
    def test_reads_phrase(self) -> None:
        self.assertEqual(cl.parse_search_phrase('{"search": "penalty clause"}'), "penalty clause")

    def test_tolerates_code_fences(self) -> None:
        self.assertEqual(cl.parse_search_phrase('```json\n{"search": "force majeure"}\n```'), "force majeure")

    def test_null_blank_and_garbage_are_none(self) -> None:
        self.assertIsNone(cl.parse_search_phrase('{"search": null}'))
        self.assertIsNone(cl.parse_search_phrase('{"search": "  "}'))
        self.assertIsNone(cl.parse_search_phrase("no json here"))


class FormatAndValidateTests(unittest.TestCase):
    def test_format_lists_citation_url_and_paragraph(self) -> None:
        block = cl.format_case_sources([HOLCIM])
        self.assertIn("[2011] SGCA 1", block)
        self.assertIn("https://www.elitigation.sg/gd/s/2011_SGCA_1", block)
        self.assertIn("[para 3]", block)
        self.assertIn("ONLY", block)

    def test_format_empty_is_empty(self) -> None:
        self.assertEqual(cl.format_case_sources([]), "")

    def test_known_citation_passes(self) -> None:
        self.assertIsNone(cl.validate_case_citations("See [2011]  SGCA 1 at [3].", [HOLCIM]))

    def test_unknown_citation_is_flagged(self) -> None:
        warning = cl.validate_case_citations("See [2015] SGCA 33.", [HOLCIM])
        self.assertIsNotNone(warning)
        self.assertIn("[2015] SGCA 33", warning)

    def test_payload_shape(self) -> None:
        self.assertEqual(
            cl.case_source_payload(HOLCIM),
            {
                "citation": "[2011] SGCA 1",
                "title": HOLCIM.title,
                "decision_date": "2011-01-19",
                "url": HOLCIM.url,
            },
        )


class FindCaseSourcesTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_search_when_model_says_no(self) -> None:
        provider = MagicMock(complete=AsyncMock(return_value='{"search": null}'))
        with patch.object(cl, "search_judgments", AsyncMock()) as search:
            result = await cl.find_case_sources(
                MagicMock(), user=MagicMock(id="u1"), provider=provider, user_message="hi", web_text=""
            )
        self.assertEqual(result, [])
        search.assert_not_called()

    async def test_searches_excerpts_and_audits(self) -> None:
        judgment = Judgment("[2011] SGCA 1", "Holcim", "2011-01-19", HOLCIM.url, [])
        provider = MagicMock(complete=AsyncMock(return_value='{"search": "force majeure"}'))
        with (
            patch.object(cl, "search_judgments", AsyncMock(return_value=[judgment])),
            patch.object(
                cl, "fetch_judgment_excerpt", AsyncMock(return_value=JudgmentExcerpt(judgment, HOLCIM.paragraphs))
            ),
            patch.object(cl, "record_retrieval") as audit,
        ):
            result = await cl.find_case_sources(
                MagicMock(), user=MagicMock(id="u1"), provider=provider, user_message="force majeure?", web_text=""
            )
        self.assertEqual([s.citation for s in result], ["[2011] SGCA 1"])
        self.assertEqual(result[0].paragraphs, HOLCIM.paragraphs)
        self.assertEqual(audit.call_args.kwargs["kind"], "case_search")
        self.assertEqual(audit.call_args.kwargs["returned_ids"], ["[2011] SGCA 1"])

    async def test_planner_failure_returns_empty(self) -> None:
        provider = MagicMock(complete=AsyncMock(side_effect=RuntimeError("down")))
        result = await cl.find_case_sources(
            MagicMock(), user=MagicMock(id="u1"), provider=provider, user_message="x", web_text=""
        )
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
