from datetime import UTC, datetime

from sqlalchemy import desc, func, select
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
from app.services.knowledge_bank_service import format_kb_context, search_kb_for_chat
from app.services.wiki_service import format_wiki_context, search_wiki_pages

SYSTEM_PROMPT = """You are LexCatalyst, a legal workflow assistant for junior lawyers.
Answer clearly and conservatively. If the question needs document evidence, say what evidence is missing.
Use the provided document context when it is relevant.
Do not invent citations or claim to have read uploaded documents unless the context is provided."""

# Summarise older messages once the thread exceeds this count, keeping the most recent window verbatim.
_RECENT_LIMIT = 20
_SUMMARISE_THRESHOLD = _RECENT_LIMIT  # start summarising once we exceed the recent window


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


def get_recent_messages(db: Session, thread_id: str, limit: int = _RECENT_LIMIT) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(desc(ChatMessage.created_at))
        .limit(limit)
    )
    messages = list(db.scalars(stmt))
    return list(reversed(messages))


def _get_all_messages(db: Session, thread_id: str) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at)
    )
    return list(db.scalars(stmt))


def _count_messages(db: Session, thread_id: str) -> int:
    stmt = select(func.count()).where(ChatMessage.thread_id == thread_id)
    return db.scalar(stmt) or 0


async def _generate_summary(older_messages: list[ChatMessage]) -> str | None:
    """Ask the LLM to summarise a list of messages that fall outside the recent window."""
    if not older_messages:
        return None

    lines = []
    for m in older_messages:
        if m.role not in ("user", "assistant"):
            continue
        label = "User" if m.role == "user" else "Assistant"
        lines.append(f"{label}: {m.content}")

    if not lines:
        return None

    prompt_messages = [
        {
            "role": "system",
            "content": (
                "You summarise legal conversation history for a legal AI assistant. "
                "Produce 2-3 concise paragraphs covering key facts, decisions, and context "
                "that would help the assistant understand the ongoing matter. "
                "Be factual and concise."
            ),
        },
        {"role": "user", "content": "Conversation history to summarise:\n\n" + "\n".join(lines)},
    ]

    provider = DeepSeekProvider()
    try:
        summary, _ = await provider.chat(prompt_messages, model="deepseek-v4-flash")
        return summary
    except Exception as exc:
        print(f"Thread summarisation skipped: {exc}")
        return None


async def _maybe_refresh_summary(db: Session, thread: ChatThread) -> None:
    """Regenerate and persist the thread summary when the history exceeds the recent window."""
    total = _count_messages(db, thread.id)
    if total <= _SUMMARISE_THRESHOLD:
        return

    all_messages = _get_all_messages(db, thread.id)
    older = all_messages[:-_RECENT_LIMIT]
    summary = await _generate_summary(older)
    if summary:
        thread.summary = summary
        db.commit()


def build_provider_messages(
    history: list[ChatMessage],
    user_message: str,
    memories: list | None = None,
    document_results: list[DocumentSearchResult] | None = None,
    wiki_pages: list | None = None,
    kb_entries: list | None = None,
    thread_summary: str | None = None,
) -> list[dict[str, str]]:
    system_content = SYSTEM_PROMPT

    if thread_summary:
        system_content += (
            "\n\nEarlier Conversation Summary:\n"
            f"{thread_summary}\n\n"
            "The summary above covers the portion of the conversation not shown in the recent "
            "message history below. Use it to maintain context across a long session."
        )

    wiki_context = format_wiki_context(wiki_pages or [])
    if wiki_context:
        system_content += (
            "\n\nLex-Wiki Context:\n"
            f"{wiki_context}\n\n"
            "Use Lex-Wiki pages as synthesized matter context. "
            "When Lex-Wiki context and source document chunks disagree, rely on source chunks."
        )

    kb_context = format_kb_context(kb_entries or [])
    if kb_context:
        system_content += (
            "\n\nKnowledge Bank Context:\n"
            f"{kb_context}\n\n"
            "Use applicable firm, team, and matter knowledge when relevant. "
            "Treat style_guide and partner_pref entries as drafting instructions. "
            "Flag meaningful deviations from them instead of silently changing quoted source text."
        )

    document_context = format_document_context(document_results or [])
    if document_context:
        system_content += (
            "\n\nDocument Context:\n"
            f"{document_context}\n\n"
            "When your answer draws on the document context above, end your response with a "
            "**Sources** section listing only the citation labels of the chunks you actually used — "
            "one per line, no bracket numbers. "
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
    db: Session, *, query: str, user_id: str, matter_id: str | None = None
) -> list[DocumentSearchResult]:
    try:
        return await search_documents(
            db,
            query=query,
            user_id=user_id,
            matter_id=matter_id,
        )
    except EmbeddingError as exc:
        print(f"Document search skipped: {exc}")
        return []


def safe_search_wiki_pages(db: Session, *, user_id: str, query: str) -> list:
    try:
        return search_wiki_pages(db, user_id=user_id, query=query)
    except Exception as exc:
        print(f"Wiki search skipped: {exc}")
        return []


async def create_chat_response(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
    matter_id: str | None = None,
    model: str | None = None,
) -> tuple[ChatThread, ChatMessage]:
    selected_model = resolve_chat_model(model)
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    if matter_id is not None:
        thread.matter_id = matter_id
    active_matter_id = matter_id if matter_id is not None else thread.matter_id
    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id)
    wiki_pages = safe_search_wiki_pages(db, user_id=user_id, query=user_message)
    kb_entries, document_results = await asyncio.gather(
        search_kb_for_chat(db, user_id=user_id, query=user_message, matter_id=active_matter_id),
        safe_search_documents(db, query=user_message, user_id=user_id, matter_id=active_matter_id),
    )

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
            wiki_pages=wiki_pages,
            kb_entries=kb_entries,
            thread_summary=thread.summary,
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

    candidates = await extract_memory_candidates(user_message, assistant_content)
    save_memory_candidates(db, user_id, thread.id, assistant_message.id, candidates)

    await _maybe_refresh_summary(db, thread)

    return thread, assistant_message


async def create_chat_request(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
    matter_id: str | None = None,
    model: str | None = None,
) -> tuple[ChatThread, list[dict[str, str]], str]:
    selected_model = resolve_chat_model(model)
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    if matter_id is not None:
        thread.matter_id = matter_id
    active_matter_id = matter_id if matter_id is not None else thread.matter_id
    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id)
    wiki_pages = safe_search_wiki_pages(db, user_id=user_id, query=user_message)
    kb_entries, document_results = await asyncio.gather(
        search_kb_for_chat(db, user_id=user_id, query=user_message, matter_id=active_matter_id),
        safe_search_documents(db, query=user_message, user_id=user_id, matter_id=active_matter_id),
    )

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
            wiki_pages=wiki_pages,
            kb_entries=kb_entries,
            thread_summary=thread.summary,
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

    await _maybe_refresh_summary(db, thread)

    return assistant_message


def list_threads(db: Session, user_id: str) -> list[ChatThread]:
    stmt = (
        select(ChatThread)
        .where(ChatThread.user_id == user_id)
        .order_by(desc(ChatThread.updated_at))
    )
    return list(db.scalars(stmt))


def list_thread_messages(db: Session, thread_id: str, user_id: str) -> list[ChatMessage]:
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
