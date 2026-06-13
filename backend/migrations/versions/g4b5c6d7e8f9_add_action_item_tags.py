"""Add tags column to action_items so tickets can be tagged like KB entries.

Revision ID: g4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-06-13

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "g4b5c6d7e8f9"
down_revision: Union[str, None] = "a4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "action_items",
        sa.Column(
            "tags",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("action_items", "tags")
