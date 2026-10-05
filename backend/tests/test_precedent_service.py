import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import precedent_service as ps
from app.services.rag_service import DocumentSearchResult


class ClassifyClauseTests(unittest.TestCase):
    def test_option_period(self) -> None:
        text = "The Option Period shall be fourteen (14) days within which the Purchaser may exercise the Option."
        self.assertEqual(ps.classify_clause(text), "option_period")

    def test_governing_law(self) -> None:
        self.assertEqual(
            ps.classify_clause("This Agreement shall be governed by the laws of Singapore."), "governing_law"
        )

    def test_unknown_is_other(self) -> None:
        self.assertEqual(ps.classify_clause("The parties met on Tuesday."), "other")


class ExtractTermsTests(unittest.TestCase):
    def test_days_with_words_and_digits(self) -> None:
        term = ps.extract_terms("fourteen (14) days after the date of grant", "option_period")
        self.assertEqual(term, ps.Term(kind="days", value="14", label="14 days"))

    def test_business_days(self) -> None:
        self.assertEqual(ps.extract_terms("within 5 business days", "notice").label, "5 business days")

    def test_percent(self) -> None:
        self.assertEqual(ps.extract_terms("capped at 10 per cent of fees", "limitation_of_liability").label, "10%")

    def test_amount(self) -> None:
        self.assertEqual(
            ps.extract_terms("not exceed S$500,000 in aggregate", "limitation_of_liability").label, "S$500,000"
        )

    def test_jurisdiction_wins_for_governing_law(self) -> None:
        term = ps.extract_terms("within 30 days ... governed by the laws of the Republic of Singapore", "governing_law")
        self.assertEqual(term, ps.Term(kind="jurisdiction", value="Singapore", label="Singapore"))

    def test_none_when_no_variable(self) -> None:
        self.assertIsNone(ps.extract_terms("The parties shall cooperate.", "other"))


class SummariseTermsTests(unittest.TestCase):
    def test_counts_and_orders(self) -> None:
        d = lambda n: ps.Term("days", str(n), f"{n} days")
        summary = ps.summarise_terms([d(21), d(14), d(21), None, d(30), d(21), d(14)])
        self.assertEqual(
            summary,
            [{"label": "21 days", "count": 3}, {"label": "14 days", "count": 2}, {"label": "30 days", "count": 1}],
        )


def _chunk(document_id: str, text: str) -> DocumentSearchResult:
    return DocumentSearchResult(
        chunk_id=f"c-{document_id}", document_id=document_id, filename=f"{document_id}.pdf",
        text=text, score=0.9, page_number=1, citation_label=f"{document_id}.pdf p.1",
    )


class SearchPrecedentsTests(unittest.IsolatedAsyncioTestCase):
    async def test_ranks_executed_first_and_anonymises_kb_matter(self) -> None:
        user = MagicMock(id="u1")
        meta = {
            "d-draft": ps.DocumentMeta("Draft SPA.pdf", "MAT-1", datetime(2025, 1, 2, tzinfo=UTC), "Alex", "draft"),
            "d-exec": ps.DocumentMeta("Signed SPA.pdf", "MAT-2", datetime(2024, 5, 6, tzinfo=UTC), "Sam", "executed"),
        }
        kb_entry = MagicMock(
            id="k1", title="Option clause precedent", body_markdown="Option Period of 30 days.",
            matter_id="m9", updated_at=datetime(2023, 3, 4, tzinfo=UTC), source_document_id=None,
        )
        kb_entry.creator.full_name = "Partner P"
        with (
            patch.object(ps, "search_documents", AsyncMock(return_value=[
                _chunk("d-draft", "Option Period of 14 days."), _chunk("d-exec", "Option Period of 21 days."),
            ])) as docs,
            patch.object(ps, "search_kb_for_chat", AsyncMock(return_value=[kb_entry])) as kb,
            patch.object(ps, "_load_document_meta", return_value=meta),
        ):
            clause_type, results = await ps.search_precedents(
                MagicMock(), user=user, text="The Option Period shall be 14 days"
            )

        self.assertEqual(clause_type, "option_period")
        self.assertEqual([r.id for r in results], ["c-d-exec", "c-d-draft", "k1"])
        self.assertEqual(results[0].status, "executed")
        self.assertEqual(results[0].matter_ref, "MAT-2")
        self.assertEqual(results[2].matter_ref, "[MATTER]")
        self.assertEqual(results[2].term.label, "30 days")
        self.assertEqual(docs.call_args.kwargs["user_id"], "u1")
        self.assertIsNone(kb.call_args.kwargs["matter_id"])

    def test_payload_shape(self) -> None:
        result = ps.PrecedentResult(
            id="c1", source_type="document", excerpt="x", document_title="Signed SPA.pdf", matter_ref="MAT-2",
            date="2024-05-06", author="Sam", status="executed", document_id="d1",
            term=ps.Term("days", "21", "21 days"),
        )
        payload = ps.precedent_payload("option_period", [result])
        self.assertEqual(payload["terms_summary"], [{"label": "21 days", "count": 1}])
        self.assertEqual(payload["results"][0]["term"], {"kind": "days", "value": "21", "label": "21 days"})
        self.assertEqual(payload["results"][0]["document_id"], "d1")


if __name__ == "__main__":
    unittest.main()
