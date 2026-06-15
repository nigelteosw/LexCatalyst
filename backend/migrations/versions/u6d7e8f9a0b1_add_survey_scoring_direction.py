"""Add explicit survey scoring direction.

Revision ID: u6d7e8f9a0b1
Revises: t5c6d7e8f9a0
"""

from alembic import op
import sqlalchemy as sa


revision = "u6d7e8f9a0b1"
down_revision = "t5c6d7e8f9a0"
branch_labels = None
depends_on = None


POSITIVE_BASELINE_QUESTIONS = (
    "I felt comfortable telling a supervisor or team member when my workload was becoming unmanageable.",
    "I received useful support when I asked for help, clarification, or prioritisation.",
    "Work was allocated in a way that felt fair and transparent.",
    "I could raise concerns, mistakes, or capacity issues without fear that it would affect how I am viewed.",
    "My current workload left enough time for learning, feedback, and reflection.",
    "I received clear guidance or feedback that helped me improve.",
    "I had opportunities to do meaningful work, not just urgent execution.",
    "I can see a sustainable path for my professional growth in this team.",
)


def upgrade() -> None:
    op.add_column(
        "survey_questions",
        sa.Column(
            "reverse_scored",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    survey_questions = sa.table(
        "survey_questions",
        sa.column("text", sa.Text()),
        sa.column("reverse_scored", sa.Boolean()),
    )
    op.get_bind().execute(
        survey_questions.update()
        .where(survey_questions.c.text.in_(POSITIVE_BASELINE_QUESTIONS))
        .values(reverse_scored=True)
    )


def downgrade() -> None:
    op.drop_column("survey_questions", "reverse_scored")
