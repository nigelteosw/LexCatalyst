"""Add Knowledge Bank, matters, and audit tables

Revision ID: d7e8f9a0b1c2
Revises: c3d4e5f6a7b8
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_TEAM_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("practice_area", sa.String(length=160), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.add_column("users", sa.Column("default_team_id", sa.String(length=36), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "firm_role",
            sa.String(length=24),
            server_default="associate",
            nullable=False,
        ),
    )
    op.create_foreign_key(
        "fk_users_default_team_id",
        "users",
        "teams",
        ["default_team_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_users_default_team_id"), "users", ["default_team_id"])

    op.create_table(
        "team_members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("team_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "user_id", name="uq_team_members_team_user"),
    )
    op.create_index(op.f("ix_team_members_team_id"), "team_members", ["team_id"])
    op.create_index(op.f("ix_team_members_user_id"), "team_members", ["user_id"])

    op.create_table(
        "matters",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("team_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("case_number", sa.String(length=120), nullable=False),
        sa.Column("client_name", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=24), server_default="active", nullable=False),
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
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_number"),
    )
    op.create_index(op.f("ix_matters_case_number"), "matters", ["case_number"])
    op.create_index(op.f("ix_matters_status"), "matters", ["status"])
    op.create_index(op.f("ix_matters_team_id"), "matters", ["team_id"])

    op.create_table(
        "matter_members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("matter_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("granted_by", sa.String(length=36), nullable=True),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("matter_id", "user_id", name="uq_matter_members_matter_user"),
    )
    op.create_index(op.f("ix_matter_members_granted_by"), "matter_members", ["granted_by"])
    op.create_index(op.f("ix_matter_members_matter_id"), "matter_members", ["matter_id"])
    op.create_index(op.f("ix_matter_members_user_id"), "matter_members", ["user_id"])

    op.add_column("chat_threads", sa.Column("matter_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "fk_chat_threads_matter_id",
        "chat_threads",
        "matters",
        ["matter_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_chat_threads_matter_id"), "chat_threads", ["matter_id"])

    for table_name in ("documents", "memories"):
        op.add_column(table_name, sa.Column("matter_id", sa.String(length=36), nullable=True))
        op.add_column(table_name, sa.Column("team_id", sa.String(length=36), nullable=True))
        op.create_foreign_key(
            f"fk_{table_name}_matter_id",
            table_name,
            "matters",
            ["matter_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            f"fk_{table_name}_team_id",
            table_name,
            "teams",
            ["team_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(op.f(f"ix_{table_name}_matter_id"), table_name, ["matter_id"])
        op.create_index(op.f(f"ix_{table_name}_team_id"), table_name, ["team_id"])

    op.add_column(
        "memories",
        sa.Column(
            "scope",
            sa.String(length=24),
            server_default="personal",
            nullable=False,
        ),
    )
    op.create_index(op.f("ix_memories_scope"), "memories", ["scope"])

    op.create_table(
        "kb_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("team_id", sa.String(length=36), nullable=True),
        sa.Column("matter_id", sa.String(length=36), nullable=True),
        sa.Column("source_entry_id", sa.String(length=36), nullable=True),
        sa.Column("scope", sa.String(length=24), nullable=False),
        sa.Column("entry_type", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("pii_status", sa.String(length=24), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=False),
        sa.Column("created_by_role", sa.String(length=24), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_entry_id"], ["kb_entries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "created_by",
        "entry_type",
        "matter_id",
        "pii_status",
        "scope",
        "source_entry_id",
        "team_id",
    ):
        op.create_index(op.f(f"ix_kb_entries_{column}"), "kb_entries", [column])

    op.create_table(
        "kb_access_log",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kb_entry_id", sa.String(length=36), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("context_matter_id", sa.String(length=36), nullable=True),
        sa.Column("context_thread_id", sa.String(length=36), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["context_matter_id"], ["matters.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["context_thread_id"],
            ["chat_threads.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["kb_entry_id"], ["kb_entries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "action",
        "context_matter_id",
        "context_thread_id",
        "kb_entry_id",
        "user_id",
    ):
        op.create_index(op.f(f"ix_kb_access_log_{column}"), "kb_access_log", [column])

    op.create_table(
        "pii_redactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kb_entry_id", sa.String(length=36), nullable=False),
        sa.Column("source_matter_id", sa.String(length=36), nullable=True),
        sa.Column("target_scope", sa.String(length=24), nullable=False),
        sa.Column("redacted_fields", sa.JSON(), nullable=False),
        sa.Column("approved_by", sa.String(length=36), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("original_content", sa.Text(), nullable=False),
        sa.Column("redacted_content", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["kb_entry_id"], ["kb_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_matter_id"], ["matters.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pii_redactions_approved_by"), "pii_redactions", ["approved_by"])
    op.create_index(op.f("ix_pii_redactions_kb_entry_id"), "pii_redactions", ["kb_entry_id"])
    op.create_index(op.f("ix_pii_redactions_source_matter_id"), "pii_redactions", ["source_matter_id"])

    op.execute(
        sa.text(
            """
            INSERT INTO teams (id, name, practice_area)
            VALUES (:team_id, 'LexCatalyst Legal', 'General practice')
            ON CONFLICT (name) DO NOTHING
            """
        ).bindparams(team_id=DEFAULT_TEAM_ID)
    )
    op.execute(
        sa.text(
            "UPDATE users SET default_team_id = :team_id WHERE default_team_id IS NULL"
        ).bindparams(team_id=DEFAULT_TEAM_ID)
    )
    op.execute(
        sa.text(
            """
            INSERT INTO team_members (id, team_id, user_id, role)
            SELECT
                substr(md5(:team_id || users.id), 1, 8) || '-' ||
                substr(md5(:team_id || users.id), 9, 4) || '-' ||
                substr(md5(:team_id || users.id), 13, 4) || '-' ||
                substr(md5(:team_id || users.id), 17, 4) || '-' ||
                substr(md5(:team_id || users.id), 21, 12),
                :team_id,
                users.id,
                users.firm_role
            FROM users
            ON CONFLICT (team_id, user_id) DO NOTHING
            """
        ).bindparams(team_id=DEFAULT_TEAM_ID)
    )


def downgrade() -> None:
    op.drop_table("pii_redactions")
    op.drop_table("kb_access_log")
    op.drop_table("kb_entries")

    op.drop_index(op.f("ix_memories_scope"), table_name="memories")
    op.drop_column("memories", "scope")
    for table_name in ("memories", "documents"):
        op.drop_index(op.f(f"ix_{table_name}_team_id"), table_name=table_name)
        op.drop_index(op.f(f"ix_{table_name}_matter_id"), table_name=table_name)
        op.drop_constraint(f"fk_{table_name}_team_id", table_name, type_="foreignkey")
        op.drop_constraint(f"fk_{table_name}_matter_id", table_name, type_="foreignkey")
        op.drop_column(table_name, "team_id")
        op.drop_column(table_name, "matter_id")

    op.drop_index(op.f("ix_chat_threads_matter_id"), table_name="chat_threads")
    op.drop_constraint("fk_chat_threads_matter_id", "chat_threads", type_="foreignkey")
    op.drop_column("chat_threads", "matter_id")

    op.drop_table("matter_members")
    op.drop_table("matters")
    op.drop_table("team_members")

    op.drop_index(op.f("ix_users_default_team_id"), table_name="users")
    op.drop_constraint("fk_users_default_team_id", "users", type_="foreignkey")
    op.drop_column("users", "firm_role")
    op.drop_column("users", "default_team_id")
    op.drop_table("teams")
