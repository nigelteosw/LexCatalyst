"""add review_lessons and user_settings

Revision ID: x9a0b1c2d3e4
Revises: w8f9a0b1c2d3
Create Date: 2026-10-01 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "x9a0b1c2d3e4"
down_revision: str | None = "w8f9a0b1c2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "review_lessons",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "handoff_id",
            sa.String(length=36),
            sa.ForeignKey("review_handoffs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source_annotation_ids", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_review_lessons_handoff_id", "review_lessons", ["handoff_id"])

    op.create_table(
        "user_settings",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("openrouter_api_key", sa.Text(), nullable=True),
        sa.Column("openrouter_model", sa.String(length=200), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("user_settings")
    op.drop_index("ix_review_lessons_handoff_id", table_name="review_lessons")
    op.drop_table("review_lessons")
