"""Add status and error_message to kb_entries for async summarization

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-06-12

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kb_entries",
        sa.Column(
            "status",
            sa.String(length=24),
            nullable=False,
            server_default="ready",
            index=True,
        ),
    )
    op.add_column(
        "kb_entries",
        sa.Column("error_message", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kb_entries", "error_message")
    op.drop_column("kb_entries", "status")
