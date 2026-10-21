"""mentorship core: pairings, mentor feedback, lesson mentee and themes

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-10-13 00:00:00.000000

Backfill: feedback from already returned or completed review rounds is copied into
mentor_feedback (source review_round), so existing lessons keep their evidence.
Downgrade drops the new tables and columns; feedback written after the upgrade is lost.
"""

from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "c6d7e8f9a0b1"
down_revision: str | None = "b5c6d7e8f9a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FEEDBACK_STATUSES = ("returned", "completed")


def upgrade() -> None:
    op.create_table(
        "mentor_pairings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mentor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mentee_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("mentor_user_id <> mentee_user_id", name="ck_mentor_pairings_distinct"),
    )
    op.create_index("ix_mentor_pairings_class_id", "mentor_pairings", ["class_id"])
    op.create_index("ix_mentor_pairings_mentor_user_id", "mentor_pairings", ["mentor_user_id"])
    op.create_index("ix_mentor_pairings_mentee_user_id", "mentor_pairings", ["mentee_user_id"])
    op.create_index(
        "uq_mentor_pairings_active",
        "mentor_pairings",
        ["class_id", "mentor_user_id", "mentee_user_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
        sqlite_where=sa.text("ended_at IS NULL"),
    )

    op.create_table(
        "mentor_feedback",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("class_id", sa.String(36), sa.ForeignKey("mentorship_classes.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("audience", sa.String(20), nullable=False),
        sa.Column("mentee_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("author_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("author_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("handoff_id", sa.String(36), sa.ForeignKey("review_handoffs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("annotation_id", sa.String(36), sa.ForeignKey("review_annotations.id", ondelete="SET NULL"), nullable=True, unique=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("source_title", sa.String(300), nullable=True),
        sa.Column("anchor_quote", sa.Text(), nullable=True),
        sa.Column("suggested_text", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("audience IN ('mentee', 'team')", name="ck_mentor_feedback_audience"),
        sa.CheckConstraint(
            "source IN ('review_round', 'captured_comment', 'guidance')",
            name="ck_mentor_feedback_source",
        ),
    )
    op.create_index("ix_mentor_feedback_class_id", "mentor_feedback", ["class_id"])
    op.create_index("ix_mentor_feedback_mentee_user_id", "mentor_feedback", ["mentee_user_id"])
    op.create_index("ix_mentor_feedback_author_user_id", "mentor_feedback", ["author_user_id"])
    op.create_index("ix_mentor_feedback_source", "mentor_feedback", ["source"])
    op.create_index("ix_mentor_feedback_handoff_id", "mentor_feedback", ["handoff_id"])

    op.add_column("review_lessons", sa.Column("mentee_user_id", sa.String(36), nullable=True))
    op.add_column("review_lessons", sa.Column("theme", sa.String(40), nullable=False, server_default="General"))
    op.add_column("review_lessons", sa.Column("source_feedback_ids", sa.JSON(), nullable=False, server_default="[]"))
    op.alter_column("review_lessons", "handoff_id", existing_type=sa.String(36), nullable=True)
    op.create_index("ix_review_lessons_mentee_user_id", "review_lessons", ["mentee_user_id"])

    _backfill()

    op.alter_column("review_lessons", "mentee_user_id", existing_type=sa.String(36), nullable=False)


def _backfill() -> None:
    bind = op.get_bind()
    annotations = sa.table(
        "review_annotations",
        sa.column("id"), sa.column("handoff_id"), sa.column("author_user_id"),
        sa.column("note"), sa.column("suggested_text"), sa.column("previous_annotation_id"),
        sa.column("anchor_quote"),
    )
    handoffs = sa.table(
        "review_handoffs",
        sa.column("id"), sa.column("class_id"), sa.column("submitted_by"), sa.column("status"),
    )
    users = sa.table("users", sa.column("id"), sa.column("full_name"), sa.column("email"))
    feedback = sa.table(
        "mentor_feedback",
        sa.column("id"), sa.column("class_id"), sa.column("audience"), sa.column("mentee_user_id"),
        sa.column("author_user_id"), sa.column("author_name"), sa.column("source"),
        sa.column("handoff_id"), sa.column("annotation_id"), sa.column("anchor_quote"),
        sa.column("suggested_text"), sa.column("note"), sa.column("created_by"),
    )
    lessons = sa.table(
        "review_lessons",
        sa.column("id"), sa.column("handoff_id"), sa.column("mentee_user_id"),
        sa.column("source_annotation_ids", sa.JSON), sa.column("source_feedback_ids", sa.JSON),
    )

    rows = bind.execute(
        sa.select(
            annotations.c.id, annotations.c.handoff_id, annotations.c.author_user_id,
            annotations.c.note, annotations.c.suggested_text, annotations.c.previous_annotation_id,
            annotations.c.anchor_quote,
            handoffs.c.class_id, handoffs.c.submitted_by,
        )
        .select_from(annotations.join(handoffs, handoffs.c.id == annotations.c.handoff_id))
        .where(handoffs.c.status.in_(FEEDBACK_STATUSES))
    ).mappings().all()

    author_names: dict[str, str] = {}
    feedback_by_annotation: dict[str, str] = {}
    for row in rows:
        if row["author_user_id"] == row["submitted_by"] or row["previous_annotation_id"]:
            continue
        if not ((row["note"] or "").strip() or (row["suggested_text"] or "").strip()):
            continue
        author_id = row["author_user_id"]
        if author_id and author_id not in author_names:
            user = bind.execute(sa.select(users.c.full_name, users.c.email).where(users.c.id == author_id)).first()
            author_names[author_id] = (user.full_name or user.email) if user else "a reviewer"
        feedback_id = str(uuid4())
        feedback_by_annotation[row["id"]] = feedback_id
        bind.execute(feedback.insert().values(
            id=feedback_id,
            class_id=row["class_id"],
            audience="mentee",
            mentee_user_id=row["submitted_by"],
            author_user_id=author_id,
            author_name=author_names.get(author_id, "a reviewer") if author_id else "a reviewer",
            source="review_round",
            handoff_id=row["handoff_id"],
            annotation_id=row["id"],
            anchor_quote=row["anchor_quote"],
            suggested_text=row["suggested_text"],
            note=row["note"] or "",
            created_by=author_id or row["submitted_by"],
        ))

    lesson_rows = bind.execute(
        sa.select(lessons.c.id, lessons.c.handoff_id, lessons.c.source_annotation_ids, handoffs.c.submitted_by)
        .select_from(lessons.join(handoffs, handoffs.c.id == lessons.c.handoff_id))
    ).mappings().all()
    for lesson in lesson_rows:
        source_ids = [
            feedback_by_annotation[a] for a in (lesson["source_annotation_ids"] or []) if a in feedback_by_annotation
        ]
        bind.execute(
            lessons.update()
            .where(lessons.c.id == lesson["id"])
            .values(mentee_user_id=lesson["submitted_by"], source_feedback_ids=source_ids)
        )


def downgrade() -> None:
    op.drop_index("ix_review_lessons_mentee_user_id", table_name="review_lessons")
    op.alter_column("review_lessons", "handoff_id", existing_type=sa.String(36), nullable=False)
    op.drop_column("review_lessons", "source_feedback_ids")
    op.drop_column("review_lessons", "theme")
    op.drop_column("review_lessons", "mentee_user_id")
    op.drop_table("mentor_feedback")
    op.drop_table("mentor_pairings")
