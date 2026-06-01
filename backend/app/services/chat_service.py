from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models import ChatMessage, ChatThread
from app.providers.embedding_provider import EmbeddingError
from app.providers.deepseek import DeepSeekProvider, resolve_chat_model
from app.services.memory_service import (
    extract_memory_candidates,
    list_memories,
    save_memory_candidates,
)
from app.services.rag_service import (
    DocumentSearchResult,
    format_document_context,
    search_documents,
)

SYSTEM_PROMPT = """You are LexCatalyst, a legal workflow assistant for junior lawyers.
Answer clearly and conservatively. If the question needs document evidence, say what evidence is missing.
Use the provided document context when it is relevant, and cite it with bracket references like [1].
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


def build_provider_messages(
    history: list[ChatMessage],
    user_message: str,
    memories: list | None = None,
    document_results: list[DocumentSearchResult] | None = None,
) -> list[dict[str, str]]:
    system_content = SYSTEM_PROMPT
    document_context = format_document_context(document_results or [])
    if document_context:
        system_content += (
            "\n\nDocument Context:\n"
            f"{document_context}\n\n"
            "When relying on document context, cite only the bracketed sources above. "
            "If the provided chunks do not answer the question, say what evidence is missing."
        )

    if memories:
        memory_blocks = []
        categories = {"semantic": "Stable facts/preferences", "procedural": "Working style", "episodic": "Past events"}
        for cat, label in categories.items():
            cat_memories = [m.content for m in memories if m.category == cat]
            if cat_memories:
                memory_blocks.append(f"{label}:\n- " + "\n- ".join(cat_memories))
        
        if memory_blocks:
            system_content += "\n\nUser Context (Long-term Memory):\n" + "\n\n".join(memory_blocks)

    messages = [{"role": "system", "content": system_content}]
    messages.extend(
        {"role": message.role, "content": message.content}
        for message in history
        if message.role in {"user", "assistant"}
    )
    messages.append({"role": "user", "content": user_message})
    return messages


async def safe_search_documents(
    db: Session, *, query: str, user_id: str
) -> list[DocumentSearchResult]:
    try:
        return await search_documents(db, query=query, user_id=user_id)
    except EmbeddingError as exc:
        print(f"Document search skipped: {exc}")
        return []


async def create_chat_response(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
    model: str | None = None,
) -> tuple[ChatThread, ChatMessage]:
    selected_model = resolve_chat_model(model)
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id)
    document_results = await safe_search_documents(db, query=user_message, user_id=user_id)

    add_message(db, thread_id=thread.id, role="user", content=user_message)
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)

    provider = DeepSeekProvider()
    assistant_content, usage = await provider.chat(
        build_provider_messages(
            history,
            user_message,
            memories=memories,
            document_results=document_results,
        ),
        model=selected_model,
    )

    assistant_message = add_message(
        db,
        thread_id=thread.id,
        role="assistant",
        content=assistant_content,
        model=selected_model,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        total_tokens=usage["total_tokens"],
    )
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(thread)

    # Extract memories
    candidates = await extract_memory_candidates(user_message, assistant_content)
    save_memory_candidates(db, user_id, thread.id, assistant_message.id, candidates)

    return thread, assistant_message


async def create_chat_request(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
    model: str | None = None,
) -> tuple[ChatThread, list[dict[str, str]], str]:
    selected_model = resolve_chat_model(model)
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id)
    document_results = await safe_search_documents(db, query=user_message, user_id=user_id)

    add_message(db, thread_id=thread.id, role="user", content=user_message)
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)

    return (
        thread,
        build_provider_messages(
            history,
            user_message,
            memories=memories,
            document_results=document_results,
        ),
        selected_model,
    )


async def save_assistant_response(
    db: Session,
    *,
    user_id: str,
    thread: ChatThread,
    content: str,
    user_message: str | None = None,
    model: str | None = None,
) -> ChatMessage:
    selected_model = resolve_chat_model(model)
    assistant_message = add_message(
        db,
        thread_id=thread.id,
        role="assistant",
        content=content,
        model=selected_model,
    )
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(thread)

    if user_message:
        candidates = await extract_memory_candidates(user_message, content)
        save_memory_candidates(db, user_id, thread.id, assistant_message.id, candidates)

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
