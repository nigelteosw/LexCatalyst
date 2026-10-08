"""Encryption and fingerprints for users' OpenRouter keys.

Keys are sealed with AES-256-GCM under OPENROUTER_KEY_ENCRYPTION_KEY, a secret that is separate
from FIELD_ENCRYPTION_KEY (PII) so a leak of one does not expose the other. The user id is bound
as associated data, so a ciphertext copied onto another user's row will not decrypt.

Ciphertext format: `v2:<key_id>:<base64 nonce>:<base64 ciphertext>`. `key_id` names which secret
sealed the value, so OPENROUTER_KEY_ENCRYPTION_KEYS_OLD can still open values during rotation.

Fingerprints are HMAC-SHA256 under a key derived from the same secret. They identify a key
without decrypting it.

Outside development, OPENROUTER_KEY_ENCRYPTION_KEY is required (see app.config). In development
a key is derived from JWT_SECRET_KEY so local setup works without extra configuration.
"""

import base64
import hashlib
import hmac
import os
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

PREFIX = "v2"
_NONCE_BYTES = 12
_FINGERPRINT_LABEL = b"openrouter-key-fingerprint"


class SecretUnavailable(RuntimeError):
    """The stored secret cannot be opened with any configured key."""


def _derive(secret: str) -> bytes:
    return hashlib.sha256(b"lexcatalyst-openrouter-key:" + secret.encode("utf-8")).digest()


def _key_id(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:8]


@lru_cache
def _current() -> tuple[str, bytes]:
    settings = get_settings()
    secret = (settings.openrouter_key_encryption_key or "").strip()
    if not secret:
        # Development fallback only; config refuses to start without a key elsewhere.
        secret = "dev:" + settings.jwt_secret_key
    raw = _derive(secret)
    return _key_id(raw), raw


@lru_cache
def _previous() -> dict[str, bytes]:
    keys: dict[str, bytes] = {}
    for secret in get_settings().openrouter_key_encryption_keys_old:
        raw = _derive(secret.strip())
        keys[_key_id(raw)] = raw
    return keys


def clear_caches() -> None:
    """Forget derived keys (tests, and after settings change)."""
    _current.cache_clear()
    _previous.cache_clear()


def encrypt_secret(plaintext: str, *, user_id: str) -> str:
    key_id, raw = _current()
    nonce = os.urandom(_NONCE_BYTES)
    sealed = AESGCM(raw).encrypt(nonce, plaintext.encode("utf-8"), user_id.encode("utf-8"))
    return ":".join(
        [
            PREFIX,
            key_id,
            base64.urlsafe_b64encode(nonce).decode("ascii"),
            base64.urlsafe_b64encode(sealed).decode("ascii"),
        ]
    )


def decrypt_secret(ciphertext: str, *, user_id: str) -> str:
    try:
        prefix, key_id, nonce_b64, sealed_b64 = ciphertext.split(":")
        if prefix != PREFIX:
            raise ValueError("unknown format")
        nonce = base64.urlsafe_b64decode(nonce_b64)
        sealed = base64.urlsafe_b64decode(sealed_b64)
    except ValueError as exc:
        raise SecretUnavailable("malformed secret") from exc

    current_id, current_raw = _current()
    raw = current_raw if key_id == current_id else _previous().get(key_id)
    if raw is None:
        raise SecretUnavailable("secret was sealed with an unknown key")
    try:
        return AESGCM(raw).decrypt(nonce, sealed, user_id.encode("utf-8")).decode("utf-8")
    except InvalidTag as exc:
        raise SecretUnavailable("secret failed to open") from exc


def fingerprint(plaintext: str) -> str:
    _, raw = _current()
    mac_key = hmac.new(raw, _FINGERPRINT_LABEL, hashlib.sha256).digest()
    return hmac.new(mac_key, plaintext.encode("utf-8"), hashlib.sha256).hexdigest()
