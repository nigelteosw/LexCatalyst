"""Add pg_trgm extension and GIN trigram indexes for substring search

Revision ID: l9a0b1c2d3e4
Revises: k8f9a0b1c2d3
Create Date: 2026-06-14

"""

from typing import Union

from alembic import op

revision: str = "l9a0b1c2d3e4"
down_revision: Union[str, None] = "k8f9a0b1c2d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_wiki_pages_title_trgm "
        "ON wiki_pages USING gin (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_wiki_pages_body_trgm "
        "ON wiki_pages USING gin (body_markdown gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kb_entries_title_trgm "
        "ON kb_entries USING gin (title gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kb_entries_body_trgm "
        "ON kb_entries USING gin (body_markdown gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_kb_entries_body_trgm")
    op.execute("DROP INDEX IF EXISTS ix_kb_entries_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_wiki_pages_body_trgm")
    op.execute("DROP INDEX IF EXISTS ix_wiki_pages_title_trgm")
