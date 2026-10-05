import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from sqlalchemy.dialects import postgresql

from app.services.organization_service import delete_matter


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class DeleteMatterTests(unittest.TestCase):
    def test_returns_false_when_missing(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        self.assertFalse(delete_matter(db, "missing"))
        db.delete.assert_not_called()

    def test_moves_linked_records_to_general_then_deletes(self) -> None:
        db = MagicMock()
        matter = SimpleNamespace(id="m-1")
        db.get.return_value = matter

        self.assertTrue(delete_matter(db, "m-1"))

        joined = "\n".join(_sql(call.args[0]) for call in db.execute.call_args_list)
        self.assertIn("UPDATE wiki_pages SET matter_id=NULL", joined)
        self.assertIn("UPDATE kb_entries SET scope='private'", joined)
        self.assertIn("UPDATE resource_metadata SET scope='private'", joined)
        db.delete.assert_called_once_with(matter)
        db.commit.assert_called_once()


from app.services.chat_service import GENERAL, list_threads, update_thread


class ThreadScopingTests(unittest.TestCase):
    def _where(self, db) -> str:
        # Only the WHERE..ORDER BY slice; the SELECT list also names matter_id.
        sql = _sql(db.scalars.call_args.args[0])
        return sql.split("WHERE", 1)[1].split("ORDER BY", 1)[0]

    def test_general_filter_selects_null_matter(self) -> None:
        db = MagicMock()
        list_threads(db, "u-1", matter_filter=GENERAL)
        self.assertIn("chat_threads.matter_id IS NULL", self._where(db))

    def test_matter_filter_selects_that_matter(self) -> None:
        db = MagicMock()
        list_threads(db, "u-1", matter_filter="m-1")
        self.assertIn("chat_threads.matter_id = 'm-1'", self._where(db))

    def test_no_filter_returns_all_user_threads(self) -> None:
        db = MagicMock()
        list_threads(db, "u-1")
        self.assertNotIn("matter_id", self._where(db))

    def test_update_thread_can_clear_matter(self) -> None:
        db = MagicMock()
        thread = SimpleNamespace(id="t-1", title="Old", matter_id="m-1", updated_at=None)
        db.scalar.return_value = thread
        update_thread(db, user_id="u-1", thread_id="t-1", title=None, matter_id=None, set_matter=True)
        self.assertIsNone(thread.matter_id)
        self.assertEqual(thread.title, "Old")


from unittest.mock import patch

from app.services.document_service import update_user_document


class DocumentReassignTests(unittest.TestCase):
    def test_moves_document_and_resyncs_metadata(self) -> None:
        db = MagicMock()
        document = SimpleNamespace(id="d-1", filename="a.pdf", matter_id="m-1", user_id="u-1", updated_at=None)
        db.scalar.return_value = document
        with patch("app.services.document_service.sync_metadata_safe") as sync:
            update_user_document(
                db, user_id="u-1", document_id="d-1", filename=None, matter_id="m-2", set_matter=True,
            )
        self.assertEqual(document.matter_id, "m-2")
        self.assertEqual(document.filename, "a.pdf")
        sync.assert_called_once()
