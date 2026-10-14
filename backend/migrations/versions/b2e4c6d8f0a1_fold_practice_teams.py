"""fold practice-group teams into the mentorship class; drop document folders

Revision ID: b2e4c6d8f0a1
Revises: 00a55a720011
Create Date: 2026-10-14 00:00:00.000000

The class is the only grouping. Knowledge Bank scope is remapped before the columns
go, and never widened:

- A class with exactly one practice team whose members equal the class's active members
  keeps its `team` entries, which become `firm_wide` (renamed to `team` below).
- Any other class has its `team` entries made `private`, owned by their creator. Each one
  gets a `kb_scope_narrowed:<entry id>` audit event (subject = creator) so the owner can
  re-share it.

Then `firm_wide` becomes `team`, and the practice-group columns, folders and tables go.
Downgrade restores the shape only; the data is not reconstructed.
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2e4c6d8f0a1"
down_revision: str | None = "00a55a720011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _team_matches_class(bind, class_id: str, team_id: str) -> bool:
    team_users = set(bind.execute(
        sa.text("SELECT user_id FROM team_members WHERE team_id = :team_id"), {"team_id": team_id},
    ).scalars())
    class_users = set(bind.execute(
        sa.text("SELECT user_id FROM class_memberships WHERE class_id = :class_id AND status = 'active'"),
        {"class_id": class_id},
    ).scalars())
    return team_users == class_users


def _remap_team_scope(bind) -> None:
    class_ids = bind.execute(sa.text("SELECT id FROM mentorship_classes")).scalars().all()
    for class_id in class_ids:
        team_ids = bind.execute(
            sa.text("SELECT id FROM teams WHERE class_id = :class_id"), {"class_id": class_id},
        ).scalars().all()
        if len(team_ids) == 1 and _team_matches_class(bind, class_id, team_ids[0]):
            bind.execute(
                sa.text("UPDATE kb_entries SET scope = 'firm_wide' WHERE class_id = :class_id AND scope = 'team'"),
                {"class_id": class_id},
            )
            continue

        narrowed = bind.execute(
            sa.text("SELECT id, created_by FROM kb_entries WHERE class_id = :class_id AND scope = 'team'"),
            {"class_id": class_id},
        ).all()
        if not narrowed:
            continue
        bind.execute(
            sa.text("UPDATE kb_entries SET scope = 'private' WHERE class_id = :class_id AND scope = 'team'"),
            {"class_id": class_id},
        )
        for entry_id, owner_id in narrowed:
            bind.execute(
                sa.text(
                    "INSERT INTO class_audit_events (id, class_id, actor_id, subject_id, action) "
                    "VALUES (:id, :class_id, NULL, :owner_id, :action)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "class_id": class_id,
                    "owner_id": owner_id,
                    "action": f"kb_scope_narrowed:{entry_id}",
                },
            )


def upgrade() -> None:
    bind = op.get_bind()
    op.alter_column("class_audit_events", "action", type_=sa.String(80), existing_type=sa.String(40))
    _remap_team_scope(bind)
    # Metadata mirrors KB entries, so it takes their remapped scope. Other rows never
    # carried a practice-team scope and fall back to private if they somehow did.
    op.execute(
        "UPDATE resource_metadata AS rm SET scope = kb.scope FROM kb_entries AS kb "
        "WHERE rm.resource_type = 'knowledge_bank_entry' AND rm.resource_id = kb.id"
    )
    op.execute("UPDATE resource_metadata SET scope = 'private' WHERE scope = 'team'")
    op.execute("UPDATE kb_entries SET scope = 'team' WHERE scope = 'firm_wide'")
    op.execute("UPDATE resource_metadata SET scope = 'team' WHERE scope = 'firm_wide'")
    # Deferred foreign-key checks from the updates above would block ALTER TABLE in Postgres.
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")

    op.drop_column("kb_entries", "team_id")
    op.drop_column("matters", "team_id")
    op.drop_column("documents", "team_id")
    op.drop_column("documents", "folder_id")
    op.drop_column("resource_metadata", "team_id")
    op.drop_column("memories", "team_id")
    op.drop_column("users", "default_team_id")
    op.drop_table("document_folders")
    op.drop_table("team_members")
    op.drop_table("teams")


def downgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("practice_area", sa.String(160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("class_id", "name", name="uq_teams_class_name"),
    )
    op.create_table(
        "team_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(24), nullable=False, server_default="associate"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "document_folders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("matter_id", sa.String(36), sa.ForeignKey("matters.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column("users", sa.Column("default_team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True))
    op.add_column("memories", sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True))
    op.add_column("resource_metadata", sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True))
    op.add_column("documents", sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True))
    op.add_column("documents", sa.Column("folder_id", sa.String(36), sa.ForeignKey("document_folders.id", ondelete="SET NULL"), nullable=True))
    op.add_column("matters", sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=True))
    op.add_column("kb_entries", sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True))
    op.execute("UPDATE kb_entries SET scope = 'firm_wide' WHERE scope = 'team'")
    op.execute("UPDATE resource_metadata SET scope = 'firm_wide' WHERE scope = 'team'")
