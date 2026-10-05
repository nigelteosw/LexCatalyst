"""birdie reviews, suggestions and replies

Revision ID: z1c2d3e4f5a6
Revises: y0b1c2d3e4f5
Create Date: 2026-10-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "z1c2d3e4f5a6"
down_revision: str | None = "y0b1c2d3e4f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "birdie_reviews",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("matter_id", sa.String(length=36), sa.ForeignKey("matters.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_url", sa.String(length=2048), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_birdie_reviews_user_id", "birdie_reviews", ["user_id"])
    op.create_index("ix_birdie_reviews_source_url", "birdie_reviews", ["source_url"])

    op.create_table(
        "birdie_suggestions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("review_id", sa.String(length=36), sa.ForeignKey("birdie_reviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clause_ref", sa.String(length=40), nullable=True),
        sa.Column("anchor_text", sa.Text(), nullable=False),
        sa.Column("anchor_start", sa.Integer(), nullable=False),
        sa.Column("anchor_end", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("suggested_text", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("source", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("decided_by", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_birdie_suggestions_review_id", "birdie_suggestions", ["review_id"])

    op.create_table(
        "birdie_suggestion_replies",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("suggestion_id", sa.String(length=36), sa.ForeignKey("birdie_suggestions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_birdie_suggestion_replies_suggestion_id", "birdie_suggestion_replies", ["suggestion_id"])


def downgrade() -> None:
    op.drop_table("birdie_suggestion_replies")
    op.drop_table("birdie_suggestions")
    op.drop_table("birdie_reviews")
