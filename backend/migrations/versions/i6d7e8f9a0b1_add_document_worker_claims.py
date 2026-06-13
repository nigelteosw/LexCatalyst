"""Add durable document worker claim fields

Revision ID: i6d7e8f9a0b1
Revises: h5c6d7e8f9a0
Create Date: 2026-06-13

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "i6d7e8f9a0b1"
down_revision: Union[str, None] = "h5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(
        "ix_documents_status_processing_started",
        "documents",
        ["status", "processing_started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_documents_status_processing_started", table_name="documents")
    op.drop_column("documents", "processing_attempts")
    op.drop_column("documents", "processing_started_at")
