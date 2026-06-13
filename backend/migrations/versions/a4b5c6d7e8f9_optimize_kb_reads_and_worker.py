"""Optimize Knowledge Bank reads and worker claiming

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-06-13

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4b5c6d7e8f9"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kb_entries",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "kb_entries",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(
        "ix_kb_entries_updated_at",
        "kb_entries",
        ["updated_at"],
    )
    op.create_index(
        "ix_kb_entries_status_processing_started",
        "kb_entries",
        ["status", "processing_started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_kb_entries_status_processing_started", table_name="kb_entries")
    op.drop_index("ix_kb_entries_updated_at", table_name="kb_entries")
    op.drop_column("kb_entries", "processing_attempts")
    op.drop_column("kb_entries", "processing_started_at")
