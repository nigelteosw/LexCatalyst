"""Seal OpenRouter keys with their own secret; add key status and favourite models

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-08 12:00:00.000000

Existing keys were encrypted with FIELD_ENCRYPTION_KEY, the same secret that protects client
PII. This migration opens each one with that secret and re-seals it under
OPENROUTER_KEY_ENCRYPTION_KEY, storing an HMAC fingerprint and display fields beside it. The old
`openrouter_api_key` column is then dropped. Rows whose key cannot be opened are cleared, and
their owners will be asked to add the key again.

Downgrade re-seals keys back under FIELD_ENCRYPTION_KEY so the old column works again.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.services.field_encryption import decrypt_text, encrypt_text
from app.services.secret_store import decrypt_secret, encrypt_secret, fingerprint

revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_settings", sa.Column("openrouter_key_ciphertext", sa.Text(), nullable=True))
    op.add_column("user_settings", sa.Column("openrouter_key_fingerprint", sa.String(64), nullable=True))
    op.add_column("user_settings", sa.Column("openrouter_key_last4", sa.String(4), nullable=True))
    op.add_column("user_settings", sa.Column("openrouter_key_label", sa.String(120), nullable=True))
    op.add_column("user_settings", sa.Column("openrouter_key_status", sa.String(20), nullable=True))
    op.add_column(
        "user_settings",
        sa.Column("openrouter_key_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_settings",
        sa.Column("favourite_models", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT user_id, openrouter_api_key FROM user_settings WHERE openrouter_api_key IS NOT NULL")
    ).fetchall()
    for user_id, legacy in rows:
        plaintext = decrypt_text(legacy)
        if not plaintext or plaintext.startswith("[Encrypted"):
            continue
        bind.execute(
            sa.text(
                "UPDATE user_settings SET openrouter_key_ciphertext = :ct, "
                "openrouter_key_fingerprint = :fp, openrouter_key_last4 = :last4, "
                "openrouter_key_status = 'unchecked' WHERE user_id = :uid"
            ),
            {
                "ct": encrypt_secret(plaintext, user_id=user_id),
                "fp": fingerprint(plaintext),
                "last4": plaintext[-4:],
                "uid": user_id,
            },
        )

    op.drop_column("user_settings", "openrouter_api_key")


def downgrade() -> None:
    op.add_column("user_settings", sa.Column("openrouter_api_key", sa.Text(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT user_id, openrouter_key_ciphertext FROM user_settings WHERE openrouter_key_ciphertext IS NOT NULL")
    ).fetchall()
    for user_id, ciphertext in rows:
        bind.execute(
            sa.text("UPDATE user_settings SET openrouter_api_key = :legacy WHERE user_id = :uid"),
            {"legacy": encrypt_text(decrypt_secret(ciphertext, user_id=user_id)), "uid": user_id},
        )

    for column in (
        "favourite_models",
        "openrouter_key_verified_at",
        "openrouter_key_status",
        "openrouter_key_label",
        "openrouter_key_last4",
        "openrouter_key_fingerprint",
        "openrouter_key_ciphertext",
    ):
        op.drop_column("user_settings", column)
