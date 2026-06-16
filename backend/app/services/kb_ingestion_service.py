"""Async ingestion of uploaded documents into the Knowledge Bank.

Flow:
  1. `create_pending_kb_entry` runs synchronously in the request handler.
     It creates a `kb_entries` row with `status="processing"`, an empty
     body, and no embedding, then returns it immediately.
  2. The embedded combined worker claims processing rows from Postgres and calls
     `process_kb_summary`. It opens its own DB session, concatenates all
     document chunk text and sends it to DeepSeek Flash for light formatting
     (clean up OCR artefacts, repeated headers/footers — no summarising),
     writes the result into the entry body, computes the embedding, and
     flips the status to `"ready"`. On failure it records `"failed"`.
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session, defer

from app.database import SessionLocal
from app.models import Document, DocumentChunk, KnowledgeBankEntry, User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider
from app.providers.embedding_provider import EmbeddingError, embed_texts
from app.services.knowledge_bank_service import (
    build_entry_embedding_hash,
    build_entry_embedding_text,
    log_kb_access,
)
from app.services.resource_metadata_service import sync_kb_metadata, sync_metadata_safe
from app.worker_types import WorkerClaim

FORMAT_MODEL = "deepseek-v4-flash"
# Cap raw text sent to the formatter — fits comfortably in Flash's context.
MAX_INGEST_CHARS = 150_000
FORMAT_TIMEOUT_SECONDS = 120.0
MAX_ERROR_LENGTH = 1000
STALE_CLAIM_AFTER = timedelta(minutes=30)
MAX_PROCESSING_ATTEMPTS = 3


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
        existing.processing_attempts = 0
        existing.matter_id = document.matter_id
        existing.team_id = document.team_id
        existing.scope = "matter" if document.matter_id else "private"
        db.commit()
        db.refresh(existing)
        sync_metadata_safe(db, sync_kb_metadata, existing)
        return existing

    entry = KnowledgeBankEntry(
        team_id=document.team_id,
        matter_id=document.matter_id,
        source_document_id=document.id,
        scope="matter" if document.matter_id else "private",
        entry_type="knowledge_bank",
        title=document.filename,
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
    sync_metadata_safe(db, sync_kb_metadata, entry)
    return entry


# --- Durable worker claiming ---------------------------------------------


def claim_pending_kb_entry(db: Session) -> WorkerClaim | None:
    """Atomically claim one pending entry, including stale jobs after restarts."""
    stale_before = datetime.now(UTC) - STALE_CLAIM_AFTER
    db.execute(
        update(KnowledgeBankEntry)
        .where(
            KnowledgeBankEntry.status == "processing",
            KnowledgeBankEntry.processing_attempts >= MAX_PROCESSING_ATTEMPTS,
            or_(
                KnowledgeBankEntry.processing_started_at.is_(None),
                KnowledgeBankEntry.processing_started_at < stale_before,
            ),
        )
        .values(
            status="failed",
            error_message=(
                f"Processing failed after {MAX_PROCESSING_ATTEMPTS} attempts "
                "(possible worker restart or timeout)"
            ),
            processing_started_at=None,
        )
    )
    db.commit()

    entry_id = db.scalar(
        select(KnowledgeBankEntry.id)
        .where(
            KnowledgeBankEntry.status == "processing",
            KnowledgeBankEntry.processing_attempts < MAX_PROCESSING_ATTEMPTS,
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
    started_at = datetime.now(UTC)
    db.execute(
        update(KnowledgeBankEntry)
        .where(KnowledgeBankEntry.id == entry_id)
        .values(
            processing_started_at=started_at,
            processing_attempts=KnowledgeBankEntry.processing_attempts + 1,
        )
    )
    db.commit()
    return WorkerClaim(job_id=entry_id, started_at=started_at)


# --- Async: format + embed in the worker ---------------------------------


async def process_kb_summary(claim: WorkerClaim) -> None:
    """Background task: lightly format document text and embed the KB entry."""
    entry_id = claim.job_id
    db = SessionLocal()
    validation_error: str | None = None
    entry_title = ""
    document_filename = ""
    raw_text = ""
    try:
        entry = db.scalar(
            select(KnowledgeBankEntry).where(
                KnowledgeBankEntry.id == entry_id,
                KnowledgeBankEntry.status == "processing",
                KnowledgeBankEntry.processing_started_at == claim.started_at,
            )
        )
        if not entry:
            return
        entry_title = entry.title
        if not entry.source_document_id:
            validation_error = "Entry has no source document."
        else:
            document = db.get(Document, entry.source_document_id)
            if not document:
                validation_error = "Source document not found."
            elif document.status != "ready":
                validation_error = "Source document is not ready yet."
            else:
                document_filename = document.filename
                chunk_rows = list(
                    db.execute(
                        select(
                            DocumentChunk.chunk_index,
                            DocumentChunk.text,
                        )
                        .where(DocumentChunk.document_id == document.id)
                        .order_by(DocumentChunk.chunk_index)
                    ).mappings()
                )
                if not chunk_rows:
                    validation_error = "Document has no extracted text."
                else:
                    raw_text = _concat_chunks(chunk_rows)
                    if not raw_text:
                        validation_error = "Document text is empty after extraction."
    finally:
        db.close()

    if validation_error:
        _mark_failed(claim, validation_error)
        return

    provider = DeepSeekProvider()
    try:
        content, _ = await asyncio.wait_for(
            provider.chat(
                _build_format_prompt(filename=document_filename, raw_text=raw_text),
                model=FORMAT_MODEL,
            ),
            timeout=FORMAT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        _mark_failed(claim, f"Formatting timed out after {int(FORMAT_TIMEOUT_SECONDS)}s")
        return
    except DeepSeekError as exc:
        _mark_failed(claim, f"Formatting failed: {exc}")
        return
    except Exception as exc:  # noqa: BLE001
        _mark_failed(claim, f"Unexpected formatting failure: {exc}")
        return

    try:
        title, body_markdown = _parse_format_response(content, fallback_title=entry_title)
    except ValueError as exc:
        _mark_failed(claim, str(exc))
        return

    try:
        embedding = (
            await embed_texts([build_entry_embedding_text(title, body_markdown)])
        )[0]
        embedding_content_hash = build_entry_embedding_hash(title, body_markdown)
    except EmbeddingError as exc:
        _mark_failed(claim, f"Embedding failed: {exc}")
        return
    except Exception as exc:  # noqa: BLE001
        _mark_failed(claim, f"Unexpected embedding failure: {exc}")
        return

    db = SessionLocal()
    try:
        entry = db.scalar(
            select(KnowledgeBankEntry)
            .where(
                KnowledgeBankEntry.id == entry_id,
                KnowledgeBankEntry.status == "processing",
                KnowledgeBankEntry.processing_started_at == claim.started_at,
            )
            .with_for_update()
        )
        if not entry:
            return
        entry.title = title
        entry.body_markdown = body_markdown
        entry.embedding = embedding
        entry.embedding_content_hash = embedding_content_hash
        entry.status = "ready"
        entry.error_message = None
        entry.processing_started_at = None
        entry.version += 1
        db.commit()
        sync_metadata_safe(db, sync_kb_metadata, entry)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _mark_failed(claim, f"Unexpected error: {exc}")
    finally:
        db.close()


def _mark_failed(claim: WorkerClaim, message: str) -> None:
    db = SessionLocal()
    try:
        entry = db.scalar(
            select(KnowledgeBankEntry)
            .where(
                KnowledgeBankEntry.id == claim.job_id,
                KnowledgeBankEntry.status == "processing",
                KnowledgeBankEntry.processing_started_at == claim.started_at,
            )
            .with_for_update()
        )
        if not entry:
            return
        entry.status = "failed"
        entry.error_message = message[:MAX_ERROR_LENGTH]
        entry.processing_started_at = None
        db.commit()
        sync_metadata_safe(db, sync_kb_metadata, entry)
    finally:
        db.close()


# --- Prompt building -----------------------------------------------------


_SYSTEM_PROMPT = """\
You are a document formatter for a legal knowledge base. You receive raw text \
extracted from a PDF and return a clean, readable markdown version.

Rules:
- Preserve ALL content and information. Do not summarise, condense, or omit \
  anything. Every sentence, clause, and data point must appear in your output.
- Remove artefacts that are clearly not document content: repeated page \
  headers, footers, page numbers, watermarks, and OCR noise characters.
- Fix obvious OCR errors (e.g. "tbe" → "the", broken hyphenation across lines).
- Add appropriate markdown structure: use ## headings for major sections you \
  can identify, bullet points where the source uses lists. Do not invent \
  structure that is not implied by the source text.
- Write a concise descriptive title (max 80 chars) that identifies the \
  document type and subject matter.\
"""

_USER_PROMPT = """\
Format the raw extracted text below into clean markdown.

Return ONLY valid JSON with this exact shape (no markdown fences, no \
commentary outside the JSON):
{{
  "title": "Concise descriptive title (max 80 chars)",
  "body": "...full formatted markdown..."
}}

Filename: {filename}

Raw text ({char_count} chars):
{raw_text}\
"""


def _build_format_prompt(*, filename: str, raw_text: str) -> list[dict[str, str]]:
    truncated = raw_text[:MAX_INGEST_CHARS]
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _USER_PROMPT.format(
                filename=filename,
                char_count=len(truncated),
                raw_text=truncated,
            ),
        },
    ]


def _parse_format_response(content: str, *, fallback_title: str) -> tuple[str, str]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[-1] if cleaned.count("```") >= 2 else cleaned
        cleaned = cleaned.lstrip("json").strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    if not cleaned.startswith("{"):
        first = cleaned.find("{")
        if first >= 0:
            cleaned = cleaned[first:]

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Formatter returned invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("Formatter JSON was not an object.")

    body = data.get("body") or data.get("body_markdown") or ""
    if not isinstance(body, str) or not body.strip():
        raise ValueError("Formatter returned empty body.")

    title = data.get("title") or ""
    if not isinstance(title, str) or not title.strip():
        title = fallback_title

    return title.strip(), body.strip()


# --- Text assembly -------------------------------------------------------


def _concat_chunks(chunks: list) -> str:
    """Join chunk texts in order, separated by a blank line."""
    parts = [(chunk["text"] or "").strip() for chunk in chunks]
    return "\n\n".join(p for p in parts if p)
