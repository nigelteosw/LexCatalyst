import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

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

    def test_admin_emails_default_to_empty_when_unset(self) -> None:
        import importlib
        import os

        from app import config

        with patch.dict(os.environ, {"ADMIN_EMAILS": ""}, clear=False):
            reloaded = importlib.reload(config)
            try:
                self.assertEqual(reloaded.Settings(jwt_secret_key="x" * 32).admin_emails, [])
            finally:
                importlib.reload(config)

    def test_production_requires_admin_emails_and_encryption_key(self) -> None:
        base = {"jwt_secret_key": "x" * 32, "environment": "production"}

        with self.assertRaises(ValidationError):
            Settings(**base, admin_emails=[], field_encryption_key="k" * 32)

        with self.assertRaises(ValidationError):
            Settings(**base, admin_emails=["ops@example.com"], field_encryption_key="")

        settings = Settings(
            **base, admin_emails=["ops@example.com"], field_encryption_key="k" * 32
        )
        self.assertEqual(settings.admin_emails, ["ops@example.com"])

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
        db.scalar.return_value = handoff  # row lock re-fetch
        user = SimpleNamespace(id="reviewer")
        schema = ReviewAnnotationCreate(
            document_id="other-document",
            page_no=1,
            kind="highlight",
            anchor_quote="Clause text",
            anchor_rects=[{"pageIndex": 0, "left": 1, "top": 1, "width": 1, "height": 1}],
        )

        create_annotation(db, handoff=handoff, user=user, schema=schema)

        annotation = db.add.call_args.args[0]
        self.assertEqual(annotation.document_id, "owned-document")


if __name__ == "__main__":
    unittest.main()
