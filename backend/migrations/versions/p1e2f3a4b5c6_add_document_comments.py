"""Add document comments

Revision ID: p1e2f3a4b5c6
Revises: o1d2e3f4a5b6
Create Date: 2026-06-14

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "p1e2f3a4b5c6"
down_revision: Union[str, None] = "o1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_document_comments_document_id",
        "document_comments",
        ["document_id"],
    )
    op.create_index(
        "ix_document_comments_user_id",
        "document_comments",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_comments_user_id", table_name="document_comments")
    op.drop_index("ix_document_comments_document_id", table_name="document_comments")
    op.drop_table("document_comments")
