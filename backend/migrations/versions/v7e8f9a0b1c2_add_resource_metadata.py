"""add resource metadata

Revision ID: v7e8f9a0b1c2
Revises: u6d7e8f9a0b1
Create Date: 2026-06-16 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "v7e8f9a0b1c2"
down_revision: str | None = "u6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "resource_metadata",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("resource_type", sa.String(length=40), nullable=False),
        sa.Column("resource_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("owner_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("team_id", sa.String(length=36), nullable=True),
        sa.Column("matter_id", sa.String(length=36), nullable=True),
        sa.Column("scope", sa.String(length=24), nullable=True),
        sa.Column("source_document_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=True),
        sa.Column(
            "metadata_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "resource_type",
            "resource_id",
            name="uq_resource_metadata_resource",
        ),
    )
    op.create_index("ix_resource_metadata_created_by", "resource_metadata", ["created_by"])
    op.create_index("ix_resource_metadata_matter_id", "resource_metadata", ["matter_id"])
    op.create_index("ix_resource_metadata_owner_user_id", "resource_metadata", ["owner_user_id"])
    op.create_index("ix_resource_metadata_resource_id", "resource_metadata", ["resource_id"])
    op.create_index("ix_resource_metadata_resource_type", "resource_metadata", ["resource_type"])
    op.create_index("ix_resource_metadata_scope", "resource_metadata", ["scope"])
    op.create_index("ix_resource_metadata_source_document_id", "resource_metadata", ["source_document_id"])
    op.create_index("ix_resource_metadata_status", "resource_metadata", ["status"])
    op.create_index("ix_resource_metadata_team_id", "resource_metadata", ["team_id"])

    op.execute(
        sa.text(
            """
            INSERT INTO resource_metadata (
                id, resource_type, resource_id, title, owner_user_id, created_by,
                team_id, matter_id, scope, source_document_id, status,
                metadata_json, created_at, updated_at
            )
            SELECT
                gen_random_uuid()::text,
                'document',
                id,
                filename,
                user_id,
                user_id,
                team_id,
                matter_id,
                CASE WHEN matter_id IS NULL THEN 'private' ELSE 'matter' END,
                id,
                status,
                '{}'::jsonb,
                created_at,
                updated_at
            FROM documents
            ON CONFLICT (resource_type, resource_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO resource_metadata (
                id, resource_type, resource_id, title, owner_user_id, created_by,
                team_id, matter_id, scope, source_document_id, status,
                metadata_json, created_at, updated_at
            )
            SELECT
                gen_random_uuid()::text,
                'knowledge_bank_entry',
                id,
                title,
                created_by,
                created_by,
                team_id,
                matter_id,
                scope,
                source_document_id,
                status,
                jsonb_build_object(
                    'entry_type', entry_type,
                    'pii_status', pii_status,
                    'source_entry_id', source_entry_id
                ),
                created_at,
                updated_at
            FROM kb_entries
            ON CONFLICT (resource_type, resource_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO resource_metadata (
                id, resource_type, resource_id, title, owner_user_id, created_by,
                team_id, matter_id, scope, source_document_id, status,
                metadata_json, created_at, updated_at
            )
            SELECT
                gen_random_uuid()::text,
                'wiki_page',
                id,
                title,
                owner_user_id,
                author_user_id,
                NULL,
                matter_id,
                CASE WHEN status = 'published' THEN 'firm_wide' ELSE 'private' END,
                source_document_id,
                status,
                jsonb_build_object('page_type', page_type, 'slug', slug),
                created_at,
                updated_at
            FROM wiki_pages
            ON CONFLICT (resource_type, resource_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO resource_metadata (
                id, resource_type, resource_id, title, owner_user_id, created_by,
                team_id, matter_id, scope, source_document_id, status,
                metadata_json, created_at, updated_at
            )
            SELECT
                gen_random_uuid()::text,
                'action_item',
                id,
                title,
                assigner_id,
                assigner_id,
                NULL,
                matter_id,
                CASE WHEN matter_id IS NULL THEN 'firm_wide' ELSE 'matter' END,
                NULL,
                status,
                jsonb_build_object(
                    'assignee_id', assignee_id,
                    'priority', priority,
                    'active_handoff_id', active_handoff_id
                ),
                created_at,
                updated_at
            FROM action_items
            ON CONFLICT (resource_type, resource_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO resource_metadata (
                id, resource_type, resource_id, title, owner_user_id, created_by,
                team_id, matter_id, scope, source_document_id, status,
                metadata_json, created_at, updated_at
            )
            SELECT
                gen_random_uuid()::text,
                'review_handoff',
                id,
                'Review handoff',
                submitted_by,
                submitted_by,
                NULL,
                matter_id,
                CASE WHEN matter_id IS NULL THEN 'private' ELSE 'matter' END,
                document_id,
                status,
                jsonb_build_object(
                    'action_id', action_id,
                    'reviewer_id', reviewer_id,
                    'completed_at', completed_at
                ),
                created_at,
                updated_at
            FROM review_handoffs
            ON CONFLICT (resource_type, resource_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_resource_metadata_team_id", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_status", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_source_document_id", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_scope", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_resource_type", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_resource_id", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_owner_user_id", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_matter_id", table_name="resource_metadata")
    op.drop_index("ix_resource_metadata_created_by", table_name="resource_metadata")
    op.drop_table("resource_metadata")
