"""Migrate active Wiki pages into the Knowledge Bank

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO kb_entries (
            id,
            team_id,
            matter_id,
            source_entry_id,
            scope,
            entry_type,
            title,
            body_markdown,
            tags,
            pii_status,
            created_by,
            created_by_role,
            version,
            created_at,
            updated_at
        )
        SELECT
            wiki_pages.id,
            users.default_team_id,
            matters.id,
            NULL,
            CASE
                WHEN wiki_pages.source_document_id IS NOT NULL THEN 'matter'
                ELSE 'private'
            END,
            CASE wiki_pages.page_type
                WHEN 'playbook' THEN 'playbook'
                WHEN 'entity' THEN 'entity'
                WHEN 'clause' THEN 'clause'
                ELSE 'matter_note'
            END,
            wiki_pages.title,
            wiki_pages.body_markdown,
            CAST('[]' AS JSON),
            'flagged',
            wiki_pages.author_user_id,
            users.firm_role,
            wiki_pages.version,
            wiki_pages.created_at,
            wiki_pages.updated_at
        FROM wiki_pages
        JOIN users ON users.id = wiki_pages.author_user_id
        LEFT JOIN matters ON matters.id = wiki_pages.matter_id
        WHERE wiki_pages.status != 'archived'
        ON CONFLICT (id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM kb_entries
        WHERE id IN (SELECT id FROM wiki_pages)
        """
    )
