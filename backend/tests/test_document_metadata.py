import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import postgresql
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import JSONB

from app.models import Document, KnowledgeBankEntry
from app.services.birdie_document_service import execute_document_tool
from app.services.catalogue_service import (
    apply_catalogue,
    normalise_tags,
    parse_catalogue_response,
    parse_entry_metadata_response,
)
from app.services.entry_metadata_service import generate_note_metadata
from app.services.document_catalogue_service import (
    DocumentMetadataError,
    list_document_tags,
    search_document_catalogue,
    update_document_metadata,
)


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class NormaliseTagsTests(unittest.TestCase):
    def test_lowercases_trims_and_dedupes(self) -> None:
        self.assertEqual(normalise_tags(["  HDB  Resale ", "hdb resale", "Tampines"]), ["hdb resale", "tampines"])

    def test_drops_non_strings_and_empties(self) -> None:
        self.assertEqual(normalise_tags(["", None, 3, "nda"]), ["nda"])

    def test_caps_count_and_length(self) -> None:
        tags = normalise_tags([f"tag{i}" for i in range(30)])
        self.assertEqual(len(tags), 12)
        self.assertEqual(len(normalise_tags(["x" * 200])[0]), 40)

    def test_non_list_is_empty(self) -> None:
        self.assertEqual(normalise_tags("nda"), [])


class ParseCatalogueTests(unittest.TestCase):
    def test_reads_tags_and_summary(self) -> None:
        content = json.dumps({
            "document_type": "OTP",
            "document_status": "Signed",
            "summary": "Option to purchase a flat in Tampines.",
            "tags": ["OTP", "Tampines"],
        })
        parsed = parse_catalogue_response(content)
        self.assertEqual(parsed["tags"], ["otp", "tampines"])
        self.assertEqual(parsed["summary"], "Option to purchase a flat in Tampines.")

    def test_missing_tags_and_summary_are_empty(self) -> None:
        parsed = parse_catalogue_response(json.dumps({"document_type": "NDA"}))
        self.assertEqual(parsed["tags"], [])
        self.assertIsNone(parsed["summary"])


class ApplyCatalogueTests(unittest.TestCase):
    def _catalogue(self, **overrides):
        base = {
            "document_type": "NDA",
            "document_status": "Draft",
            "execution_date": None,
            "tags": ["nda", "meridian"],
            "summary": "Mutual NDA.",
            "fields": {},
            "parties": [],
            "key_dates": [],
            "amounts": [],
            "type_fields": {},
        }
        base.update(overrides)
        return base

    def test_writes_fresh_values_when_nothing_edited(self) -> None:
        entry = SimpleNamespace(tags=[], document_type=None, document_status=None,
                                execution_date=None, catalogue_fields=None)
        apply_catalogue(entry, self._catalogue())
        self.assertEqual(entry.tags, ["nda", "meridian"])
        self.assertEqual(entry.document_type, "NDA")
        self.assertEqual(entry.catalogue_fields["summary"], "Mutual NDA.")
        self.assertEqual(entry.catalogue_fields["edited_fields"], [])

    def test_keeps_fields_a_person_edited(self) -> None:
        entry = SimpleNamespace(
            tags=["my tag"],
            document_type="Lease",
            document_status="Draft",
            execution_date=None,
            catalogue_fields={"summary": "My summary", "edited_fields": ["tags", "summary", "document_type"]},
        )
        apply_catalogue(entry, self._catalogue())
        self.assertEqual(entry.tags, ["my tag"])
        self.assertEqual(entry.document_type, "Lease")
        self.assertEqual(entry.catalogue_fields["summary"], "My summary")
        # Unedited fields still take the fresh extraction.
        self.assertEqual(entry.document_status, "Draft")
        self.assertEqual(entry.catalogue_fields["edited_fields"], ["document_type", "summary", "tags"])


class SearchSqlTests(unittest.TestCase):
    def test_tag_filter_uses_jsonb_containment(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        user = SimpleNamespace(id="u-1")
        asyncio.run(search_document_catalogue(db, user=user, tags=["NDA", "Meridian"]))
        stmt = db.execute.call_args.args[0]
        self.assertIn("@>", str(stmt.compile(dialect=postgresql.dialect())))
        params = list(stmt.compile(dialect=postgresql.dialect()).params.values())
        self.assertIn(["nda"], params)
        self.assertIn(["meridian"], params)

    def test_access_filter_always_applied(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        asyncio.run(search_document_catalogue(db, user=SimpleNamespace(id="u-1"), matter_id="m-1"))
        sql = _sql(db.execute.call_args.args[0])
        self.assertIn("documents.user_id = 'u-1'", sql)
        self.assertIn("documents.matter_id = 'm-1'", sql)
        self.assertIn("documents.status = 'ready'", sql)

    def test_documents_are_found_whatever_their_entry_type(self) -> None:
        # Older entries, or ones retyped in the reader, are not entry_type "document".
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        asyncio.run(search_document_catalogue(db, user=SimpleNamespace(id="u-1")))
        # The SELECT list names the column; only the WHERE clause must not filter on it.
        self.assertNotIn("entry_type", _sql(db.execute.call_args.args[0]).split("WHERE", 1)[1])
        list_document_tags(db, user=SimpleNamespace(id="u-1"))
        self.assertNotIn("entry_type", _sql(db.execute.call_args.args[0]).split("WHERE", 1)[1])

    def test_tag_list_query_compiles(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        list_document_tags(db, user=SimpleNamespace(id="u-1"))
        self.assertIn("jsonb_array_elements_text", _sql(db.execute.call_args.args[0]))


class UpdateMetadataTests(unittest.TestCase):
    def test_rejects_unknown_document_type(self) -> None:
        entry = SimpleNamespace(id="e-1", matter_id=None, version=1, tags=[], catalogue_fields=None,
                                document_type=None, document_status=None, execution_date=None,
                                embedding_content_hash="x", embedding=None)
        document = SimpleNamespace(id="d-1", matter_id=None)
        db = MagicMock()
        db.get.return_value = document
        with patch("app.services.document_catalogue_service.can_access_document", return_value=True), \
             patch("app.services.document_catalogue_service._metadata_entry", return_value=entry):
            with self.assertRaises(DocumentMetadataError):
                asyncio.run(update_document_metadata(
                    db, user=SimpleNamespace(id="u-1"), document_id="d-1",
                    updates={"document_type": "Bogus"},
                ))

    def test_returns_none_for_inaccessible_document(self) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id="d-1", matter_id="m-9")
        with patch("app.services.document_catalogue_service.can_access_document", return_value=False):
            result = asyncio.run(update_document_metadata(
                db, user=SimpleNamespace(id="u-1"), document_id="d-1", updates={"tags": ["x"]},
            ))
        self.assertIsNone(result)


class BirdieDocumentToolTests(unittest.TestCase):
    def test_read_refuses_inaccessible_document(self) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(id="d-1", status="ready", filename="x.pdf")
        with patch("app.services.birdie_document_service.can_access_document", return_value=False):
            result = asyncio.run(execute_document_tool(
                "read_document", {"document_id": "d-1"}, db=db, user=SimpleNamespace(id="u-1"), matter_id=None,
            ))
        self.assertEqual(result, {"error": "Document not found or not accessible."})

    def test_read_refuses_missing_document_with_same_message(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        result = asyncio.run(execute_document_tool(
            "read_document", {"document_id": "nope"}, db=db, user=SimpleNamespace(id="u-1"), matter_id=None,
        ))
        self.assertEqual(result, {"error": "Document not found or not accessible."})

    def test_find_defaults_to_current_matter(self) -> None:
        db = MagicMock()
        with patch("app.services.birdie_document_service.search_document_catalogue", return_value=[]) as search:
            asyncio.run(execute_document_tool(
                "find_documents", {"query": "otp"}, db=db, user=SimpleNamespace(id="u-1"), matter_id="m-1",
            ))
        self.assertEqual(search.call_args.kwargs["matter_id"], "m-1")

    def test_find_all_matters_only_when_true(self) -> None:
        db = MagicMock()
        with patch("app.services.birdie_document_service.search_document_catalogue", return_value=[]) as search:
            asyncio.run(execute_document_tool(
                "find_documents", {"all_matters": "yes"}, db=db, user=SimpleNamespace(id="u-1"), matter_id="m-1",
            ))
        self.assertEqual(search.call_args.kwargs["matter_id"], "m-1")


class NoteMetadataTests(unittest.TestCase):
    def _note(self, **overrides):
        base = dict(
            id="e-1", title="Client prefs", body_markdown="Plain English drafts.", tags=[],
            catalogue_fields=None, source_document_id=None, pii_status="clean",
            created_by="u-1", status="ready",
        )
        base.update(overrides)
        return SimpleNamespace(**base)

    def test_parses_summary_and_tags(self) -> None:
        parsed = parse_entry_metadata_response(json.dumps({"summary": "Drafting style.", "tags": ["Drafting"]}))
        self.assertEqual(parsed, {"summary": "Drafting style.", "tags": ["drafting"]})

    def test_skips_flagged_notes_without_calling_llm(self) -> None:
        note = self._note(pii_status="flagged")
        with patch("app.services.entry_metadata_service.get_llm") as get_llm:
            asyncio.run(generate_note_metadata(MagicMock(), note))
        get_llm.assert_not_called()
        self.assertEqual(note.tags, [])

    def test_skips_document_backed_entries(self) -> None:
        note = self._note(source_document_id="d-1")
        with patch("app.services.entry_metadata_service.get_llm") as get_llm:
            asyncio.run(generate_note_metadata(MagicMock(), note))
        get_llm.assert_not_called()

    def test_fills_unedited_fields(self) -> None:
        note = self._note()
        result = {"summary": "Drafting style.", "tags": ["drafting"]}
        with patch("app.services.entry_metadata_service.get_llm"), \
             patch("app.services.entry_metadata_service.extract_entry_metadata", return_value=result):
            asyncio.run(generate_note_metadata(MagicMock(), note))
        self.assertEqual(note.tags, ["drafting"])
        self.assertEqual(note.catalogue_fields["summary"], "Drafting style.")

    def test_keeps_tags_a_person_set(self) -> None:
        note = self._note(tags=["mine"], catalogue_fields={"edited_fields": ["tags"]})
        result = {"summary": "Drafting style.", "tags": ["drafting"]}
        with patch("app.services.entry_metadata_service.get_llm"), \
             patch("app.services.entry_metadata_service.extract_entry_metadata", return_value=result):
            asyncio.run(generate_note_metadata(MagicMock(), note))
        self.assertEqual(note.tags, ["mine"])
        self.assertEqual(note.catalogue_fields["summary"], "Drafting style.")

    def test_missing_key_leaves_note_unchanged(self) -> None:
        note = self._note()
        with patch("app.services.entry_metadata_service.get_llm", side_effect=RuntimeError("no key")):
            asyncio.run(generate_note_metadata(MagicMock(), note))
        self.assertEqual(note.tags, [])


if __name__ == "__main__":
    unittest.main()
