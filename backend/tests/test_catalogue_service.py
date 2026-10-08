import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.catalogue_service import (
    catalogue_to_json,
    parse_catalogue_response,
)
from app.services.document_service import _sync_catalogue_access


def _response(**overrides) -> str:
    payload = {
        "document_type": "NDA",
        "document_status": "Signed",
        "execution_date": "2026-03-14",
        "parties": [{"name": "Meridian", "role": "discloser", "locator": "p1", "quote": "Meridian"}],
        "key_dates": [],
        "amounts": [],
        "fields": {
            "governing_law": {"value": "Singapore", "locator": "cl 6", "quote": "governed by Singapore law"},
            "liability_cap": None,
        },
        "type_fields": {
            "non_solicit_period": {"value": "12 months", "locator": "cl 9", "quote": "for 12 months"},
            "": {"value": "dropped, empty name", "locator": "", "quote": ""},
        },
    }
    payload.update(overrides)
    return json.dumps(payload)


class ParseCatalogueResponseTests(unittest.TestCase):
    def test_valid_response_is_normalised(self) -> None:
        result = parse_catalogue_response(_response())

        self.assertEqual(result["document_type"], "NDA")
        self.assertEqual(result["document_status"], "Signed")
        self.assertEqual(result["execution_date"], date(2026, 3, 14))
        self.assertEqual(result["fields"]["governing_law"]["value"], "Singapore")
        self.assertIsNone(result["fields"]["liability_cap"])
        self.assertEqual(result["parties"][0]["name"], "Meridian")
        self.assertEqual(set(result["type_fields"]), {"non_solicit_period"})

    def test_unknown_type_and_status_fall_back_to_safe_values(self) -> None:
        result = parse_catalogue_response(_response(document_type="Memo", document_status="Pending"))

        self.assertEqual(result["document_type"], "Other")
        self.assertEqual(result["document_status"], "Unknown")

    def test_bad_date_becomes_null_not_guessed(self) -> None:
        result = parse_catalogue_response(_response(execution_date="sometime in March"))

        self.assertIsNone(result["execution_date"])

    def test_fenced_json_is_accepted(self) -> None:
        fenced = "```json\n" + _response() + "\n```"

        self.assertEqual(parse_catalogue_response(fenced)["document_type"], "NDA")

    def test_invalid_json_raises(self) -> None:
        with self.assertRaises(ValueError):
            parse_catalogue_response("not json at all")

    def test_items_without_values_are_dropped(self) -> None:
        result = parse_catalogue_response(
            _response(parties=[{"role": "buyer"}, {"name": "Acme", "role": "seller"}])
        )

        self.assertEqual([p["name"] for p in result["parties"]], ["Acme"])

    def test_catalogue_serialises_date_to_iso_string(self) -> None:
        payload = catalogue_to_json(parse_catalogue_response(_response()))

        self.assertEqual(payload["execution_date"], "2026-03-14")
        json.dumps(payload)  # must be JSON-serialisable for the catalogue_fields column


class SyncCatalogueAccessTests(unittest.TestCase):
    def _db_with(self, entries):
        db = MagicMock()
        db.scalars.return_value = entries
        return db

    def test_moving_to_general_makes_mirrored_entries_private(self) -> None:
        entry = SimpleNamespace(matter_id="m-1", team_id=None, scope="matter")
        document = SimpleNamespace(id="d-1", matter_id=None, team_id=None)

        result = _sync_catalogue_access(self._db_with([entry]), document)

        self.assertEqual(result, [entry])
        self.assertEqual(entry.matter_id, None)
        self.assertEqual(entry.scope, "private")

    def test_moving_into_matter_makes_mirrored_entries_matter_scoped(self) -> None:
        entry = SimpleNamespace(matter_id=None, team_id=None, scope="private")
        document = SimpleNamespace(id="d-1", matter_id="m-2", team_id=None)

        _sync_catalogue_access(self._db_with([entry]), document)

        self.assertEqual(entry.matter_id, "m-2")
        self.assertEqual(entry.scope, "matter")

    def test_promoted_entries_keep_their_scope(self) -> None:
        entry = SimpleNamespace(matter_id="m-1", team_id=None, scope="firm_wide")
        document = SimpleNamespace(id="d-1", matter_id=None, team_id=None)

        _sync_catalogue_access(self._db_with([entry]), document)

        self.assertEqual(entry.scope, "firm_wide")
        self.assertIsNone(entry.matter_id)


if __name__ == "__main__":
    unittest.main()
