"""Drop wellbeing survey tables

Revision ID: a7b8c9d0e1f2
Revises: z3e4f5a6b7c8
Create Date: 2026-10-08 00:00:00.000000

The wellbeing questionnaire has been removed. This drops its responses and
questions. Downgrade recreates the empty tables with their last known schema;
the data is not restored.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "z3e4f5a6b7c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("survey_responses")
    op.drop_table("survey_questions")


def downgrade() -> None:
    op.create_table(
        "survey_questions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("category", sa.String(32), nullable=False, index=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("reverse_scored", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "survey_responses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("question_id", sa.String(36), sa.ForeignKey("survey_questions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("score", sa.SmallInteger(), nullable=False),
        sa.Column("week_of", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "question_id", "week_of", name="uq_survey_response_user_question_week"),
    )
