from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ChatMessage, ChatThread
from app.providers.deepseek import DeepSeekProvider

SYSTEM_PROMPT = """You are LexCatalyst, a legal workflow assistant for junior lawyers.
Answer clearly and conservatively. If the question needs document evidence, say what evidence is missing.
Do not invent citations or claim to have read uploaded documents unless the context is provided."""


def make_thread_title(message: str) -> str:
    normalized = " ".join(message.split())
    if len(normalized) <= 80:
        return normalized or "New chat"
    return f"{normalized[:77]}..."


def get_or_create_thread(
    db: Session, thread_id: str | None, first_message: str, user_id: str
) -> ChatThread:
    if thread_id:
        stmt = select(ChatThread).where(ChatThread.id == thread_id, ChatThread.user_id == user_id)
        thread = db.scalar(stmt)
        if thread:
            return thread

    thread = ChatThread(user_id=user_id, title=make_thread_title(first_message))
    db.add(thread)
    db.flush()
    return thread


def add_message(
    db: Session,
    *,
    thread_id: str,
    role: str,
    content: str,
    model: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
) -> ChatMessage:
    message = ChatMessage(
        thread_id=thread_id,
        role=role,
        content=content,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )
    db.add(message)
    db.flush()
    return message


def get_recent_messages(db: Session, thread_id: str, limit: int = 20) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(limit)
    )
    messages = list(db.scalars(stmt))
    return list(reversed(messages))


def build_provider_messages(history: list[ChatMessage], user_message: str) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(
        {"role": message.role, "content": message.content}
        for message in history
        if message.role in {"user", "assistant"}
    )
    messages.append({"role": "user", "content": user_message})
    return messages


async def create_chat_response(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
) -> tuple[ChatThread, ChatMessage]:
    settings = get_settings()
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    history = get_recent_messages(db, thread.id)

    add_message(db, thread_id=thread.id, role="user", content=user_message)
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)

    provider = DeepSeekProvider()
    assistant_content, usage = await provider.chat(build_provider_messages(history, user_message))

    assistant_message = add_message(
        db,
        thread_id=thread.id,
        role="assistant",
        content=assistant_content,
        model=settings.deepseek_model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
    )
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(thread)
    return thread, assistant_message


def create_chat_request(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
) -> tuple[ChatThread, list[dict[str, str]]]:
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    history = get_recent_messages(db, thread.id)

    add_message(db, thread_id=thread.id, role="user", content=user_message)
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)

    return thread, build_provider_messages(history, user_message)


def save_assistant_response(
    db: Session,
    *,
    thread: ChatThread,
    content: str,
) -> ChatMessage:
    settings = get_settings()
    assistant_message = add_message(
        db,
        thread_id=thread.id,
        role="assistant",
        content=content,
        model=settings.deepseek_model,
    )
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(thread)
    return assistant_message


def list_threads(db: Session, user_id: str) -> list[ChatThread]:
    stmt = (
        select(ChatThread)
        .where(ChatThread.user_id == user_id)
        .order_by(desc(ChatThread.updated_at))
    )
    return list(db.scalars(stmt))


def list_thread_messages(db: Session, thread_id: str, user_id: str) -> list[ChatMessage]:
    # Verify the thread belongs to the user
    thread_stmt = select(ChatThread).where(
        ChatThread.id == thread_id, ChatThread.user_id == user_id
    )
    if not db.scalar(thread_stmt):
        return []

    stmt = (
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at)
    )
    return list(db.scalars(stmt))
