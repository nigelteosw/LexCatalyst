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
