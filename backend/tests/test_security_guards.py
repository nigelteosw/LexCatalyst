import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException
from pydantic import ValidationError

from app.config import Settings
from app.schemas import ReviewAnnotationCreate
from app.services.review_annotation_service import create_annotation
from app.services.review_handoff_service import (
    ReviewHandoffError,
    create_handoff,
    require_handoff_access,
)


class SecurityGuardTests(unittest.TestCase):
    def test_jwt_secret_is_required(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(jwt_secret_key="")

    def test_handoff_access_denies_outsider(self) -> None:
        db = MagicMock()
        db.scalar.return_value = None
        user = SimpleNamespace(id="outsider", is_admin=False)
        handoff = SimpleNamespace(id="handoff")

        with self.assertRaises(HTTPException) as raised:
            require_handoff_access(db, user=user, handoff=handoff)

        self.assertEqual(raised.exception.status_code, 403)

    def test_handoff_creation_rejects_another_users_document(self) -> None:
        db = MagicMock()
        db.get.return_value = SimpleNamespace(user_id="owner")
        user = SimpleNamespace(id="outsider", is_admin=False)
        schema = SimpleNamespace(
            document_id="document",
            matter_id=None,
            action_id=None,
            reviewer_id=None,
        )

        with self.assertRaises(ReviewHandoffError):
            create_handoff(db, user=user, schema=schema)

    def test_annotation_uses_handoff_document(self) -> None:
        db = MagicMock()
        handoff = SimpleNamespace(
            id="handoff",
            document_id="owned-document",
            status="in_review",
        )
        user = SimpleNamespace(id="reviewer")
        schema = ReviewAnnotationCreate(
            document_id="other-document",
            page_no=1,
            kind="highlight",
            anchor_quote="Clause text",
        )

        create_annotation(db, handoff=handoff, user=user, schema=schema)

        annotation = db.add.call_args.args[0]
        self.assertEqual(annotation.document_id, "owned-document")


if __name__ == "__main__":
    unittest.main()
