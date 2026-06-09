import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

PREFIX = "enc:"


def _fernet() -> Fernet:
    digest = hashlib.sha256(get_settings().jwt_secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_text(value: str | None) -> str | None:
    if value is None or value.startswith(PREFIX):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{PREFIX}{token}"


def decrypt_text(value: str | None) -> str | None:
    if value is None or not value.startswith(PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(PREFIX) :].encode("ascii")).decode("utf-8")
    except InvalidToken:
        return "[Encrypted value unavailable]"
