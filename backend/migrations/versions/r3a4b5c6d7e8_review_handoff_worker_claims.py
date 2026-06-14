"""Add processing_started_at and processing_attempts to review_handoffs

Aligns the handoff worker with the document/KB queue pattern so the
slot can apply a stale-before guard and cap retries instead of busy-
looping on rows whose source document isn't ready yet.

Revision ID: r3a4b5c6d7e8
Revises: q2f3a4b5c6d7
Create Date: 2026-06-14

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "r3a4b5c6d7e8"
down_revision: Union[str, None] = "q2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_handoffs",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "review_handoffs",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("review_handoffs", "processing_attempts")
    op.drop_column("review_handoffs", "processing_started_at")
