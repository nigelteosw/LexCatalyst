"""drop dream_jobs (Dream memory consolidation removed)

Revision ID: 00a55a720011
Revises: c6d7e8f9a0b1
Create Date: 2026-10-13 00:00:00.000000

Dream job history is discarded. Memories it created or edited stay, along with
their `justification` text. Downgrade recreates an empty table in its last shape.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "00a55a720011"
down_revision: str | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("dream_jobs")


def downgrade() -> None:
    op.create_table(
        "dream_jobs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="processing"),
        sa.Column("proposal_json", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("class_id", sa.String(36), nullable=False),
    )
    op.create_index("ix_dream_jobs_status_processing_started", "dream_jobs", ["status", "processing_started_at"])
    op.create_foreign_key(
        "fk_dream_jobs_class_id", "dream_jobs", "mentorship_classes", ["class_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index("ix_dream_jobs_class_id", "dream_jobs", ["class_id"])
