"""Catalogue columns for document-backed Knowledge Bank entries

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-08 00:00:00.000000

Each uploaded document gets a Knowledge Bank entry with entry_type "document".
The common fields used for filtering are real columns; the rest of the
extracted fields (parties, key dates, amounts, type-specific extras, and the
locator/quote for each value) are stored in catalogue_fields so new fields do
not need a migration. Existing rows keep NULL in every new column.

Downgrade drops the columns and loses the extracted catalogue data.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("kb_entries", sa.Column("document_type", sa.String(40), nullable=True))
    op.add_column("kb_entries", sa.Column("document_status", sa.String(24), nullable=True))
    op.add_column("kb_entries", sa.Column("execution_date", sa.Date(), nullable=True))
    op.add_column("kb_entries", sa.Column("catalogue_fields", sa.JSON(), nullable=True))
    op.create_index("ix_kb_entries_document_type", "kb_entries", ["document_type"])
    op.create_index("ix_kb_entries_execution_date", "kb_entries", ["execution_date"])


def downgrade() -> None:
    op.drop_index("ix_kb_entries_execution_date", table_name="kb_entries")
    op.drop_index("ix_kb_entries_document_type", table_name="kb_entries")
    op.drop_column("kb_entries", "catalogue_fields")
    op.drop_column("kb_entries", "execution_date")
    op.drop_column("kb_entries", "document_status")
    op.drop_column("kb_entries", "document_type")
