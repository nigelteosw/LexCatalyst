import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import field_encryption as fe


def _settings(field_key: str | None):
    return SimpleNamespace(jwt_secret_key="j" * 32, field_encryption_key=field_key)


class FieldEncryptionTests(unittest.TestCase):
    def setUp(self) -> None:
        fe._v1_fernet.cache_clear()
        fe._legacy_fernet.cache_clear()
        self.addCleanup(fe._v1_fernet.cache_clear)
        self.addCleanup(fe._legacy_fernet.cache_clear)

    def test_roundtrip_uses_versioned_prefix(self) -> None:
        with patch.object(fe, "get_settings", lambda: _settings("k" * 32)):
            token = fe.encrypt_text("Acme Corp")
            self.assertTrue(token.startswith(fe.V1_PREFIX))
            self.assertEqual(fe.decrypt_text(token), "Acme Corp")

    def test_rotating_jwt_secret_does_not_break_v1_values(self) -> None:
        with patch.object(fe, "get_settings", lambda: _settings("k" * 32)):
            token = fe.encrypt_text("Acme Corp")
        fe._v1_fernet.cache_clear()
        fe._legacy_fernet.cache_clear()
        rotated = SimpleNamespace(jwt_secret_key="rotated" * 8, field_encryption_key="k" * 32)
        with patch.object(fe, "get_settings", lambda: rotated):
            self.assertEqual(fe.decrypt_text(token), "Acme Corp")

    def test_legacy_values_remain_readable(self) -> None:
        with patch.object(fe, "get_settings", lambda: _settings(None)):
            legacy = fe.encrypt_text("Acme Corp")
            self.assertTrue(legacy.startswith(fe.LEGACY_PREFIX))
            self.assertFalse(legacy.startswith(fe.V1_PREFIX))
        fe._v1_fernet.cache_clear()
        fe._legacy_fernet.cache_clear()
        with patch.object(fe, "get_settings", lambda: _settings("k" * 32)):
            self.assertEqual(fe.decrypt_text(legacy), "Acme Corp")

    def test_plain_values_pass_through(self) -> None:
        with patch.object(fe, "get_settings", lambda: _settings("k" * 32)):
            self.assertIsNone(fe.decrypt_text(None))
            self.assertEqual(fe.decrypt_text("Acme Corp"), "Acme Corp")


if __name__ == "__main__":
    unittest.main()
