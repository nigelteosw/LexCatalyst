"""Add a fail-closed mentorship class boundary.

Legacy rows are assigned to an archived quarantine class. A reviewed backfill
must move each row into an intended class before workspace traffic resumes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

QUARANTINE_CLASS_ID = "00000000-0000-0000-0000-000000000000"

CONTENT_TABLES = (
    "teams",
    "matters",
    "documents",
    "document_folders",
    "chat_threads",
    "memories",
    "kb_entries",
    "resource_metadata",
    "action_items",
    "review_handoffs",
    "review_lessons",
    "birdie_reviews",
    "dream_jobs",
    "retrieval_audit_events",
)


def upgrade() -> None:
    op.create_table(
        "mentorship_classes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "class_memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("class_id", "user_id", name="uq_class_membership_user"),
    )
    op.create_index("ix_class_memberships_class_id", "class_memberships", ["class_id"])
    op.create_index("ix_class_memberships_user_id", "class_memberships", ["user_id"])
    op.create_index("uq_class_membership_active_user", "class_memberships", ["user_id"], unique=True, postgresql_where=sa.text("status = 'active'"))
    op.create_table(
        "class_invites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
    )
    op.create_index("uq_class_invite_live_class", "class_invites", ["class_id"], unique=True, postgresql_where=sa.text("revoked_at IS NULL"))
    op.create_index("uq_class_invite_live_digest", "class_invites", ["code_digest"], unique=True, postgresql_where=sa.text("revoked_at IS NULL"))
    op.create_table(
        "class_join_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_ip_digest", sa.String(64), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for column in ("user_id", "source_ip_digest", "attempted_at"):
        op.create_index(f"ix_class_join_attempts_{column}", "class_join_attempts", [column])
    op.create_table(
        "class_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("subject_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_class_audit_events_class_id", "class_audit_events", ["class_id"])

    op.execute(sa.text(
        "INSERT INTO mentorship_classes (id, name, status, created_by) "
        "VALUES (:id, 'Legacy data pending review', 'archived', NULL)"
    ).bindparams(id=QUARANTINE_CLASS_ID))
    for table in CONTENT_TABLES:
        op.add_column(table, sa.Column("class_id", sa.String(36), nullable=True))
        op.execute(sa.text(f"UPDATE {table} SET class_id = :class_id").bindparams(class_id=QUARANTINE_CLASS_ID))
        op.alter_column(table, "class_id", nullable=False)
        op.create_foreign_key(f"fk_{table}_class_id", table, "mentorship_classes", ["class_id"], ["id"], ondelete="RESTRICT")
        op.create_index(f"ix_{table}_class_id", table, ["class_id"])

    op.drop_constraint("teams_name_key", "teams", type_="unique")
    op.create_unique_constraint("uq_teams_class_name", "teams", ["class_id", "name"])
    op.drop_constraint("matters_case_number_key", "matters", type_="unique")
    op.create_unique_constraint("uq_matters_class_case_number", "matters", ["class_id", "case_number"])


def downgrade() -> None:
    raise RuntimeError("Class isolation cannot be downgraded safely; restore a reviewed pre-cutover backup")
