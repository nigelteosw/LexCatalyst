"""Keep only Knowledge Bank edit audit events

Revision ID: h5c6d7e8f9a0
Revises: g4b5c6d7e8f9
Create Date: 2026-06-13

"""

from typing import Union

from alembic import op

revision: str = "h5c6d7e8f9a0"
down_revision: Union[str, None] = "g4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE kb_access_log SET action = 'edit' WHERE action = 'write'")
    op.execute("DELETE FROM kb_access_log WHERE action <> 'edit'")
    op.create_check_constraint(
        "ck_kb_access_log_action_edit",
        "kb_access_log",
        "action = 'edit'",
    )


def downgrade() -> None:
    # Deleted read/share/redaction rows cannot be reconstructed.
    op.drop_constraint(
        "ck_kb_access_log_action_edit",
        "kb_access_log",
        type_="check",
    )
    op.execute("UPDATE kb_access_log SET action = 'write' WHERE action = 'edit'")
