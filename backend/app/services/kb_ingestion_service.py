"""Async ingestion of uploaded documents into the Knowledge Bank.

Flow:
  1. `create_pending_kb_entry` runs synchronously in the request handler.
     It creates a `kb_entries` row with `status="processing"`, an empty
     body, and no embedding, then returns it immediately.
  2. The dedicated KB worker claims processing rows from Postgres and calls
     `process_kb_summary`. It opens its own DB session, summarises a bounded
     sample of the document using DeepSeek Pro,
     writes the summary into the entry body, computes the embedding, and
     flips the status to `"ready"`. On failure it records `"failed"`.

The KB entry's `source_document_id` lets the agent later call
`read_document` to pull the full extracted text when the summary is
insufficient.
"""

import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, defer

from app.database import SessionLocal
from app.models import Document, DocumentChunk, KnowledgeBankEntry, User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider
from app.providers.embedding_provider import EmbeddingError, embed_texts
from app.services.knowledge_bank_service import (
    _entry_embedding_hash,
    _entry_embedding_text,
    log_kb_access,
)

# Keep the request near 15k input tokens. This is materially faster than
# filling the model context and still samples the entire document.
SUMMARY_MODEL = "deepseek-v4-pro"
MAX_INGEST_CHUNKS = 32
MAX_CHUNK_CHARS = 1800
MAX_ERROR_LENGTH = 1000
STALE_CLAIM_AFTER = timedelta(minutes=30)


class KbIngestionError(RuntimeError):
    pass


# --- Sync: create the placeholder entry ----------------------------------


def create_pending_kb_entry(
    db: Session,
    *,
    user: User,
    document: Document,
) -> KnowledgeBankEntry:
    """Create the placeholder KB entry and return it.

    Idempotent: if an entry already exists for this user + document and is
    not in a failed state, return that entry. A failed entry is reset to
    `processing` so the user can retry.
    """
    existing = db.scalar(
        select(KnowledgeBankEntry)
        .options(defer(KnowledgeBankEntry.embedding))
        .where(
            KnowledgeBankEntry.source_document_id == document.id,
            KnowledgeBankEntry.created_by == user.id,
        )
    )
    if existing and existing.status != "failed":
        return existing
    if existing and existing.status == "failed":
        existing.status = "processing"
        existing.error_message = None
        existing.body_markdown = ""
        existing.embedding = None
        existing.embedding_content_hash = None
        existing.processing_started_at = None
        db.commit()
        db.refresh(existing)
        return existing

    scope = "matter" if document.matter_id else "private"
    entry = KnowledgeBankEntry(
        team_id=document.team_id or user.default_team_id,
        matter_id=document.matter_id,
        source_document_id=document.id,
        scope=scope,
        entry_type="knowledge_bank",
        title=f"{document.filename} — Summary",
        body_markdown="",
        tags=["from document"],
        pii_status="clean",
        status="processing",
        created_by=user.id,
        created_by_role=user.firm_role,
    )
    db.add(entry)
    db.flush()
    log_kb_access(
        db,
        user_id=user.id,
        entry_id=entry.id,
        matter_id=entry.matter_id,
        commit=False,
    )
    db.commit()
    db.refresh(entry)
    return entry


# --- Durable worker claiming ---------------------------------------------


def claim_pending_kb_entry(db: Session) -> str | None:
    """Atomically claim one pending entry, including stale jobs after restarts."""
    stale_before = datetime.now(UTC) - STALE_CLAIM_AFTER
    entry_id = db.scalar(
        select(KnowledgeBankEntry.id)
        .where(
            KnowledgeBankEntry.status == "processing",
            or_(
                KnowledgeBankEntry.processing_started_at.is_(None),
                KnowledgeBankEntry.processing_started_at < stale_before,
            ),
        )
        .order_by(KnowledgeBankEntry.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if not entry_id:
        return None
    db.execute(
        update(KnowledgeBankEntry)
        .where(KnowledgeBankEntry.id == entry_id)
        .values(
            processing_started_at=datetime.now(UTC),
            processing_attempts=KnowledgeBankEntry.processing_attempts + 1,
        )
    )
    db.commit()
    return entry_id


# --- Async: summarise + embed in the worker ------------------------------


async def process_kb_summary(entry_id: str) -> None:
    """Background task: summarise the document and finalise the KB entry."""
    db = SessionLocal()
    entry: KnowledgeBankEntry | None = None
    try:
        entry = db.get(KnowledgeBankEntry, entry_id)
        if not entry:
            return
        if entry.status != "processing":
            return
        if not entry.source_document_id:
            _mark_failed(db, entry, "Entry has no source document.")
            return

        document = db.get(Document, entry.source_document_id)
        if not document:
            _mark_failed(db, entry, "Source document not found.")
            return
        if document.status != "ready":
            _mark_failed(db, entry, "Source document is not ready yet.")
            return

        chunk_rows = list(
            db.execute(
                select(
                    DocumentChunk.chunk_index,
                    DocumentChunk.citation_label,
                    DocumentChunk.text,
                )
                .where(DocumentChunk.document_id == document.id)
                .order_by(DocumentChunk.chunk_index)
            ).mappings()
        )
        if not chunk_rows:
            _mark_failed(db, entry, "Document has no extracted text.")
            return
        chunks = _sample_chunks(chunk_rows, MAX_INGEST_CHUNKS)

        provider = DeepSeekProvider()
        try:
            content, _ = await provider.chat(
                _build_prompt(document=document, chunks=chunks),
                model=SUMMARY_MODEL,
            )
        except DeepSeekError as exc:
            _mark_failed(db, entry, f"Summary generation failed: {exc}")
            return

        try:
            parsed = _parse_summary(content)
        except KbIngestionError as exc:
            _mark_failed(db, entry, str(exc))
            return

        entry.title = parsed["title"] or entry.title
        entry.body_markdown = parsed["body_markdown"]

        try:
            entry.embedding = (
                await embed_texts([_entry_embedding_text(entry)])
            )[0]
            entry.embedding_content_hash = _entry_embedding_hash(entry)
        except EmbeddingError as exc:
            _mark_failed(db, entry, f"Embedding failed: {exc}")
            return

        entry.status = "ready"
        entry.error_message = None
        entry.processing_started_at = None
        entry.version += 1
        db.commit()
    except Exception as exc:  # noqa: BLE001 — last-resort safety net
        if entry is not None:
            try:
                _mark_failed(db, entry, f"Unexpected error: {exc}")
            except Exception:  # noqa: BLE001
                db.rollback()
        else:
            db.rollback()
    finally:
        db.close()


def _mark_failed(db: Session, entry: KnowledgeBankEntry, message: str) -> None:
    entry.status = "failed"
    entry.error_message = message[:MAX_ERROR_LENGTH]
    entry.processing_started_at = None
    db.commit()


# --- Prompt building -----------------------------------------------------


_SYSTEM_PROMPT = """\
You are a Knowledge Bank editor at a law firm. You convert document extracts \
into tight, scannable KB entries that a lawyer can read in under 60 seconds.

Style rules:
- Direct, professional prose. No academic hedging or filler.
- Cite sources inline as [p.X] using the page number from the chunk label. \
  If no page is available, omit the citation rather than showing an ID.
- Never output a "Source Notes" section or footnotes listing chunk IDs.
- 350–600 words total in body_markdown.
- Use ## section headings and short bullet points (- item).
- Do not repeat the document filename in every sentence.\
"""

_USER_PROMPT = """\
Create one KB entry from the document chunks below.

Return ONLY valid JSON — no markdown fences, no commentary outside the JSON:
{{
  "title": "Concise descriptive title (max 80 chars)",
  "body_markdown": "..."
}}

body_markdown must contain these sections in this order (omit any section \
that has no real content):

## What This Is
One short paragraph: document type, subject matter, parties or context, and \
its purpose.

## Key Points
4–8 bullets. Each bullet is one concrete takeaway a lawyer would act on or \
remember. Cite inline as [p.X] at the end of the bullet when the claim comes \
from a specific page.

## Risk Flags
2–4 bullets on caveats, limitations, open issues, ambiguities, or things \
requiring caution. Omit entirely if there are none.

## How to Use
1–3 bullets on how this document would be applied in practice — drafting, \
negotiation, due diligence, advisory work, etc.

Document filename: {filename}

Chunks ({chunk_count} of document):
{chunks}\
"""


def _build_prompt(
    *,
    document: Document,
    chunks: list[Mapping[str, Any]],
) -> list[dict[str, str]]:
    chunk_blocks = [
        f"[{chunk['citation_label']}]\n{chunk['text'][:MAX_CHUNK_CHARS]}"
        for chunk in chunks
    ]
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _USER_PROMPT.format(
                filename=document.filename,
                chunk_count=len(chunks),
                chunks="\n\n---\n\n".join(chunk_blocks),
            ),
        },
    ]


def _sample_chunks(
    chunks: list[Mapping[str, Any]],
    limit: int,
) -> list[Mapping[str, Any]]:
    if len(chunks) <= limit:
        return chunks
    indexes = {
        round(position * (len(chunks) - 1) / (limit - 1))
        for position in range(limit)
    }
    return [chunks[index] for index in sorted(indexes)]


def _parse_summary(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:].strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[3:].strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()

    # Some models leak a leading sentence before the JSON. Try to recover
    # by locating the first {.
    if not cleaned.startswith("{"):
        first = cleaned.find("{")
        if first >= 0:
            cleaned = cleaned[first:]

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise KbIngestionError(f"Summary was not valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise KbIngestionError("Summary JSON was not an object.")

    body = data.get("body_markdown")
    if not isinstance(body, str) or not body.strip():
        raise KbIngestionError("Summary body_markdown was empty.")

    title = data.get("title")
    if not isinstance(title, str):
        title = ""

    return {
        "title": _clean_title(title),
        "body_markdown": body.strip(),
    }


def _clean_title(value: str) -> str:
    """Collapse whitespace and trim. Preserves nothing fancy — titles are plain text."""
    return re.sub(r"\s+", " ", value).strip() if value else ""
