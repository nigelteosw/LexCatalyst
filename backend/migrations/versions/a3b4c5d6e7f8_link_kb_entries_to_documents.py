"""Link Knowledge Bank entries to source documents

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kb_entries",
        sa.Column("source_document_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_kb_entries_source_document_id",
        "kb_entries",
        "documents",
        ["source_document_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_kb_entries_source_document_id"),
        "kb_entries",
        ["source_document_id"],
    )
    op.execute(
        """
        UPDATE kb_entries
        SET source_document_id = wiki_pages.source_document_id
        FROM wiki_pages
        WHERE kb_entries.id = wiki_pages.id
          AND wiki_pages.source_document_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_kb_entries_source_document_id"), table_name="kb_entries")
    op.drop_constraint(
        "fk_kb_entries_source_document_id",
        "kb_entries",
        type_="foreignkey",
    )
    op.drop_column("kb_entries", "source_document_id")
