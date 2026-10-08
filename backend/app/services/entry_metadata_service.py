"""Tags and summary for manual Knowledge Bank notes.

Document-backed entries get their metadata from the catalogue pass (see
document_catalogue_service). Manual notes get tags and a summary from their own
text, generated when the note is created or its title or body changes.

Note text is sent to the creator's OpenRouter model, like the other KB formatting
steps. Notes flagged for PII are never sent.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models import KnowledgeBankEntry
from app.services.catalogue_service import extract_entry_metadata
from app.services.llm_service import get_llm

logger = logging.getLogger(__name__)

NOTE_METADATA_TIMEOUT_SECONDS = 60.0
NOTE_METADATA_MAX_CHARS = 30_000
EDITABLE_NOTE_FIELDS = ("tags", "summary")


def entry_summary(entry: KnowledgeBankEntry) -> str | None:
    fields = entry.catalogue_fields if isinstance(entry.catalogue_fields, dict) else {}
    value = fields.get("summary")
    return value if isinstance(value, str) and value else None


def _edited(entry: KnowledgeBankEntry) -> set[str]:
    fields = entry.catalogue_fields if isinstance(entry.catalogue_fields, dict) else {}
    return {name for name in fields.get("edited_fields", []) if name in EDITABLE_NOTE_FIELDS}


def _store(entry: KnowledgeBankEntry, edited: set[str]) -> None:
    fields = dict(entry.catalogue_fields) if isinstance(entry.catalogue_fields, dict) else {}
    fields["edited_fields"] = sorted(edited)
    entry.catalogue_fields = fields


def mark_note_fields_edited(entry: KnowledgeBankEntry, names: set[str]) -> None:
    """Record that a person set these fields, so generation leaves them alone."""
    edited = _edited(entry) | (names & set(EDITABLE_NOTE_FIELDS))
    _store(entry, edited)


def set_note_summary(entry: KnowledgeBankEntry, summary: str | None) -> None:
    fields = dict(entry.catalogue_fields) if isinstance(entry.catalogue_fields, dict) else {}
    fields["summary"] = summary
    entry.catalogue_fields = fields


async def generate_note_metadata(db: Session, entry: KnowledgeBankEntry) -> None:
    """Fill tags and summary for a manual note, keeping any field a person has set.

    Best effort: any failure leaves the note as it was. Caller saves.
    """
    if entry.source_document_id or entry.pii_status == "flagged" or not entry.body_markdown.strip():
        return
    edited = _edited(entry)
    if {"tags", "summary"} <= edited:
        return

    try:
        provider = get_llm(db, entry.created_by, feature="kb_format")
    except Exception as exc:  # noqa: BLE001 - no usable key for the creator
        logger.info("Note metadata skipped for %s: %s", entry.id, exc)
        return

    result = await extract_entry_metadata(
        provider,
        title=entry.title,
        body=entry.body_markdown,
        max_chars=NOTE_METADATA_MAX_CHARS,
        timeout=NOTE_METADATA_TIMEOUT_SECONDS,
    )
    if not result:
        return
    if "tags" not in edited:
        entry.tags = result["tags"]
    if "summary" not in edited:
        set_note_summary(entry, result["summary"])


def note_metadata_dict(entry: KnowledgeBankEntry, matter_title: str | None) -> dict[str, Any]:
    fields = entry.catalogue_fields if isinstance(entry.catalogue_fields, dict) else {}
    return {
        "document_id": None,
        "entry_id": entry.id,
        "filename": entry.title,
        "matter_id": entry.matter_id,
        "matter_name": matter_title,
        "status": entry.status,
        "tags": list(entry.tags or []),
        "summary": entry_summary(entry),
        "document_type": None,
        "document_status": None,
        "execution_date": None,
        "parties": [],
        "key_dates": [],
        "edited_fields": fields.get("edited_fields") or [],
        "updated_at": entry.updated_at,
    }

