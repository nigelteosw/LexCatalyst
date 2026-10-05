"""user_settings: High/Mid models and per-feature tiers

Revision ID: y0b1c2d3e4f5
Revises: y0a1b2c3d4e5
Create Date: 2026-10-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "y0b1c2d3e4f5"
down_revision: str | None = "y0a1b2c3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_settings", sa.Column("model_high", sa.String(length=200), nullable=True))
    op.add_column("user_settings", sa.Column("model_mid", sa.String(length=200), nullable=True))
    op.add_column(
        "user_settings",
        sa.Column("feature_tiers", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.execute("UPDATE user_settings SET model_mid = openrouter_model")
    op.drop_column("user_settings", "openrouter_model")


def downgrade() -> None:
    op.add_column(
        "user_settings", sa.Column("openrouter_model", sa.String(length=200), nullable=True)
    )
    op.execute("UPDATE user_settings SET openrouter_model = model_mid")
    op.drop_column("user_settings", "feature_tiers")
    op.drop_column("user_settings", "model_mid")
    op.drop_column("user_settings", "model_high")
