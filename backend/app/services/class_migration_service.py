"""Reviewed assignment of quarantined legacy rows to mentorship classes."""

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.class_boundary import CLASS_LINKS

QUARANTINE_CLASS_ID = "00000000-0000-0000-0000-000000000000"

CONTENT_TABLES = (
    "teams", "matters", "documents", "document_folders", "chat_threads",
    "memories", "kb_entries", "resource_metadata", "action_items",
    "review_handoffs", "review_lessons", "birdie_reviews", "dream_jobs",
    "retrieval_audit_events",
)



class ClassBackfillError(ValueError):
    pass


def _available_columns(db: Session) -> dict[str, set[str]]:
    inspector = inspect(db.get_bind())
    present = set(inspector.get_table_names())
    return {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in CONTENT_TABLES if table in present
    }


def build_class_backfill_report(db: Session) -> dict:
    """Count quarantined rows by resource type without returning content."""
    available = _available_columns(db)
    counts = {
        table: db.execute(
            text(f"SELECT count(*) FROM {table} WHERE class_id = :class_id"),
            {"class_id": QUARANTINE_CLASS_ID},
        ).scalar_one()
        for table, columns in available.items() if "class_id" in columns
    }
    return {"quarantined": {table: count for table, count in counts.items() if count}}


def apply_class_backfill(db: Session, *, mapping: dict) -> dict:
    """Apply an explicit table/id/class mapping as one transaction.

    Only quarantined rows may move. All known parent links are checked after
    updates and before commit; a mismatch rolls back the entire mapping.
    """
    available = _available_columns(db)
    moved = 0
    try:
        for table, rows in mapping.items():
            if table not in available or "class_id" not in available[table]:
                raise ClassBackfillError(f"Unknown content table: {table}")
            if not isinstance(rows, dict):
                raise ClassBackfillError(f"Mapping for {table} must be an ID-to-class object")
            for row_id, class_id in rows.items():
                target_status = db.execute(
                    text("SELECT status FROM mentorship_classes WHERE id = :id"),
                    {"id": class_id},
                ).scalar_one_or_none()
                if target_status != "active":
                    raise ClassBackfillError("Target class must exist and be active")
                current_class = db.execute(
                    text(f"SELECT class_id FROM {table} WHERE id = :id"),
                    {"id": row_id},
                ).scalar_one_or_none()
                if current_class is None:
                    raise ClassBackfillError(f"Unknown row in {table}")
                if current_class == class_id:
                    continue  # an identical reviewed mapping may be re-run
                if current_class != QUARANTINE_CLASS_ID:
                    raise ClassBackfillError(f"Row in {table} already belongs to another class")
                db.execute(
                    text(f"UPDATE {table} SET class_id = :class_id WHERE id = :id"),
                    {"id": row_id, "class_id": class_id},
                )
                moved += 1

        for child, ref, parent in CLASS_LINKS:
            if ref not in available.get(child, set()) or parent not in available:
                continue
            conflict = db.execute(text(
                f"SELECT count(*) FROM {child} AS c JOIN {parent} AS p "
                f"ON c.{ref} = p.id WHERE c.class_id <> p.class_id"
            )).scalar_one()
            if conflict:
                raise ClassBackfillError(f"Class mismatch on {child}.{ref}")
        db.commit()
        return {"moved": moved, **build_class_backfill_report(db)}
    except Exception:
        db.rollback()
        raise
