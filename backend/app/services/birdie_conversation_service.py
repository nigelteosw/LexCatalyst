"""Durable, owner-only Birdie history. Row locks serialize admission across processes."""
from datetime import UTC, datetime, timedelta
import hashlib
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app.models import BirdieConversation, BirdieTurn, Matter, User, new_uuid
from app.dependencies import require_matter_member
from app.birdie_schemas import RunRequest

RUN_LEASE = timedelta(minutes=5)


def check_matter(db: Session, user: User, matter_id: str | None) -> None:
    if matter_id:
        if not db.get(Matter, matter_id):
            raise HTTPException(404, 'Matter not found')
        require_matter_member(db, user, matter_id)


def owned(db: Session, user: User, conversation_id: str, *, lock: bool = False) -> BirdieConversation:
    stmt = select(BirdieConversation).where(BirdieConversation.id == conversation_id, BirdieConversation.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update()
    conversation = db.scalar(stmt)
    if not conversation:
        raise HTTPException(404, 'Conversation not found')
    check_matter(db, user, conversation.matter_id)
    return conversation


def create(db: Session, user: User, matter_id: str | None, title: str) -> BirdieConversation:
    check_matter(db, user, matter_id)
    conversation = BirdieConversation(user_id=user.id, matter_id=matter_id, title=title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def list_conversations(db: Session, user: User, matter_id: str | None, archived: bool = False):
    check_matter(db, user, matter_id)
    return list(db.scalars(select(BirdieConversation).where(
        BirdieConversation.user_id == user.id, BirdieConversation.matter_id == matter_id,
        BirdieConversation.archived == archived,
    ).order_by(BirdieConversation.updated_at.desc()).limit(100)))


def turns(db: Session, conversation_id: str):
    return list(db.scalars(select(BirdieTurn).where(BirdieTurn.conversation_id == conversation_id)
                           .order_by(BirdieTurn.created_at, BirdieTurn.id)))


def history(db: Session, conversation_id: str) -> list[dict]:
    recent = list(db.scalars(select(BirdieTurn).where(
        BirdieTurn.conversation_id == conversation_id, BirdieTurn.status == 'done',
    ).order_by(BirdieTurn.created_at.desc()).limit(20)))
    messages = []
    budget = 40_000
    for turn in reversed(recent):
        messages.extend([{'role': 'user', 'content': turn.message}, {'role': 'assistant', 'content': turn.answer}])
    # Bound total context; retain complete pairs.
    while messages and sum(len(m['content']) for m in messages) > budget:
        messages = messages[2:]
    return messages


def admit(db: Session, user: User, conversation_id: str, request: RunRequest) -> BirdieTurn:
    conversation = owned(db, user, conversation_id, lock=True)
    if conversation.archived:
        raise HTTPException(409, 'Unarchive this conversation before sending')
    now = datetime.now(UTC)
    db.execute(update(BirdieTurn).where(
        BirdieTurn.conversation_id == conversation_id, BirdieTurn.status == 'running',
        BirdieTurn.started_at < now - RUN_LEASE,
    ).values(status='interrupted', error='Run interrupted; retry to continue'))
    request_hash = hashlib.sha256(request.model_dump_json(exclude={'request_id'}).encode()).hexdigest()
    existing = db.scalar(select(BirdieTurn).where(BirdieTurn.conversation_id == conversation_id, BirdieTurn.request_id == request.request_id))
    if existing and existing.request_hash != request_hash:
        raise HTTPException(409, 'A retry must use the original request')
    if existing and existing.status == 'done':
        db.commit()
        return existing
    running = db.scalar(select(BirdieTurn.id).where(BirdieTurn.conversation_id == conversation_id, BirdieTurn.status == 'running'))
    if running:
        raise HTTPException(409, 'Birdie is already answering in this conversation')
    if existing:
        turn = existing
        turn.status, turn.answer, turn.error, turn.context = 'running', '', None, []
        turn.attempt, turn.started_at = new_uuid(), now
    else:
        turn = BirdieTurn(conversation_id=conversation_id, request_id=request.request_id, request_hash=request_hash,
                          message=request.message, mode=request.mode, instructions=request.instructions)
        db.add(turn)
    conversation.updated_at = now
    db.commit()
    db.refresh(turn)
    return turn


def finish(db: Session, turn_id: str, attempt: str, status: str, answer: str, error: str | None = None) -> bool:
    result = db.execute(update(BirdieTurn).where(BirdieTurn.id == turn_id, BirdieTurn.attempt == attempt,
                                               BirdieTurn.status == 'running').values(status=status, answer=answer, error=error))
    db.commit()
    return result.rowcount == 1


def checkpoint(db: Session, turn_id: str, attempt: str, answer: str, context: list, model: str) -> bool:
    result = db.execute(update(BirdieTurn).where(BirdieTurn.id == turn_id, BirdieTurn.attempt == attempt,
                                               BirdieTurn.status == 'running').values(answer=answer, context=context, model=model,
                                                                                     started_at=datetime.now(UTC)))
    db.commit()
    return result.rowcount == 1


def stop(db: Session, user: User, conversation_id: str) -> None:
    owned(db, user, conversation_id, lock=True)
    db.execute(update(BirdieTurn).where(BirdieTurn.conversation_id == conversation_id, BirdieTurn.status == 'running')
               .values(status='interrupted', error='Stopped by user'))
    db.commit()


def payload(conversation: BirdieConversation) -> dict:
    return {key: getattr(conversation, key) for key in ('id', 'matter_id', 'title', 'archived', 'created_at', 'updated_at')}


def turn_payload(turn: BirdieTurn) -> dict:
    return {key: getattr(turn, key) for key in ('id', 'request_id', 'message', 'answer', 'mode', 'model', 'status', 'error', 'context', 'created_at')}
