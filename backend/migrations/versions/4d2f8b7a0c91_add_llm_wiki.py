"""Add LLM wiki tables

Revision ID: 4d2f8b7a0c91
Revises: 9ad7d2c4a6b1
Create Date: 2026-06-02 00:00:00.000000

"""
from typing import Sequence, Union

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op


revision: str = "4d2f8b7a0c91"
down_revision: Union[str, None] = "9ad7d2c4a6b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Defensive: ensure tables from 9ad7d2c4a6b1 (document ingestion) exist before
    # creating wiki tables that FK-reference them. This handles deployments where
    # that revision was recorded in alembic_version without the DDL actually running
    # (e.g. after a database reset that preserves the version table).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "documents" not in existing:
        op.create_table(
            "documents",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=120), nullable=False),
            sa.Column("storage_key", sa.String(length=1024), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_documents_status"), "documents", ["status"])
        op.create_index(op.f("ix_documents_user_id"), "documents", ["user_id"])

    if "document_chunks" not in existing:
        op.create_table(
            "document_chunks",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("document_id", sa.String(length=36), nullable=False),
            sa.Column("chunk_index", sa.Integer(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("embedding", pgvector.sqlalchemy.Vector(dim=1536), nullable=False),
            sa.Column("page_number", sa.Integer(), nullable=True),
            sa.Column("citation_label", sa.String(length=512), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_document_chunks_document_id"),
            "document_chunks",
            ["document_id"],
        )

    op.create_table(
        "wiki_pages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("author_user_id", sa.String(length=36), nullable=False),
        sa.Column("latest_editor_user_id", sa.String(length=36), nullable=True),
        sa.Column("workspace_id", sa.String(length=36), nullable=True),
        sa.Column("matter_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=240), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=True),
        sa.Column("page_type", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_by", sa.String(length=24), nullable=False),
        sa.Column("source_document_id", sa.String(length=36), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["latest_editor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_wiki_pages_author_user_id"), "wiki_pages", ["author_user_id"])
    op.create_index(op.f("ix_wiki_pages_latest_editor_user_id"), "wiki_pages", ["latest_editor_user_id"])
    op.create_index(op.f("ix_wiki_pages_matter_id"), "wiki_pages", ["matter_id"])
    op.create_index(op.f("ix_wiki_pages_owner_user_id"), "wiki_pages", ["owner_user_id"])
    op.create_index(op.f("ix_wiki_pages_page_type"), "wiki_pages", ["page_type"])
    op.create_index(op.f("ix_wiki_pages_slug"), "wiki_pages", ["slug"])
    op.create_index(op.f("ix_wiki_pages_source_document_id"), "wiki_pages", ["source_document_id"])
    op.create_index(op.f("ix_wiki_pages_status"), "wiki_pages", ["status"])
    op.create_index(op.f("ix_wiki_pages_workspace_id"), "wiki_pages", ["workspace_id"])

    op.create_table(
        "wiki_page_revisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("page_id", sa.String(length=36), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column("edited_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("edit_source", sa.String(length=40), nullable=False),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["edited_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["page_id"], ["wiki_pages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_wiki_page_revisions_edited_by_user_id"),
        "wiki_page_revisions",
        ["edited_by_user_id"],
    )
    op.create_index(op.f("ix_wiki_page_revisions_page_id"), "wiki_page_revisions", ["page_id"])

    op.create_table(
        "wiki_page_sources",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("page_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=True),
        sa.Column("chunk_id", sa.String(length=36), nullable=True),
        sa.Column("memory_id", sa.String(length=36), nullable=True),
        sa.Column("chat_message_id", sa.String(length=36), nullable=True),
        sa.Column("citation_label", sa.String(length=512), nullable=False),
        sa.Column("relevance_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["chat_message_id"], ["chat_messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["chunk_id"], ["document_chunks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["page_id"], ["wiki_pages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_wiki_page_sources_chat_message_id"), "wiki_page_sources", ["chat_message_id"])
    op.create_index(op.f("ix_wiki_page_sources_chunk_id"), "wiki_page_sources", ["chunk_id"])
    op.create_index(op.f("ix_wiki_page_sources_document_id"), "wiki_page_sources", ["document_id"])
    op.create_index(op.f("ix_wiki_page_sources_memory_id"), "wiki_page_sources", ["memory_id"])
    op.create_index(op.f("ix_wiki_page_sources_page_id"), "wiki_page_sources", ["page_id"])

    op.create_table(
        "wiki_links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_page_id", sa.String(length=36), nullable=False),
        sa.Column("target_page_id", sa.String(length=36), nullable=True),
        sa.Column("link_text", sa.String(length=255), nullable=False),
        sa.Column("link_type", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["source_page_id"], ["wiki_pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_page_id"], ["wiki_pages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_wiki_links_source_page_id"), "wiki_links", ["source_page_id"])
    op.create_index(op.f("ix_wiki_links_target_page_id"), "wiki_links", ["target_page_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_wiki_links_target_page_id"), table_name="wiki_links")
    op.drop_index(op.f("ix_wiki_links_source_page_id"), table_name="wiki_links")
    op.drop_table("wiki_links")

    op.drop_index(op.f("ix_wiki_page_sources_page_id"), table_name="wiki_page_sources")
    op.drop_index(op.f("ix_wiki_page_sources_memory_id"), table_name="wiki_page_sources")
    op.drop_index(op.f("ix_wiki_page_sources_document_id"), table_name="wiki_page_sources")
    op.drop_index(op.f("ix_wiki_page_sources_chunk_id"), table_name="wiki_page_sources")
    op.drop_index(op.f("ix_wiki_page_sources_chat_message_id"), table_name="wiki_page_sources")
    op.drop_table("wiki_page_sources")

    op.drop_index(op.f("ix_wiki_page_revisions_page_id"), table_name="wiki_page_revisions")
    op.drop_index(op.f("ix_wiki_page_revisions_edited_by_user_id"), table_name="wiki_page_revisions")
    op.drop_table("wiki_page_revisions")

    op.drop_index(op.f("ix_wiki_pages_workspace_id"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_status"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_source_document_id"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_slug"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_page_type"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_owner_user_id"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_matter_id"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_latest_editor_user_id"), table_name="wiki_pages")
    op.drop_index(op.f("ix_wiki_pages_author_user_id"), table_name="wiki_pages")
    op.drop_table("wiki_pages")
