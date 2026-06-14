"""Structured Review Handoff service.

A handoff is a bounded review package: a junior uploads a PDF of their
analysis (already a `Document` row), the system extracts structured
findings, and a senior reviews them clause-by-clause. See
`docs/rfc-review-handoff.md` for the full design.

Status transitions:
    extracting -> ready_for_review -> in_review -> completed
                                                 -> returned
                                  -> extraction_failed

Worker safety:
- The claim is gated on `Document.status == 'ready'` so a handoff
  whose source PDF is still being ingested is never grabbed off the
  queue (no busy-loop, no DB churn).
- `processing_started_at` + `processing_attempts` follow the same
  pattern as the document/KB queues: claims older than `STALE_CLAIM_AFTER`
  are retried, and a handoff that exhausts `MAX_PROCESSING_ATTEMPTS`
  is failed terminally.
- The DeepSeek call has a hard `EXTRACTION_TIMEOUT_SECONDS` so a hung
  call can't pin a worker slot.
"""

import asyncio
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session, joinedload

from app.database import SessionLocal
from app.models import (
    ActionItem,
    Document,
    DocumentChunk,
    ReviewFinding,
    ReviewHandoff,
    User,
)
from app.providers.deepseek import DeepSeekError, DeepSeekProvider
from app.schemas import ReviewFindingCreate, ReviewHandoffCreate

MAX_ERROR_LENGTH = 1000
STALE_CLAIM_AFTER = timedelta(minutes=10)
MAX_PROCESSING_ATTEMPTS = 3
EXTRACTION_MODEL = "deepseek-v4-pro"
EXTRACTION_TIMEOUT_SECONDS = 90.0
MAX_FINDINGS = 30
MAX_CLAUSE_CHARS = 4000

DEFAULT_LIMIT = 100


class ReviewHandoffError(RuntimeError):
    pass


# --- Sync API ------------------------------------------------------------


def _handoff_query():
    return select(ReviewHandoff).options(
        joinedload(ReviewHandoff.submitter),
        joinedload(ReviewHandoff.reviewer),
        joinedload(ReviewHandoff.document),
        joinedload(ReviewHandoff.findings),
    )


def get_handoff(db: Session, handoff_id: str) -> ReviewHandoff | None:
    return db.scalar(_handoff_query().where(ReviewHandoff.id == handoff_id))


def list_handoffs_for_action(db: Session, action_id: str) -> list[ReviewHandoff]:
    stmt = (
        _handoff_query()
        .where(ReviewHandoff.action_id == action_id)
        .order_by(ReviewHandoff.submitted_at.desc())
    )
    return list(db.scalars(stmt).unique())


def create_handoff(
    db: Session,
    *,
    user: User,
    schema: ReviewHandoffCreate,
) -> ReviewHandoff:
    """Create a handoff for an uploaded PDF, returning the pending row.

    Sets the linked action's `active_handoff_id` and bumps the action
    status to "review" so it surfaces in the senior's Review column.
    """
    document = db.get(Document, schema.document_id)
    if not document:
        raise ReviewHandoffError("Document not found")

    matter_id = schema.matter_id or document.matter_id
    action: ActionItem | None = None
    reviewer_id = schema.reviewer_id
    if schema.action_id:
        action = db.get(ActionItem, schema.action_id)
        if not action:
            raise ReviewHandoffError("Action not found")
        if not matter_id:
            matter_id = action.matter_id
        if not reviewer_id:
            reviewer_id = action.assigner_id

    handoff = ReviewHandoff(
        action_id=action.id if action else None,
        matter_id=matter_id,
        document_id=document.id,
        submitted_by=user.id,
        reviewer_id=reviewer_id,
        status="extracting",
    )
    db.add(handoff)
    db.flush()

    if action is not None:
        action.active_handoff_id = handoff.id
        action.status = "review"

    db.commit()
    db.refresh(handoff)
    return handoff


def update_handoff_status(
    db: Session,
    *,
    handoff_id: str,
    status: str,
    reviewer_id: str | None = None,
) -> ReviewHandoff | None:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return None

    if status == "completed":
        pending_count = db.scalar(
            select(func.count(ReviewFinding.id)).where(
                ReviewFinding.handoff_id == handoff.id,
                ReviewFinding.status == "pending",
            )
        )
        if pending_count:
            raise ReviewHandoffError("All findings must be reviewed before completion")

    handoff.status = status
    if reviewer_id is not None:
        handoff.reviewer_id = reviewer_id
    if status == "completed":
        handoff.completed_at = datetime.now(UTC)
        if handoff.action_id:
            action = db.get(ActionItem, handoff.action_id)
            # Use string comparison to avoid any UUID vs String mismatch issues
            if action and str(action.active_handoff_id) == str(handoff.id):
                action.status = "done"
                action.active_handoff_id = None
    db.commit()
    db.refresh(handoff)
    return get_handoff(db, handoff.id)


def restart_extraction(db: Session, handoff_id: str) -> ReviewHandoff | None:
    """Clear existing findings and re-enqueue for extraction.

    Used when the prompt has improved or extraction returned empty and
    the reviewer wants to try again. Resets attempts so the worker isn't
    blocked by a previously-exhausted retry budget.
    """
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return None
    db.execute(delete(ReviewFinding).where(ReviewFinding.handoff_id == handoff.id))
    handoff.status = "extracting"
    handoff.error_message = None
    handoff.processing_started_at = None
    handoff.processing_attempts = 0
    handoff.completed_at = None
    db.commit()
    return get_handoff(db, handoff.id)


def return_handoff_for_rework(db: Session, handoff_id: str) -> ReviewHandoff | None:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return None
    handoff.status = "returned"
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action:
            action.status = "in_progress"
    db.commit()
    return get_handoff(db, handoff.id)


def create_finding(
    db: Session,
    *,
    handoff: ReviewHandoff,
    schema: ReviewFindingCreate,
) -> ReviewFinding:
    next_seq = (
        db.scalar(
            select(ReviewFinding.sequence)
            .where(ReviewFinding.handoff_id == handoff.id)
            .order_by(ReviewFinding.sequence.desc())
            .limit(1)
        )
        or 0
    ) + 1
    finding = ReviewFinding(
        handoff_id=handoff.id,
        sequence=next_seq,
        original_clause=schema.original_clause,
        proposed_revision=schema.proposed_revision,
        reasoning=schema.reasoning,
        citations=[c.model_dump() for c in schema.citations],
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)
    return finding


def update_finding(
    db: Session,
    *,
    user: User,
    finding_id: str,
    payload: dict[str, Any],
) -> ReviewFinding | None:
    finding = db.get(ReviewFinding, finding_id)
    if not finding:
        return None
    for field, value in payload.items():
        setattr(finding, field, value)
    if "status" in payload:
        finding.reviewed_by = user.id
        finding.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(finding)
    return finding


def delete_finding(db: Session, finding_id: str) -> bool:
    finding = db.get(ReviewFinding, finding_id)
    if not finding:
        return False
    db.delete(finding)
    db.commit()
    return True


def delete_handoff(db: Session, handoff_id: str) -> bool:
    handoff = db.get(ReviewHandoff, handoff_id)
    if not handoff:
        return False

    # If this is the active handoff for an action, clear it
    if handoff.action_id:
        action = db.get(ActionItem, handoff.action_id)
        if action and str(action.active_handoff_id) == str(handoff.id):
            action.active_handoff_id = None
            # Revert status if it was in review
            if action.status == "review":
                action.status = "in_progress"

    db.delete(handoff)
    db.commit()
    return True


def count_reviews_waiting(db: Session, user: User) -> int:
    """Count handoffs awaiting this user's review.

    Matches the sidebar badge: either the user is the explicit reviewer
    or, in the absence of one, they are the assigner of the linked action.
    Status must be `ready_for_review` — `in_review` already opened.
    """
    stmt = (
        select(ReviewHandoff)
        .outerjoin(ActionItem, ActionItem.id == ReviewHandoff.action_id)
        .where(
            ReviewHandoff.status == "ready_for_review",
            or_(
                ReviewHandoff.reviewer_id == user.id,
                ActionItem.assigner_id == user.id,
            ),
        )
    )
    return len(list(db.scalars(stmt)))


# --- Worker queue --------------------------------------------------------


def claim_pending_handoff(db: Session) -> str | None:
    """Atomically claim one handoff whose source document is ready.

    Three guards prevent the slot from busy-looping:

    1. The join on `Document.status == 'ready'` means we never grab a
       handoff whose PDF is still being ingested by the document worker
       — the handoff just sits in the queue until the doc is ready.
       If the doc *failed* ingestion, we still claim so we can mark the
       handoff failed.
    2. `processing_started_at` is set on claim; rows with a fresh claim
       (less than `STALE_CLAIM_AFTER` old) are skipped, so a crashed
       slot doesn't trigger an instant retry.
    3. Handoffs that exceeded `MAX_PROCESSING_ATTEMPTS` are flipped to
       `extraction_failed` before any further claim is attempted.
    """
    # Terminally fail anything that's exhausted retries.
    db.execute(
        update(ReviewHandoff)
        .where(
            ReviewHandoff.status == "extracting",
            ReviewHandoff.processing_attempts >= MAX_PROCESSING_ATTEMPTS,
        )
        .values(
            status="extraction_failed",
            error_message=(
                f"Extraction failed after {MAX_PROCESSING_ATTEMPTS} attempts "
                "(likely a hung LLM call or unparseable PDF)."
            ),
            processing_started_at=None,
            updated_at=datetime.now(UTC),
        )
    )
    db.commit()

    stale_before = datetime.now(UTC) - STALE_CLAIM_AFTER
    handoff_id = db.scalar(
        select(ReviewHandoff.id)
        .join(Document, Document.id == ReviewHandoff.document_id)
        .where(
            ReviewHandoff.status == "extracting",
            Document.status.in_(("ready", "failed")),
            or_(
                ReviewHandoff.processing_started_at.is_(None),
                ReviewHandoff.processing_started_at < stale_before,
            ),
        )
        .order_by(ReviewHandoff.created_at)
        .with_for_update(skip_locked=True, of=ReviewHandoff)
        .limit(1)
    )
    if not handoff_id:
        return None

    db.execute(
        update(ReviewHandoff)
        .where(ReviewHandoff.id == handoff_id)
        .values(
            processing_started_at=datetime.now(UTC),
            processing_attempts=ReviewHandoff.processing_attempts + 1,
        )
    )
    db.commit()
    return handoff_id


async def process_handoff_extraction(handoff_id: str) -> None:
    """Background task: extract findings from the linked PDF.

    The claim has already guaranteed the source document is in `ready`
    or `failed` state, so we never wait here. A `failed` document is
    terminal — the handoff is failed with a useful error.
    """
    db = SessionLocal()
    handoff: ReviewHandoff | None = None
    try:
        handoff = db.get(ReviewHandoff, handoff_id)
        if not handoff or handoff.status != "extracting":
            return

        document = db.get(Document, handoff.document_id)
        if not document:
            _mark_failed(db, handoff, "Source document not found.")
            return
        if document.status == "failed":
            _mark_failed(
                db,
                handoff,
                f"Source document ingestion failed: {document.error_message or 'unknown error'}",
            )
            return
        if document.status != "ready":
            # Should not happen — the claim filters on document.status. If
            # it does, treat as a transient failure and let the next claim
            # re-evaluate once the doc finishes.
            _release_for_retry(db, handoff)
            return

        chunks = list(
            db.execute(
                select(
                    DocumentChunk.chunk_index,
                    DocumentChunk.text,
                )
                .where(DocumentChunk.document_id == document.id)
                .order_by(DocumentChunk.chunk_index)
            ).mappings()
        )
        if not chunks:
            _finalise_with_no_findings(db, handoff)
            return

        prompt = _build_extraction_prompt(document_filename=document.filename, chunks=chunks)

        provider = DeepSeekProvider()
        try:
            content, _ = await asyncio.wait_for(
                provider.chat(prompt, model=EXTRACTION_MODEL),
                timeout=EXTRACTION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            _mark_failed(
                db,
                handoff,
                f"Extraction timed out after {int(EXTRACTION_TIMEOUT_SECONDS)}s",
            )
            return
        except DeepSeekError as exc:
            _mark_failed(db, handoff, f"Extraction failed: {exc}")
            return

        try:
            findings = _parse_findings(content)
        except ReviewHandoffError as exc:
            _mark_failed(db, handoff, str(exc))
            return

        # Idempotency: a retry (e.g. after a crash mid-insert) replaces
        # any partial findings from the previous attempt.
        db.execute(delete(ReviewFinding).where(ReviewFinding.handoff_id == handoff.id))
        for idx, raw in enumerate(findings, start=1):
            db.add(
                ReviewFinding(
                    handoff_id=handoff.id,
                    sequence=idx,
                    original_clause=raw["original_clause"][:MAX_CLAUSE_CHARS],
                    proposed_revision=(raw.get("proposed_revision") or None),
                    reasoning=raw["reasoning"],
                    citations=raw.get("citations") or [],
                )
            )

        handoff.status = "ready_for_review"
        handoff.error_message = None
        handoff.processing_started_at = None
        db.commit()
    except Exception as exc:  # noqa: BLE001 - worker safety net
        if handoff is not None:
            try:
                _mark_failed(db, handoff, f"Unexpected error: {exc}")
            except Exception:  # noqa: BLE001
                db.rollback()
        else:
            db.rollback()
    finally:
        db.close()


def _mark_failed(db: Session, handoff: ReviewHandoff, message: str) -> None:
    handoff.status = "extraction_failed"
    handoff.error_message = message[:MAX_ERROR_LENGTH]
    handoff.processing_started_at = None
    db.commit()


def _release_for_retry(db: Session, handoff: ReviewHandoff) -> None:
    """Clear the claim so the next poll re-evaluates without spinning."""
    handoff.processing_started_at = None
    db.commit()


def _finalise_with_no_findings(db: Session, handoff: ReviewHandoff) -> None:
    """Empty extraction is not a failure — reviewer adds findings manually."""
    handoff.status = "ready_for_review"
    handoff.error_message = None
    handoff.processing_started_at = None
    db.commit()


# --- Prompt --------------------------------------------------------------


_SYSTEM_PROMPT = """\
You are preparing a structured review for a senior lawyer to evaluate. \
The PDF below comes from a junior. It may be one of two things:

  (A) A REVIEW DOCUMENT — the junior has already analysed a contract \
      and the PDF contains their flagged clauses, proposed wording, \
      and reasoning. Extract exactly what they wrote.

  (B) A SOURCE DOCUMENT (the contract itself, or a related document) — \
      the junior is asking the senior to review it. In this case YOU \
      act as the junior's first pass: identify the clauses or passages \
      that warrant senior attention and produce findings.

Either way the output shape is the same. The senior will then approve, \
edit, comment on, or reject each finding.

Rules for every finding:
- `original_clause` MUST be a verbatim quote from the document. Do not \
  paraphrase. Quote the actual clause text or passage at issue.
- `proposed_revision` is suggested wording. In case (A) it is the junior's \
  wording. In case (B) it is your suggested rewrite. Null if there is no \
  rewrite, only a flag for discussion.
- `reasoning` explains why this clause warrants attention: risk allocation, \
  drafting concerns, deviation from market standard, ambiguity, compliance, \
  commercial impact. Be specific and useful to the reviewing senior.
- `citations` is an array of objects `{kind, ref, label}`. `kind` is one \
  of `kb_entry`, `playbook`, `doc`, `external`. `ref` is an identifier \
  if any. `label` is human-readable. Empty array if none.
- Cover indemnities, liability caps, warranties, termination, governing \
  law, IP, confidentiality, payment terms, conditions precedent, dispute \
  resolution, and other clauses that typically warrant senior review.
- Return between 3 and 15 findings for a real contract or review; fewer \
  is fine for a short document. Return 0 only if the document is genuinely \
  not legal in nature and contains nothing to flag.
- Do not invent clauses that aren't in the document. Quotes must be \
  traceable to the supplied text.

Return ONLY valid JSON with this exact shape:
{"findings": [{"original_clause": "...", "proposed_revision": "...", \
"reasoning": "...", "citations": [{"kind": "...", "ref": "...", "label": "..."}]}]}\
"""

_USER_PROMPT = """\
Document filename: {filename}

Determine whether this is a junior's review document or a source document \
(see system instructions), then produce the findings array. Do not write \
any prose outside the JSON.

Document text:
{extracts}\
"""


def _build_extraction_prompt(
    *,
    document_filename: str,
    chunks: list[dict[str, Any]],
) -> list[dict[str, str]]:
    blocks = [chunk["text"] for chunk in chunks]
    body = "\n\n---\n\n".join(blocks)
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _USER_PROMPT.format(filename=document_filename, extracts=body),
        },
    ]


def _parse_findings(content: str) -> list[dict[str, Any]]:
    cleaned = content.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:].strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[3:].strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    if not cleaned.startswith("{"):
        first = cleaned.find("{")
        if first >= 0:
            cleaned = cleaned[first:]

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ReviewHandoffError(f"Extraction was not valid JSON: {exc}") from exc

    findings = data.get("findings") if isinstance(data, dict) else None
    if not isinstance(findings, list):
        raise ReviewHandoffError("Extraction JSON missing `findings` array.")

    cleaned_findings: list[dict[str, Any]] = []
    for raw in findings[:MAX_FINDINGS]:
        if not isinstance(raw, dict):
            continue
        original = raw.get("original_clause")
        reasoning = raw.get("reasoning")
        if not isinstance(original, str) or not original.strip():
            continue
        if not isinstance(reasoning, str) or not reasoning.strip():
            continue
        proposed = raw.get("proposed_revision")
        if proposed is not None and not isinstance(proposed, str):
            proposed = None
        citations_raw = raw.get("citations") or []
        citations: list[dict[str, Any]] = []
        if isinstance(citations_raw, list):
            for cit in citations_raw:
                if not isinstance(cit, dict):
                    continue
                label = cit.get("label")
                if not isinstance(label, str) or not label.strip():
                    continue
                citations.append(
                    {
                        "kind": cit.get("kind") if isinstance(cit.get("kind"), str) else "external",
                        "ref": cit.get("ref") if isinstance(cit.get("ref"), str) else None,
                        "label": label.strip(),
                    }
                )
        cleaned_findings.append(
            {
                "original_clause": _collapse_ws(original),
                "proposed_revision": _collapse_ws(proposed) if proposed else None,
                "reasoning": reasoning.strip(),
                "citations": citations,
            }
        )
    return cleaned_findings


def _collapse_ws(text: str | None) -> str | None:
    if text is None:
        return None
    return re.sub(r"\s+", " ", text).strip()
