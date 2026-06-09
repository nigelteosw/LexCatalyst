"""Add rolling summary to chat threads

Revision ID: c3d4e5f6a7b8
Revises: 4d2f8b7a0c91
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "4d2f8b7a0c91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chat_threads", sa.Column("summary", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_threads", "summary")
