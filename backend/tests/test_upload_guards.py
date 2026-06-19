import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.routers.documents import _check_upload_limits

_ONE_GB = 1 * 1024 * 1024 * 1024


class UploadGuardTests(unittest.TestCase):
    def test_admin_bypasses_all_limits(self) -> None:
        db = MagicMock()
        user = SimpleNamespace(is_admin=True)
        _check_upload_limits(db, user, 10 * _ONE_GB)
        db.scalar.assert_not_called()

    def test_total_doc_cap_raises_429(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [50]
        user = SimpleNamespace(is_admin=False, id="u1")
        with self.assertRaises(HTTPException) as ctx:
            _check_upload_limits(db, user, 1)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("50 max", ctx.exception.detail)

    def test_daily_rate_limit_raises_429(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [5, 10]
        user = SimpleNamespace(is_admin=False, id="u1")
        with self.assertRaises(HTTPException) as ctx:
            _check_upload_limits(db, user, 1)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("10 per day", ctx.exception.detail)

    def test_storage_limit_raises_429(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [5, 3, _ONE_GB - 100]
        user = SimpleNamespace(is_admin=False, id="u1")
        with self.assertRaises(HTTPException) as ctx:
            _check_upload_limits(db, user, 200)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("1 GB", ctx.exception.detail)

    def test_under_all_limits_passes(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [5, 3, 100 * 1024 * 1024]
        user = SimpleNamespace(is_admin=False, id="u1")
        _check_upload_limits(db, user, 1 * 1024 * 1024)

    def test_storage_null_used_treated_as_zero(self) -> None:
        db = MagicMock()
        db.scalar.side_effect = [0, 0, None]
        user = SimpleNamespace(is_admin=False, id="u1")
        _check_upload_limits(db, user, 1 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
