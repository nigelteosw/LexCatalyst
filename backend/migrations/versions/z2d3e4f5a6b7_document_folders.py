"""document folders

Revision ID: z2d3e4f5a6b7
Revises: z1c2d3e4f5a6
Create Date: 2026-10-06 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "z2d3e4f5a6b7"
down_revision: str | None = "z1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_folders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("matter_id", sa.String(length=36), sa.ForeignKey("matters.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_by", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_document_folders_matter_id", "document_folders", ["matter_id"])
    op.create_index("ix_document_folders_created_by", "document_folders", ["created_by"])
    op.add_column(
        "documents",
        sa.Column("folder_id", sa.String(length=36), sa.ForeignKey("document_folders.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_documents_folder_id", "documents", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_folder_id", table_name="documents")
    op.drop_column("documents", "folder_id")
    op.drop_index("ix_document_folders_created_by", table_name="document_folders")
    op.drop_index("ix_document_folders_matter_id", table_name="document_folders")
    op.drop_table("document_folders")
