"""add retrieval audit events and document execution status

Revision ID: y0a1b2c3d4e5
Revises: x9a0b1c2d3e4
Create Date: 2026-10-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "y0a1b2c3d4e5"
down_revision: str | None = "x9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("execution_status", sa.String(16), nullable=True))
    op.create_table(
        "retrieval_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("returned_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_retrieval_audit_events_user_id", "retrieval_audit_events", ["user_id"])
    op.create_index("ix_retrieval_audit_events_kind", "retrieval_audit_events", ["kind"])


def downgrade() -> None:
    op.drop_index("ix_retrieval_audit_events_kind", table_name="retrieval_audit_events")
    op.drop_index("ix_retrieval_audit_events_user_id", table_name="retrieval_audit_events")
    op.drop_table("retrieval_audit_events")
    op.drop_column("documents", "execution_status")
