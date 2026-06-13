"""Add dream_jobs table for durable async job tracking

Revision ID: m0b1c2d3e4f5
Revises: l9a0b1c2d3e4
Create Date: 2026-06-14

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "m0b1c2d3e4f5"
down_revision: Union[str, None] = "l9a0b1c2d3e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dream_jobs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("status", sa.String(24), nullable=False, server_default="processing"),
        sa.Column("proposal_json", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("dream_jobs")
