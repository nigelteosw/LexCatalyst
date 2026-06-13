"""Add HNSW vector indexes and composite filter indexes

Revision ID: j7e8f9a0b1c2
Revises: i6d7e8f9a0b1
Create Date: 2026-06-13

"""

from typing import Union

from alembic import op

revision: str = "j7e8f9a0b1c2"
down_revision: Union[str, None] = "i6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # HNSW approximate nearest-neighbour index for document chunk search.
    # Eliminates the full-table cosine scan in rag_service.search_documents.
    op.execute(
        """
        CREATE INDEX ix_document_chunks_embedding_hnsw
        ON document_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )

    # Partial HNSW index for KB entry search.
    # Restricts the index to rows that will actually appear in vector queries
    # (embedding IS NOT NULL is always required by search_kb_for_chat).
    op.execute(
        """
        CREATE INDEX ix_kb_entries_embedding_hnsw
        ON kb_entries
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE embedding IS NOT NULL
        """
    )

    # Composite indexes supporting the document JOIN pre-filter in
    # rag_service.search_documents: WHERE user_id = ? AND status = 'ready'
    # and the optional matter variant.
    op.create_index(
        "ix_documents_user_status",
        "documents",
        ["user_id", "status"],
    )
    op.create_index(
        "ix_documents_user_matter_status",
        "documents",
        ["user_id", "matter_id", "status"],
    )

    # Composite indexes supporting the KB entry pre-filter in
    # knowledge_bank_service.search_kb_for_chat: scope + pii_status ORs
    # are the tightest scalar filters before the vector order-by.
    op.create_index(
        "ix_kb_entries_scope_pii_status",
        "kb_entries",
        ["scope", "pii_status"],
    )
    op.create_index(
        "ix_kb_entries_matter_scope",
        "kb_entries",
        ["matter_id", "scope"],
    )


def downgrade() -> None:
    op.drop_index("ix_kb_entries_matter_scope", table_name="kb_entries")
    op.drop_index("ix_kb_entries_scope_pii_status", table_name="kb_entries")
    op.drop_index("ix_documents_user_matter_status", table_name="documents")
    op.drop_index("ix_documents_user_status", table_name="documents")
    op.execute("DROP INDEX IF EXISTS ix_kb_entries_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw")
