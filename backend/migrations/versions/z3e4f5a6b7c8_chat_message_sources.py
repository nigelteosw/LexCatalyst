"""chat message footnote sources

Revision ID: z3e4f5a6b7c8
Revises: z2d3e4f5a6b7
Create Date: 2026-10-06 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "z3e4f5a6b7c8"
down_revision: str | None = "z2d3e4f5a6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("sources", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "sources")
