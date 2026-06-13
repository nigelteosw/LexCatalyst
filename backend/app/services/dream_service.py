"""Dream agent — memory consolidation.

Reviews a user's recent chat history and existing memory bank, then
proposes a minimal set of additions, merges, updates, and drops. The
agent never writes to the DB directly: it returns a proposal that the
user reviews and accepts (in whole or part) via a separate apply call.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import ChatMessage, ChatThread, DreamJob, Memory, User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider
from app.schemas import (
    AcceptedDreamProposal,
    DreamAddition,
    DreamApplyResult,
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
DREAM_JOB_TTL = timedelta(minutes=30)


def _gc_dream_jobs(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - DREAM_JOB_TTL
    db.execute(delete(DreamJob).where(DreamJob.created_at < cutoff))
    db.commit()


SYSTEM_PROMPT = """You are a memory consolidation agent. You review a user's recent chat history and their existing memory bank, then propose a minimal set of changes that make the memory bank more accurate and useful, without deleting anything the user clearly still relies on.

Rules:
- Be conservative. Default to keeping existing memories. Only delete when there is clear evidence in the chat history that the fact has changed (e.g. user states a new supervising partner).
- Group near-identical memories into a single merged version. A merge must reference at least two existing memory_ids.
- New memories must be specific and durable. "Asked about clause 7" is too episodic; "prefers worked examples in answers" is durable.
- Never propose memories that are sensitive personal information unless the user has already stored similar themselves.
- Use only the memory_ids provided in the existing memory list. Never invent ids.
- Return JSON only — no commentary, no markdown fences.

Categories: semantic (stable facts about user/firm/matters), procedural (how the user wants the assistant to behave), episodic (significant events from sessions).

Output shape:
{
  "additions": [{"category": "semantic|procedural|episodic", "content": "...", "reason": "..."}],
  "merges":    [{"replace_ids": ["...", "..."], "category": "semantic|procedural|episodic", "content": "...", "reason": "..."}],
  "updates":   [{"memory_id": "...", "content": "...", "reason": "..."}],
  "drops":     [{"memory_id": "...", "reason": "..."}]
}
"""


def _check_rate_limit(db: Session, user_id: str) -> None:
    cutoff = datetime.now(timezone.utc) - RATE_LIMIT_WINDOW
    last_job = db.scalar(
        select(DreamJob)
        .where(DreamJob.user_id == user_id, DreamJob.created_at >= cutoff)
        .order_by(desc(DreamJob.created_at))
        .limit(1)
    )
    if last_job is not None:
        elapsed = datetime.now(timezone.utc) - last_job.created_at.replace(tzinfo=timezone.utc)
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
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

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
        # Drop any merge that references a non-existent memory.
        if not set(merge.replace_ids).issubset(existing_memory_ids):
            continue
        merges.append(merge)

    # Collect all memory IDs claimed by merges and drops so we can guard
    # against the LLM proposing conflicting operations on the same memory.
    merged_ids: set[str] = {mid for m in merges for mid in m.replace_ids}
    dropped_ids: set[str] = set()

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
        dropped_ids.add(drop.memory_id)

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


def _write_job_result(
    job_id: str,
    *,
    proposal: DreamProposal | None = None,
    error: str | None = None,
) -> None:
    db = SessionLocal()
    try:
        job = db.get(DreamJob, job_id)
        if job is None:
            return
        if proposal is not None:
            job.status = "ready"
            job.proposal_json = proposal.model_dump_json()
        else:
            job.status = "failed"
            job.error_message = error
        db.commit()
    finally:
        db.close()


async def _dream_job_worker(job_id: str, user_id: str) -> None:
    try:
        proposal = await _run_dream_consolidation(user_id=user_id)
        _write_job_result(job_id, proposal=proposal)
    except DeepSeekError as exc:
        _write_job_result(job_id, error=str(exc))
    except HTTPException as exc:
        _write_job_result(
            job_id,
            error=exc.detail if isinstance(exc.detail, str) else "Dream failed",
        )
    except Exception as exc:  # noqa: BLE001
        _write_job_result(job_id, error=f"Dream failed: {exc}")


def start_dream_job(db: Session, *, user: User) -> DreamJobStatus:
    _gc_dream_jobs(db)
    _check_rate_limit(db, user.id)

    job_id = uuid.uuid4().hex
    job = DreamJob(id=job_id, user_id=user.id, status="processing")
    db.add(job)
    db.commit()

    asyncio.create_task(_dream_job_worker(job_id, user.id))

    return DreamJobStatus(job_id=job_id, status="processing")


def get_dream_job(db: Session, *, user: User, job_id: str) -> DreamJobStatus:
    job = db.scalar(
        select(DreamJob).where(DreamJob.id == job_id, DreamJob.user_id == user.id)
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Dream job not found")

    # If the background task was lost (e.g. server restart), surface a failure
    # rather than leaving the client polling forever.
    if job.status == "processing":
        age = datetime.now(timezone.utc) - job.created_at.replace(tzinfo=timezone.utc)
        if age > DREAM_JOB_TTL:
            job.status = "failed"
            job.error_message = "Dream job timed out. Please try again."
            db.commit()

    proposal: DreamProposal | None = None
    if job.status == "ready" and job.proposal_json:
        proposal = DreamProposal.model_validate_json(job.proposal_json)

    return DreamJobStatus(
        job_id=job_id,
        status=job.status,
        proposal=proposal,
        error_message=job.error_message,
    )


def apply_dream_proposal(
    db: Session, *, user: User, accepted: AcceptedDreamProposal,
) -> DreamApplyResult:
    """Apply accepted items atomically. Every referenced memory_id must
    belong to the calling user."""

    referenced_ids: set[str] = set()
    for merge in accepted.merges:
        referenced_ids.update(merge.replace_ids)
    for update in accepted.updates:
        referenced_ids.add(update.memory_id)
    for drop in accepted.drops:
        referenced_ids.add(drop.memory_id)

    owned: dict[str, Memory] = {}
    if referenced_ids:
        stmt = select(Memory).where(
            Memory.id.in_(referenced_ids), Memory.user_id == user.id
        )
        owned = {m.id: m for m in db.scalars(stmt)}
        missing = referenced_ids - owned.keys()
        if missing:
            raise HTTPException(
                status_code=403,
                detail="One or more memories don't belong to you.",
            )

    added_count = 0
    merged_count = 0
    updated_count = 0
    dropped_count = 0

    try:
        # Updates first — they don't depend on anything.
        for update in accepted.updates:
            mem = owned[update.memory_id]
            mem.content = update.content
            updated_count += 1

        # Merges: create the new memory then delete the originals.
        for merge in accepted.merges:
            new_mem = Memory(
                user_id=user.id,
                category=merge.category,
                content=merge.content,
                confidence=1.0,
            )
            db.add(new_mem)
            for mid in merge.replace_ids:
                old = owned.get(mid)
                if old is not None:
                    db.delete(old)
            merged_count += 1

        # Drops.
        for drop in accepted.drops:
            mem = owned.get(drop.memory_id)
            if mem is not None:
                db.delete(mem)
                dropped_count += 1

        # Additions last so we don't accidentally merge against fresh rows.
        for addition in accepted.additions:
            db.add(
                Memory(
                    user_id=user.id,
                    category=addition.category,
                    content=addition.content,
                    confidence=1.0,
                )
            )
            added_count += 1

        db.commit()
    except Exception:
        db.rollback()
        raise

    memories = list_memories(db, user_id=user.id)
    return DreamApplyResult(
        memories=[MemoryResponse.model_validate(m) for m in memories],
        added=added_count,
        merged=merged_count,
        updated=updated_count,
        dropped=dropped_count,
    )
