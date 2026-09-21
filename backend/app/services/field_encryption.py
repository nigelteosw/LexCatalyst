import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

PREFIX = "enc:"
# Key-id prefix for values encrypted with FIELD_ENCRYPTION_KEY. Legacy values carry a bare
# `enc:` prefix and are still readable via the JWT-derived key, so rotation is a migration
# rather than data loss.
V1_PREFIX = "enc:v1:"
LEGACY_PREFIX = PREFIX


def _fernet_from_secret(secret: str) -> Fernet:
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


@lru_cache
def _v1_fernet() -> Fernet | None:
    key = (get_settings().field_encryption_key or "").strip()
    if not key:
        return None
    return _fernet_from_secret(key)


@lru_cache
def _legacy_fernet() -> Fernet:
    return _fernet_from_secret(get_settings().jwt_secret_key)


def encrypt_text(value: str | None) -> str | None:
    if value is None or value.startswith(PREFIX):
        return value
    fernet = _v1_fernet()
    if fernet is not None:
        token = fernet.encrypt(value.encode("utf-8")).decode("ascii")
        return f"{V1_PREFIX}{token}"
    # Development fallback: no dedicated key configured. Config refuses to start this way
    # outside development.
    token = _legacy_fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{LEGACY_PREFIX}{token}"


def decrypt_text(value: str | None) -> str | None:
    if value is None or not value.startswith(PREFIX):
        return value
    if value.startswith(V1_PREFIX):
        fernet = _v1_fernet()
        payload = value[len(V1_PREFIX) :]
    else:
        fernet = _legacy_fernet()
        payload = value[len(LEGACY_PREFIX) :]
    if fernet is None:
        return "[Encrypted value unavailable]"
    try:
        return fernet.decrypt(payload.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return "[Encrypted value unavailable]"
