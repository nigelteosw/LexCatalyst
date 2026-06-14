"""PDF redlining: drop review_findings, add review_annotations + replies

Hard cutover from the extraction-based handoff flow to visual PDF redlining.
See docs/plans/pdf-redlining-review.md.

DATA LOSS WARNING: review_findings rows are dropped without transformation.
The extraction-based schema is architecturally incompatible with visual PDF
annotations, so no meaningful row-level migration is possible. Any existing
review_findings data is permanently destroyed by this migration.

- Migrates existing extracting/extraction_failed handoffs to ready_for_review
  so they are not permanently stuck (no worker processes those statuses any more).
- Changes the review_handoffs.status server default from 'extracting' to
  'ready_for_review' to match the new direct-to-review creation flow.
- Drops review_findings (extraction-based reviewable units).
- Adds review_annotations: text-anchored highlight/strike/suggestion marks
  attached to a handoff.
- Adds review_annotation_replies: per-annotation reply thread (junior↔reviewer).
- Adds review_handoffs.return_reason for whole-draft reject.

Revision ID: s4b5c6d7e8f9
Revises: r3a4b5c6d7e8
Create Date: 2026-06-15

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "s4b5c6d7e8f9"
down_revision: Union[str, None] = "r3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rescue handoffs stuck in statuses the new flow no longer produces.
    # - extracting / extraction_failed: worker is gone, they would be permanently stuck.
    # - in_review: the old findings-based review_findings rows are about to be dropped;
    #   keeping status=in_review with zero review_annotations would allow immediate
    #   zero-annotation completion and silently discard all prior reviewer work.
    op.execute(
        "UPDATE review_handoffs SET status = 'ready_for_review' "
        "WHERE status IN ('extracting', 'extraction_failed', 'in_review')"
    )

    # Align the DB server default with the ORM default and the new creation flow.
    op.alter_column(
        "review_handoffs",
        "status",
        server_default="ready_for_review",
        existing_type=sa.String(32),
        existing_nullable=False,
    )

    op.drop_index("ix_review_findings_handoff_status", table_name="review_findings")
    op.drop_index("ix_review_findings_handoff_sequence", table_name="review_findings")
    op.drop_table("review_findings")

    op.add_column(
        "review_handoffs",
        sa.Column("return_reason", sa.Text(), nullable=True),
    )

    op.create_table(
        "review_annotations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "handoff_id",
            sa.String(36),
            sa.ForeignKey("review_handoffs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_no", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("anchor_quote", sa.Text(), nullable=False),
        sa.Column("anchor_rects", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("suggested_text", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "author_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "promoted_kb_entry_id",
            sa.String(36),
            sa.ForeignKey("kb_entries.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "previous_annotation_id",
            sa.String(36),
            sa.ForeignKey("review_annotations.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
        "ix_review_annotations_handoff_page_status",
        "review_annotations",
        ["handoff_id", "page_no", "status"],
    )
    op.create_index(
        "ix_review_annotations_document_page",
        "review_annotations",
        ["document_id", "page_no"],
    )
    op.create_index(
        "ix_review_annotations_promoted_kb_entry",
        "review_annotations",
        ["promoted_kb_entry_id"],
    )
    op.create_index(
        "ix_review_annotations_previous",
        "review_annotations",
        ["previous_annotation_id"],
    )

    op.create_table(
        "review_annotation_replies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "annotation_id",
            sa.String(36),
            sa.ForeignKey("review_annotations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body_markdown", sa.Text(), nullable=False),
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
        "ix_review_annotation_replies_thread",
        "review_annotation_replies",
        ["annotation_id", "created_at"],
    )


def downgrade() -> None:
    op.alter_column(
        "review_handoffs",
        "status",
        server_default="extracting",
        existing_type=sa.String(32),
        existing_nullable=False,
    )

    op.drop_index(
        "ix_review_annotation_replies_thread",
        table_name="review_annotation_replies",
    )
    op.drop_table("review_annotation_replies")

    op.drop_index("ix_review_annotations_previous", table_name="review_annotations")
    op.drop_index(
        "ix_review_annotations_promoted_kb_entry",
        table_name="review_annotations",
    )
    op.drop_index(
        "ix_review_annotations_document_page",
        table_name="review_annotations",
    )
    op.drop_index(
        "ix_review_annotations_handoff_page_status",
        table_name="review_annotations",
    )
    op.drop_table("review_annotations")

    op.drop_column("review_handoffs", "return_reason")

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
