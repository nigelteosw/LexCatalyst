"""Make cross-class references impossible at the database level.

Each content child points at its parent through (class_id, parent_id), so a row can only
reference a parent in its own class. The existing single-column foreign keys stay, keeping
their ON DELETE behaviour (matter delete sets children's matter_id to NULL).

Runs after the quarantine backfill: every existing row is in the same quarantine class,
so the new constraints hold for legacy data before any reviewed mapping is applied.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b5c6d7e8f9a0"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Parent tables that children reference by id. Each gets a unique (class_id, id) target.
PARENT_TABLES = (
    "teams",
    "matters",
    "documents",
    "document_folders",
    "chat_threads",
    "kb_entries",
    "action_items",
    "review_handoffs",
)

# Child table, reference column, parent table. Kept in step with CLASS_LINKS in
# app/services/class_migration_service.py; the class-link test asserts the match.
CLASS_LINKS = (
    ("matters", "team_id", "teams"),
    ("documents", "matter_id", "matters"),
    ("documents", "team_id", "teams"),
    ("documents", "folder_id", "document_folders"),
    ("document_folders", "matter_id", "matters"),
    ("chat_threads", "matter_id", "matters"),
    ("memories", "source_thread_id", "chat_threads"),
    ("kb_entries", "team_id", "teams"),
    ("kb_entries", "matter_id", "matters"),
    ("kb_entries", "source_entry_id", "kb_entries"),
    ("kb_entries", "source_document_id", "documents"),
    ("resource_metadata", "team_id", "teams"),
    ("resource_metadata", "matter_id", "matters"),
    ("resource_metadata", "source_document_id", "documents"),
    ("action_items", "matter_id", "matters"),
    ("review_handoffs", "action_id", "action_items"),
    ("review_handoffs", "matter_id", "matters"),
    ("review_handoffs", "document_id", "documents"),
    ("review_lessons", "handoff_id", "review_handoffs"),
    ("birdie_reviews", "matter_id", "matters"),
)


def _same_class_fk_name(child: str, ref: str) -> str:
    return f"fk_{child}_{ref}_same_class"


def upgrade() -> None:
    for parent in PARENT_TABLES:
        op.create_unique_constraint(f"uq_{parent}_class_id_id", parent, ["class_id", "id"])
    for child, ref, parent in CLASS_LINKS:
        op.create_foreign_key(
            _same_class_fk_name(child, ref),
            child,
            parent,
            ["class_id", ref],
            ["class_id", "id"],
            # Checked at commit, so a reviewed mapping can move a parent and its children in one
            # transaction; moving only the parent (or only one child) still fails.
            deferrable=True,
            initially="DEFERRED",
        )


def downgrade() -> None:
    # Additive constraints: dropping them restores the previous schema without touching data.
    for child, ref, _parent in reversed(CLASS_LINKS):
        op.drop_constraint(_same_class_fk_name(child, ref), child, type_="foreignkey")
    for parent in reversed(PARENT_TABLES):
        op.drop_constraint(f"uq_{parent}_class_id_id", parent, type_="unique")
