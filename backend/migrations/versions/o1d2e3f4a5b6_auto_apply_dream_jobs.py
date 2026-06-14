"""Auto-apply durable Dream jobs and store memory justifications

Revision ID: o1d2e3f4a5b6
Revises: n1c2d3e4f5a6
Create Date: 2026-06-14

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "o1d2e3f4a5b6"
down_revision: Union[str, None] = "n1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("memories", sa.Column("justification", sa.Text(), nullable=True))
    op.add_column(
        "dream_jobs",
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "dream_jobs",
        sa.Column(
            "processing_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(
        "ix_dream_jobs_status_processing_started",
        "dream_jobs",
        ["status", "processing_started_at"],
    )
    op.execute(
        sa.text(
            "UPDATE dream_jobs "
            "SET status = 'failed', "
            "error_message = 'This Dream proposal predates automatic apply; run Dream again.' "
            "WHERE status = 'ready'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE dream_jobs "
            "SET status = 'failed', "
            "error_message = 'Automatic Dream results cannot be replayed after downgrade.' "
            "WHERE status = 'completed'"
        )
    )
    op.drop_index("ix_dream_jobs_status_processing_started", table_name="dream_jobs")
    op.drop_column("dream_jobs", "processing_attempts")
    op.drop_column("dream_jobs", "processing_started_at")
    op.drop_column("memories", "justification")
