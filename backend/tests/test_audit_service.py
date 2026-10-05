import unittest
from unittest.mock import MagicMock

from app.models import RetrievalAuditEvent
from app.services.audit_service import MAX_QUERY_CHARS, record_retrieval


class RecordRetrievalTests(unittest.TestCase):
    def test_adds_and_commits_event(self) -> None:
        db = MagicMock()
        event = record_retrieval(
            db, user_id="u1", kind="precedent_search", query="option period", returned_ids=["c1", "k2"]
        )
        self.assertIsInstance(event, RetrievalAuditEvent)
        self.assertEqual(event.user_id, "u1")
        self.assertEqual(event.kind, "precedent_search")
        self.assertEqual(event.returned_ids, ["c1", "k2"])
        db.add.assert_called_once_with(event)
        db.commit.assert_called_once()

    def test_truncates_long_queries(self) -> None:
        event = record_retrieval(MagicMock(), user_id="u1", kind="case_search", query="x" * 5000, returned_ids=[])
        self.assertEqual(len(event.query), MAX_QUERY_CHARS)


if __name__ == "__main__":
    unittest.main()
