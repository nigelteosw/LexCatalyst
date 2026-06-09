"""Add embedding column to kb_entries

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

from app.config import get_settings

revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DIMS = get_settings().openai_embedding_dimensions


def upgrade() -> None:
    op.add_column(
        "kb_entries",
        sa.Column("embedding", Vector(DIMS), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kb_entries", "embedding")
