import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services import secret_store as ss


def _settings(current: str, old: list[str] | None = None):
    return SimpleNamespace(
        jwt_secret_key="j" * 32,
        openrouter_key_encryption_key=current,
        openrouter_key_encryption_keys_old=old or [],
    )


class SecretStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        ss.clear_caches()
        self.addCleanup(ss.clear_caches)

    def _use(self, current: str, old: list[str] | None = None):
        ss.clear_caches()
        return patch.object(ss, "get_settings", lambda: _settings(current, old))

    def test_roundtrip_hides_plaintext(self) -> None:
        with self._use("s" * 32):
            sealed = ss.encrypt_secret("sk-or-v1-secretvalue", user_id="user-1")
            self.assertNotIn("secretvalue", sealed)
            self.assertTrue(sealed.startswith("v2:"))
            self.assertEqual(ss.decrypt_secret(sealed, user_id="user-1"), "sk-or-v1-secretvalue")

    def test_ciphertext_is_bound_to_user(self) -> None:
        with self._use("s" * 32):
            sealed = ss.encrypt_secret("sk-or-v1-secretvalue", user_id="user-1")
            with self.assertRaises(ss.SecretUnavailable):
                ss.decrypt_secret(sealed, user_id="user-2")

    def test_old_secret_still_opens_after_rotation(self) -> None:
        with self._use("old-secret-value-0123456789abcdef"):
            sealed = ss.encrypt_secret("sk-or-v1-secretvalue", user_id="user-1")
        with self._use("new-secret-value-0123456789abcdef", ["old-secret-value-0123456789abcdef"]):
            self.assertEqual(ss.decrypt_secret(sealed, user_id="user-1"), "sk-or-v1-secretvalue")

    def test_unknown_key_id_is_unavailable(self) -> None:
        with self._use("a" * 32):
            sealed = ss.encrypt_secret("sk-or-v1-secretvalue", user_id="user-1")
        with self._use("b" * 32):
            with self.assertRaises(ss.SecretUnavailable):
                ss.decrypt_secret(sealed, user_id="user-1")

    def test_fingerprint_is_stable_and_secret_dependent(self) -> None:
        with self._use("s" * 32):
            first = ss.fingerprint("sk-or-v1-abc")
            self.assertEqual(first, ss.fingerprint("sk-or-v1-abc"))
            self.assertNotEqual(first, ss.fingerprint("sk-or-v1-abd"))
        with self._use("t" * 32):
            self.assertNotEqual(first, ss.fingerprint("sk-or-v1-abc"))

    def test_malformed_value_is_unavailable(self) -> None:
        with self._use("s" * 32):
            with self.assertRaises(ss.SecretUnavailable):
                ss.decrypt_secret("not-a-secret", user_id="user-1")


if __name__ == "__main__":
    unittest.main()
