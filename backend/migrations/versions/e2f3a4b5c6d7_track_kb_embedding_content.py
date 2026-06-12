"""Track the Knowledge Bank content used for embeddings

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-06-11

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "kb_entries",
        sa.Column("embedding_content_hash", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kb_entries", "embedding_content_hash")
