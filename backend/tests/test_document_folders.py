import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.document_folder_service import (
    can_manage_folder,
    create_folder,
    require_folder_access,
)
from app.services.document_service import update_user_document


def _user(uid="u-1", admin=False, role="associate"):
    return SimpleNamespace(id=uid, is_admin=admin, firm_role=role)


class FolderAccessTests(unittest.TestCase):
    def test_general_folder_is_private_to_creator(self) -> None:
        folder = SimpleNamespace(matter_id=None, created_by="u-1")
        require_folder_access(MagicMock(), _user("u-1"), folder)
        with self.assertRaises(HTTPException) as raised:
            require_folder_access(MagicMock(), _user("u-2"), folder)
        self.assertEqual(raised.exception.status_code, 404)

    def test_matter_folder_requires_membership(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None  # not a member
        folder = SimpleNamespace(matter_id="m-1", created_by="u-1")
        with self.assertRaises(HTTPException) as raised:
            require_folder_access(db, _user("u-2"), folder)
        self.assertEqual(raised.exception.status_code, 403)

    def test_manage_is_creator_or_partner(self) -> None:
        folder = SimpleNamespace(created_by="u-1")
        self.assertTrue(can_manage_folder(_user("u-1"), folder))
        self.assertFalse(can_manage_folder(_user("u-2"), folder))
        self.assertTrue(can_manage_folder(_user("u-3", role="partner"), folder))

    def test_blank_name_rejected(self) -> None:
        with self.assertRaises(ValueError):
            create_folder(MagicMock(), _user(), name="   ", matter_id=None)


class DocumentFolderMoveTests(unittest.TestCase):
    def _doc(self, matter="m-1", folder="f-1"):
        return SimpleNamespace(
            id="d-1", filename="a.pdf", matter_id=matter, folder_id=folder, user_id="u-1", updated_at=None,
        )

    def test_changing_matter_clears_folder(self) -> None:
        db = MagicMock()
        doc = self._doc()
        db.scalar.return_value = doc
        with patch("app.services.document_service.sync_metadata_safe"):
            update_user_document(
                db, user_id="u-1", document_id="d-1", filename=None,
                matter_id="m-2", set_matter=True,
            )
        self.assertEqual(doc.matter_id, "m-2")
        self.assertIsNone(doc.folder_id)

    def test_folder_from_other_matter_rejected(self) -> None:
        db = MagicMock()
        doc = self._doc()
        db.scalar.return_value = doc
        db.get.return_value = SimpleNamespace(matter_id="m-9", created_by="u-1")
        with self.assertRaises(ValueError):
            update_user_document(
                db, user_id="u-1", document_id="d-1", filename=None,
                matter_id=None, set_matter=False, folder_id="f-9", set_folder=True,
            )

    def test_folder_in_same_matter_accepted(self) -> None:
        db = MagicMock()
        doc = self._doc(folder=None)
        db.scalar.return_value = doc
        db.get.return_value = SimpleNamespace(matter_id="m-1", created_by="u-1")
        with patch("app.services.document_service.sync_metadata_safe"):
            update_user_document(
                db, user_id="u-1", document_id="d-1", filename=None,
                matter_id=None, set_matter=False, folder_id="f-2", set_folder=True,
            )
        self.assertEqual(doc.folder_id, "f-2")
