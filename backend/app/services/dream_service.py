"""Dream agent — memory consolidation.

Reviews a user's recent chat history and existing memory bank, then
applies a minimal set of additions, merges, updates, and drops. Jobs are
claimed by the durable worker and each automated memory change stores
the agent's justification.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, desc, or_, select, update
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import ChatMessage, ChatThread, DreamJob, Memory, User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider
from app.schemas import (
    DreamAddition,
    DreamDrop,
    DreamJobStatus,
    DreamMerge,
    DreamProposal,
    DreamUpdate,
    MemoryResponse,
)
from app.services.memory_service import list_memories

RECENT_MESSAGE_LIMIT = 50
RECENT_MESSAGE_CHAR_BUDGET = 30_000
RATE_LIMIT_WINDOW = timedelta(minutes=5)
DREAM_MODEL = "deepseek-v4-pro"
DREAM_JOB_RETENTION = timedelta(days=1)
STALE_CLAIM_AFTER = timedelta(minutes=10)


def _gc_dream_jobs(db: Session) -> None:
    cutoff = datetime.now(UTC) - DREAM_JOB_RETENTION
    db.execute(delete(DreamJob).where(DreamJob.created_at < cutoff))
    db.commit()


SYSTEM_PROMPT = """You are a memory consolidation agent. You review a user's recent chat history and their existing memory bank, then propose a minimal set of changes that make the memory bank more accurate and useful, without deleting anything the user clearly still relies on.

Rules:
- Be conservative. Default to keeping existing memories. Only delete when there is clear evidence in the chat history that the fact has changed (e.g. user states a new supervising partner).
- Group near-identical memories into a single merged version. A merge must reference at least two existing memory_ids.
- New memories must be specific and durable. "Asked about clause 7" is too episodic; "prefers worked examples in answers" is durable.
- This is a global personal-memory pass. Do not add matter-specific facts or confidential document content.
- Never propose memories that are sensitive personal information unless the user has already stored similar themselves.
- Use only the memory_ids provided in the existing memory list. Never invent ids.
- Return JSON only — no commentary, no markdown fences.

Categories: semantic (stable facts about the user or firm), procedural (how the user wants the assistant to behave), episodic (significant non-confidential events from sessions).

Output shape:
{
  "additions": [{"category": "semantic|procedural|episodic", "content": "...", "reason": "..."}],
  "merges":    [{"replace_ids": ["...", "..."], "category": "semantic|procedural|episodic", "content": "...", "reason": "..."}],
  "updates":   [{"memory_id": "...", "content": "...", "reason": "..."}],
  "drops":     [{"memory_id": "...", "reason": "..."}]
}
"""


def _check_rate_limit(db: Session, user_id: str) -> None:
    cutoff = datetime.now(UTC) - RATE_LIMIT_WINDOW
    last_job = db.scalar(
        select(DreamJob)
        .where(DreamJob.user_id == user_id, DreamJob.created_at >= cutoff)
        .order_by(desc(DreamJob.created_at))
        .limit(1)
    )
    if last_job is not None:
        elapsed = datetime.now(UTC) - last_job.created_at.replace(tzinfo=UTC)
        retry_in = int((RATE_LIMIT_WINDOW - elapsed).total_seconds())
        raise HTTPException(
            status_code=429,
            detail=f"Dream is resting. Try again in {retry_in} seconds.",
        )


def _load_recent_messages(db: Session, *, user_id: str) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .join(ChatThread, ChatMessage.thread_id == ChatThread.id)
        .where(ChatThread.user_id == user_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(RECENT_MESSAGE_LIMIT)
    )
    messages = list(db.scalars(stmt))
    messages.reverse()  # oldest first for prompt readability

    # Cap total characters too.
    total = 0
    keep: list[ChatMessage] = []
    for msg in reversed(messages):  # walk newest→oldest, keep what fits
        size = len(msg.content or "")
        if total + size > RECENT_MESSAGE_CHAR_BUDGET:
            break
        keep.append(msg)
        total += size
    keep.reverse()
    return keep


def _build_user_prompt(*, memories: list[Memory], messages: list[ChatMessage]) -> str:
    today = datetime.now(UTC).strftime("%Y-%m-%d")

    memory_lines = []
    for m in memories:
        memory_lines.append(
            f'- id={m.id} category={m.category} updated={m.updated_at.strftime("%Y-%m-%d")}\n  content: {m.content}'
        )
    memory_block = "\n".join(memory_lines) if memory_lines else "(none)"

    message_lines = []
    for msg in messages:
        when = msg.created_at.strftime("%Y-%m-%d")
        message_lines.append(f"[{when}] {msg.role}: {msg.content}")
    message_block = "\n".join(message_lines) if message_lines else "(no recent chat history)"

    return (
        f"Today's date: {today}\n\n"
        f"Existing memories ({len(memories)}):\n{memory_block}\n\n"
        f"Recent chat messages ({len(messages)}, oldest first):\n{message_block}\n\n"
        "Return the JSON proposal now."
    )


def _strip_fences(content: str) -> str:
    s = content.strip()
    if s.startswith("```json"):
        s = s[7:]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()


def _parse_dream_proposal(
    raw_response: str,
    *,
    existing_memory_ids: set[str],
    reviewed_message_count: int,
) -> DreamProposal:
    cleaned = _strip_fences(raw_response)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Dream agent returned invalid JSON: {exc}",
        ) from exc

    additions: list[DreamAddition] = []
    merges: list[DreamMerge] = []
    updates: list[DreamUpdate] = []
    drops: list[DreamDrop] = []
    merged_ids: set[str] = set()

    for item in data.get("additions", []) or []:
        try:
            additions.append(DreamAddition.model_validate(item))
        except Exception:
            continue

    for item in data.get("merges", []) or []:
        try:
            merge = DreamMerge.model_validate(item)
        except Exception:
            continue
        replace_ids = set(merge.replace_ids)
        # Require two distinct, owned memories and reject overlapping merges.
        if (
            len(replace_ids) < 2
            or not replace_ids.issubset(existing_memory_ids)
            or replace_ids & merged_ids
        ):
            continue
        merges.append(merge)
        merged_ids.update(replace_ids)

    for item in data.get("updates", []) or []:
        try:
            update = DreamUpdate.model_validate(item)
        except Exception:
            continue
        if update.memory_id not in existing_memory_ids:
            continue
        # Skip updates targeting a memory already consumed by a merge.
        if update.memory_id in merged_ids:
            continue
        updates.append(update)

    updated_ids = {u.memory_id for u in updates}

    for item in data.get("drops", []) or []:
        try:
            drop = DreamDrop.model_validate(item)
        except Exception:
            continue
        if drop.memory_id not in existing_memory_ids:
            continue
        # Skip drops that conflict with a merge or an update.
        if drop.memory_id in merged_ids or drop.memory_id in updated_ids:
            continue
        drops.append(drop)

    return DreamProposal(
        additions=additions,
        merges=merges,
        updates=updates,
        drops=drops,
        reviewed_message_count=reviewed_message_count,
    )


async def _run_dream_consolidation(*, user_id: str) -> DreamProposal:
    """Run consolidation with a fresh DB session — for use inside a
    background task."""
    db = SessionLocal()
    try:
        memories = list_memories(db, user_id=user_id)
        recent_messages = _load_recent_messages(db, user_id=user_id)

        if not memories and not recent_messages:
            return DreamProposal(reviewed_message_count=0)

        prompt_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _build_user_prompt(memories=memories, messages=recent_messages),
            },
        ]

        raw_response, _ = await DeepSeekProvider().chat(prompt_messages, model=DREAM_MODEL)

        return _parse_dream_proposal(
            raw_response,
            existing_memory_ids={m.id for m in memories},
            reviewed_message_count=len(recent_messages),
        )
    finally:
        db.close()


def claim_pending_dream_job(db: Session) -> str | None:
    """Atomically claim one queued Dream job, including stale jobs."""
    stale_before = datetime.now(UTC) - STALE_CLAIM_AFTER
    job_id = db.scalar(
        select(DreamJob.id)
        .where(
            DreamJob.status == "processing",
            or_(
                DreamJob.processing_started_at.is_(None),
                DreamJob.processing_started_at < stale_before,
            ),
        )
        .order_by(DreamJob.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if not job_id:
        return None

    db.execute(
        update(DreamJob)
        .where(DreamJob.id == job_id)
        .values(
            processing_started_at=datetime.now(UTC),
            processing_attempts=DreamJob.processing_attempts + 1,
            error_message=None,
        )
    )
    db.commit()
    return job_id


def _mark_dream_failed(job_id: str, claim_started_at: datetime, error: str) -> None:
    db = SessionLocal()
    try:
        job = db.scalar(
            select(DreamJob).where(DreamJob.id == job_id).with_for_update()
        )
        if (
            job is None
            or job.status != "processing"
            or job.processing_started_at != claim_started_at
        ):
            return
        job.status = "failed"
        job.error_message = error[:2000]
        job.processing_started_at = None
        db.commit()
    finally:
        db.close()


def _apply_dream_proposal(
    db: Session,
    *,
    user_id: str,
    proposal: DreamProposal,
) -> None:
    """Apply the validated proposal in the caller's transaction."""
    referenced_ids: set[str] = set()
    for merge in proposal.merges:
        referenced_ids.update(merge.replace_ids)
    for item in proposal.updates:
        referenced_ids.add(item.memory_id)
    for drop in proposal.drops:
        referenced_ids.add(drop.memory_id)

    owned: dict[str, Memory] = {}
    if referenced_ids:
        owned = {
            memory.id: memory
            for memory in db.scalars(
                select(Memory)
                .where(Memory.id.in_(referenced_ids), Memory.user_id == user_id)
                .with_for_update()
            )
        }
        missing = referenced_ids - owned.keys()
        if missing:
            raise RuntimeError(
                "Memory bank changed while Dream was running; please run Dream again."
            )

    for item in proposal.updates:
        memory = owned[item.memory_id]
        memory.content = item.content
        memory.justification = item.reason

    for merge in proposal.merges:
        db.add(
            Memory(
                user_id=user_id,
                category=merge.category,
                content=merge.content,
                justification=merge.reason,
                confidence=1.0,
            )
        )
        for memory_id in merge.replace_ids:
            db.delete(owned[memory_id])

    for drop in proposal.drops:
        db.delete(owned[drop.memory_id])

    for addition in proposal.additions:
        db.add(
            Memory(
                user_id=user_id,
                category=addition.category,
                content=addition.content,
                justification=addition.reason,
                confidence=1.0,
            )
        )


async def process_dream_job(job_id: str) -> None:
    """Generate and atomically apply one claimed Dream job."""
    metadata_db = SessionLocal()
    try:
        job = metadata_db.get(DreamJob, job_id)
        if (
            job is None
            or job.status != "processing"
            or job.processing_started_at is None
        ):
            return
        user_id = job.user_id
        claim_started_at = job.processing_started_at
    finally:
        metadata_db.close()

    try:
        proposal = await _run_dream_consolidation(user_id=user_id)
    except DeepSeekError as exc:
        _mark_dream_failed(job_id, claim_started_at, str(exc))
        return
    except HTTPException as exc:
        _mark_dream_failed(
            job_id,
            claim_started_at,
            exc.detail if isinstance(exc.detail, str) else "Dream failed",
        )
        return
    except Exception as exc:  # noqa: BLE001
        _mark_dream_failed(job_id, claim_started_at, f"Dream failed: {exc}")
        return

    db = SessionLocal()
    try:
        job = db.scalar(
            select(DreamJob).where(DreamJob.id == job_id).with_for_update()
        )
        if (
            job is None
            or job.status != "processing"
            or job.processing_started_at != claim_started_at
        ):
            return

        _apply_dream_proposal(db, user_id=user_id, proposal=proposal)
        job.status = "completed"
        job.proposal_json = proposal.model_dump_json()
        job.error_message = None
        job.processing_started_at = None
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _mark_dream_failed(job_id, claim_started_at, f"Dream failed: {exc}")
    finally:
        db.close()


def start_dream_job(db: Session, *, user: User) -> DreamJobStatus:
    _gc_dream_jobs(db)
    _check_rate_limit(db, user.id)

    job_id = uuid.uuid4().hex
    job = DreamJob(id=job_id, user_id=user.id, status="processing")
    db.add(job)
    db.commit()

    return DreamJobStatus(job_id=job_id, status="processing")


def get_dream_job(db: Session, *, user: User, job_id: str) -> DreamJobStatus:
    job = db.scalar(
        select(DreamJob).where(DreamJob.id == job_id, DreamJob.user_id == user.id)
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Dream job not found")

    proposal: DreamProposal | None = None
    memories: list[MemoryResponse] | None = None
    if job.status == "completed" and job.proposal_json:
        proposal = DreamProposal.model_validate_json(job.proposal_json)
        memories = [
            MemoryResponse.model_validate(memory)
            for memory in list_memories(db, user_id=user.id)
        ]

    return DreamJobStatus(
        job_id=job_id,
        status=job.status,
        proposal=proposal,
        memories=memories,
        error_message=job.error_message,
    )
