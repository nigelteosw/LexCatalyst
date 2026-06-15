"""kb_entries.source_document_id: SET NULL → CASCADE

When a source document is deleted, its linked KB entry should also be deleted.
Previously the FK was SET NULL, which left orphaned KB entries with no way to
regenerate them. With CASCADE, deleting a document removes the KB entry too.
The entry can be recreated at any time from the Documents page.

Revision ID: t5c6d7e8f9a0
Revises: s4b5c6d7e8f9
Create Date: 2026-06-15
"""

import sqlalchemy as sa
from alembic import op

revision = "t5c6d7e8f9a0"
down_revision = "s4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("kb_entries") as batch_op:
        batch_op.drop_constraint(
            "fk_kb_entries_source_document_id",
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            "fk_kb_entries_source_document_id",
            "documents",
            ["source_document_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("kb_entries") as batch_op:
        batch_op.drop_constraint(
            "fk_kb_entries_source_document_id",
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            "fk_kb_entries_source_document_id",
            "documents",
            ["source_document_id"],
            ["id"],
            ondelete="SET NULL",
        )
