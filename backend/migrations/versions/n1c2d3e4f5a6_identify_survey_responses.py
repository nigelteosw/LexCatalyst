"""Identify survey responses for the user dashboard

Revision ID: n1c2d3e4f5a6
Revises: m0b1c2d3e4f5
Create Date: 2026-06-14

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "n1c2d3e4f5a6"
down_revision: Union[str, None] = "m0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "survey_responses",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_survey_responses_user_id",
        "survey_responses",
        ["user_id"],
    )
    op.create_unique_constraint(
        "uq_survey_response_user_question_week",
        "survey_responses",
        ["user_id", "question_id", "week_of"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_survey_response_user_question_week",
        "survey_responses",
        type_="unique",
    )
    op.drop_index("ix_survey_responses_user_id", table_name="survey_responses")
    op.drop_column("survey_responses", "user_id")
