"""Initial schema

Revision ID: f032ee4e39a2
Revises:
Create Date: 2026-05-28 21:51:01.248308

"""
from typing import Sequence, Union


revision: str = "f032ee4e39a2"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Preserved empty initial migration."""
    pass


def downgrade() -> None:
    """Preserved empty initial migration."""
    pass
