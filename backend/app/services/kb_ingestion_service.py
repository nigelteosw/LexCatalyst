"""Async ingestion of uploaded documents into the Knowledge Bank.

Flow:
  1. `create_pending_kb_entry` runs synchronously in the request handler.
     It creates a `kb_entries` row with `status="processing"`, an empty
     body, and no embedding, then returns it immediately.
  2. The embedded combined worker claims processing rows from Postgres and calls
     `process_kb_summary`. It opens its own DB session, summarises a bounded
     set of document extracts using DeepSeek Pro,
     writes the summary into the entry body, computes the embedding, and
     flips the status to `"ready"`. On failure it records `"failed"`.

The KB entry's `source_document_id` lets the agent later call
`read_document` to pull the full extracted text when the summary is
insufficient.
"""

import asyncio
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
    build_entry_embedding_hash,
    build_entry_embedding_text,
    log_kb_access,
)
from app.worker_types import WorkerClaim

# Keep enough source text for a typical long-form legal document while leaving
# room for the model to produce a detailed legal digest.
SUMMARY_MODEL = "deepseek-v4-pro"
MAX_INGEST_CHUNKS = 80
MAX_CHUNK_CHARS = 3000
MAX_ERROR_LENGTH = 1000
STALE_CLAIM_AFTER = timedelta(minutes=30)
MAX_PROCESSING_ATTEMPTS = 3
SUMMARY_TIMEOUT_SECONDS = 180.0


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
        existing.processing_attempts = 0
        db.commit()
        db.refresh(existing)
        return existing

    entry = KnowledgeBankEntry(
        team_id=None,
        matter_id=None,
        source_document_id=document.id,
        scope="private",
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


# --- Async: summarise + embed in the worker ------------------------------


async def process_kb_summary(claim: WorkerClaim) -> None:
    """Background task: summarise the document and finalise the KB entry."""
    entry_id = claim.job_id
    db = SessionLocal()
    validation_error: str | None = None
    entry_title = ""
    document_filename = ""
    chunks: list[Mapping[str, Any]] = []
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
                            DocumentChunk.citation_label,
                            DocumentChunk.text,
                        )
                        .where(DocumentChunk.document_id == document.id)
                        .order_by(DocumentChunk.chunk_index)
                    ).mappings()
                )
                if not chunk_rows:
                    validation_error = "Document has no extracted text."
                else:
                    chunks = _sample_chunks(chunk_rows, MAX_INGEST_CHUNKS)
    finally:
        db.close()

    if validation_error:
        _mark_failed(claim, validation_error)
        return

    provider = DeepSeekProvider()
    try:
        content, _ = await asyncio.wait_for(
            provider.chat(
                _build_prompt(filename=document_filename, chunks=chunks),
                model=SUMMARY_MODEL,
            ),
            timeout=SUMMARY_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        _mark_failed(
            claim,
            f"Summary generation timed out after {int(SUMMARY_TIMEOUT_SECONDS)}s",
        )
        return
    except DeepSeekError as exc:
        _mark_failed(claim, f"Summary generation failed: {exc}")
        return
    except Exception as exc:  # noqa: BLE001 - persist unexpected provider failures
        _mark_failed(claim, f"Unexpected summary failure: {exc}")
        return

    try:
        parsed = _parse_summary(content)
    except KbIngestionError as exc:
        _mark_failed(claim, str(exc))
        return

    title = parsed["title"] or entry_title
    body_markdown = parsed["body_markdown"]
    try:
        embedding = (
            await embed_texts([build_entry_embedding_text(title, body_markdown)])
        )[0]
        embedding_content_hash = build_entry_embedding_hash(title, body_markdown)
    except EmbeddingError as exc:
        _mark_failed(claim, f"Embedding failed: {exc}")
        return
    except Exception as exc:  # noqa: BLE001 - persist unexpected provider failures
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
    except Exception as exc:  # noqa: BLE001 — last-resort safety net
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
    finally:
        db.close()


# --- Prompt building -----------------------------------------------------


_SYSTEM_PROMPT = """\
You are a senior legal knowledge lawyer preparing a comprehensive internal \
Knowledge Bank entry from an uploaded document. Your reader is a practising \
lawyer who may rely on the entry for drafting, negotiation, due diligence, \
case preparation, or client advice before opening the source document.

Your primary objective is coverage and legal usefulness, not brevity. Read \
across all supplied extracts and capture every material legal, commercial, \
procedural, and factual point. Do not reduce a complex document to a handful \
of generic observations.

Analysis rules:
- Identify the document type, status, purpose, parties, roles, relevant \
  entities, governing context, and how the document is intended to operate.
- Preserve legally significant detail exactly where available: defined terms, \
  dates, periods, amounts, percentages, thresholds, conditions, exceptions, \
  qualifications, discretion, standards, notice requirements, approval \
  mechanics, survival periods, governing law, forum, and clause or authority \
  references.
- Explain material obligations, prohibitions, rights, remedies, liabilities, \
  indemnities, warranties, termination rights, dependencies, and procedural \
  steps. State who must or may do what, when, and with what consequence.
- For judgments, opinions, advice, policies, or guidance, capture the issues, \
  material facts, positions, legal tests or authorities, reasoning, outcome, \
  and practical implications. For agreements, capture the operative bargain \
  and allocation of risk. Adapt the analysis to the actual document type.
- Surface internal inconsistencies, ambiguity, missing information, unusual \
  drafting, one-sided provisions, open items, deadlines, and points requiring \
  verification or lawyer judgment.
- Distinguish what the document expressly states from cautious inference. \
  Never invent facts, clauses, authorities, risks, or legal conclusions.
- Do not omit a material point merely because a similar provision was already \
  discussed. Consolidate genuine repetition while preserving distinct \
  exceptions, conditions, and consequences.

Writing and citation rules:
- Use precise, neutral, professional legal prose and descriptive ## headings.
- Prefer specific bullets over long narrative paragraphs, but include enough \
  explanation to make each point useful without reopening the source.
- Cite every substantive source-grounded statement inline as [p.X], using the \
  page number in the chunk label. If no page is available, omit the citation \
  rather than displaying a chunk ID.
- If a proposition spans pages, cite each relevant page, for example \
  [p.4, p.7]. Never create a "Source Notes" section or UUID-style footnotes.
- Aim for 900–1,800 words for a substantial document, but let complexity \
  determine length. Completeness takes priority over hitting a word target.
- Do not repeat the filename mechanically and do not add generic legal \
  disclaimers or filler.\
"""

_USER_PROMPT = """\
Create one comprehensive, lawyer-ready KB entry from the document extracts \
below. Treat the extracts as parts of one document and reconcile information \
across them before writing.

Return ONLY valid JSON with this exact shape — no markdown fences and no \
commentary outside the JSON:
{{
  "title": "Concise descriptive title (max 80 chars)",
  "body_markdown": "..."
}}

Use the following structure in body_markdown. Omit a section only when it is \
genuinely inapplicable, and add a more specific ## section when the document \
contains a material topic that does not fit the headings below.

## Executive Overview
A concise but substantive orientation: document type and status, subject, \
parties or actors, purpose, operative context, and overall legal effect.

## Parties, Roles, and Scope
Identify each material party, entity, decision-maker, beneficiary, regulator, \
court, or other actor; explain their role and the scope of the document.

## Material Terms and Legal Analysis
Organise the operative content by issue. Cover all material rights, \
obligations, restrictions, conditions, exceptions, standards, procedures, \
representations, risk allocation, and consequences. Use descriptive \
subheadings or grouped bullets where that improves clarity.

## Key Dates, Amounts, and Deadlines
List all legally or commercially significant dates, time periods, notice \
windows, monetary amounts, percentages, thresholds, and dependencies. Explain \
what each controls. Omit only if none exist.

## Outcome, Remedies, or Consequences
Explain the result, available remedies, enforcement mechanisms, termination \
effects, liability exposure, sanctions, or practical consequences, as \
applicable.

## Risks, Ambiguities, and Open Points
Identify drafting concerns, factual gaps, conflicting provisions, assumptions, \
one-sided terms, missing schedules or definitions, unresolved questions, and \
items that require verification or legal judgment.

## Practical Lawyer Checklist
Give concrete next steps for review, drafting, negotiation, due diligence, \
advice, compliance, litigation, or matter management. Tie each step to a \
specific issue in the document rather than offering generic advice.

Before returning the JSON, silently check that:
1. Every supplied extract was considered.
2. No material party, obligation, right, exception, date, amount, remedy, \
   authority, or risk was omitted.
3. Each substantive point is accurately cited where page information exists.
4. Express document content is not presented as your own unsupported legal \
   conclusion.

Document filename: {filename}

Document extracts ({chunk_count} supplied):
{chunks}\
"""


def _build_prompt(
    *,
    filename: str,
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
                filename=filename,
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
