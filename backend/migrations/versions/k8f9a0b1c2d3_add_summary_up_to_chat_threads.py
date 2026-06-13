"""Add summary_up_to to chat_threads for incremental summarization

Revision ID: k8f9a0b1c2d3
Revises: j7e8f9a0b1c2
Create Date: 2026-06-14

"""

from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "k8f9a0b1c2d3"
down_revision: Union[str, None] = "j7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_threads",
        sa.Column("summary_up_to", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_threads", "summary_up_to")
