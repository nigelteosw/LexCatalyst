"""Add review handoffs and findings

Revision ID: q2f3a4b5c6d7
Revises: p1e2f3a4b5c6
Create Date: 2026-06-14

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "q2f3a4b5c6d7"
down_revision: Union[str, None] = "p1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_handoffs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "action_id",
            sa.String(36),
            sa.ForeignKey("action_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "matter_id",
            sa.String(36),
            sa.ForeignKey("matters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "submitted_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="extracting",
        ),
        sa.Column(
            "reviewer_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
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
    op.create_index("ix_review_handoffs_action_id", "review_handoffs", ["action_id"])
    op.create_index("ix_review_handoffs_matter_id", "review_handoffs", ["matter_id"])
    op.create_index("ix_review_handoffs_reviewer_id", "review_handoffs", ["reviewer_id"])
    op.create_index("ix_review_handoffs_status", "review_handoffs", ["status"])

    op.create_table(
        "review_findings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "handoff_id",
            sa.String(36),
            sa.ForeignKey("review_handoffs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("original_clause", sa.Text(), nullable=False),
        sa.Column("proposed_revision", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=False),
        sa.Column("citations", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "status",
            sa.String(24),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("reviewer_edit", sa.Text(), nullable=True),
        sa.Column("reviewer_comment", sa.Text(), nullable=True),
        sa.Column(
            "promoted_kb_entry_id",
            sa.String(36),
            sa.ForeignKey("kb_entries.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "reviewed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
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
        "ix_review_findings_handoff_sequence",
        "review_findings",
        ["handoff_id", "sequence"],
    )
    op.create_index(
        "ix_review_findings_handoff_status",
        "review_findings",
        ["handoff_id", "status"],
    )

    op.add_column(
        "action_items",
        sa.Column(
            "active_handoff_id",
            sa.String(36),
            sa.ForeignKey("review_handoffs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_action_items_active_handoff_id",
        "action_items",
        ["active_handoff_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_action_items_active_handoff_id", table_name="action_items")
    op.drop_column("action_items", "active_handoff_id")
    op.drop_index("ix_review_findings_handoff_status", table_name="review_findings")
    op.drop_index("ix_review_findings_handoff_sequence", table_name="review_findings")
    op.drop_table("review_findings")
    op.drop_index("ix_review_handoffs_status", table_name="review_handoffs")
    op.drop_index("ix_review_handoffs_reviewer_id", table_name="review_handoffs")
    op.drop_index("ix_review_handoffs_matter_id", table_name="review_handoffs")
    op.drop_index("ix_review_handoffs_action_id", table_name="review_handoffs")
    op.drop_table("review_handoffs")
