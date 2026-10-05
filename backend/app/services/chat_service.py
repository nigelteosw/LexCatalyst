import asyncio
from datetime import UTC, datetime

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import ChatMessage, ChatThread
from app.providers.embedding_provider import EmbeddingError
from app.services.llm_service import get_llm, resolve_model
from app.services.memory_service import (
    extract_memory_candidates,
    format_memory_context,
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

_MAX_MEMORIES_IN_PROMPT = 10

# Summarise older messages once the thread exceeds this count, keeping the most recent window verbatim.
_RECENT_LIMIT = 20
_SUMMARISE_THRESHOLD = _RECENT_LIMIT  # start summarising once we exceed the recent window
# Only re-generate the summary when this many new messages have been archived since the last run.
_RESUMMARY_THRESHOLD = 5


def needs_resummary(archived: int, summarised_up_to: int) -> bool:
    """True when enough messages have been archived since the last summary to redo it."""
    return archived - summarised_up_to >= _RESUMMARY_THRESHOLD


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
    tool_steps: list | None = None,
    sources: list | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
) -> ChatMessage:
    fields: dict = dict(
        thread_id=thread_id,
        role=role,
        content=content,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
    )
    if tool_steps is not None:
        fields["tool_steps"] = tool_steps
    if sources:
        fields["sources"] = sources
    message = ChatMessage(**fields)
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


async def _generate_summary(db: Session, user_id: str, older_messages: list[ChatMessage]) -> str | None:
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

    try:
        provider = get_llm(db, user_id, feature="thread_summary")
        summary, _ = await provider.chat(prompt_messages)
        return summary
    except Exception as exc:
        print(f"Thread summarisation skipped: {exc}")
        return None


async def _maybe_refresh_summary(db: Session, thread: ChatThread, user_id: str) -> None:
    """Regenerate the summary whenever the archived history grows."""
    total = _count_messages(db, thread.id)
    archived = total - _RECENT_LIMIT
    if archived <= 0:
        return

    if not needs_resummary(archived, thread.summary_up_to or 0):
        return

    all_messages = _get_all_messages(db, thread.id)
    older = all_messages[:-_RECENT_LIMIT]
    summary = await _generate_summary(db, user_id, older)
    if summary:
        thread.summary = summary
        thread.summary_up_to = archived
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

    system_content += format_memory_context(memories)

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
    tier: str | None = None,
) -> tuple[ChatThread, ChatMessage]:
    # Resolve the key first so a missing key fails before anything is saved.
    provider = get_llm(db, user_id, feature="lexchat", tier=tier, model=model)
    selected_model = provider.model
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    if matter_id is not None:
        thread.matter_id = matter_id
    active_matter_id = matter_id if matter_id is not None else thread.matter_id
    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id, limit=_MAX_MEMORIES_IN_PROMPT)
    wiki_pages = safe_search_wiki_pages(db, user_id=user_id, query=user_message)
    kb_entries, document_results = await asyncio.gather(
        search_kb_for_chat(db, user_id=user_id, query=user_message, matter_id=active_matter_id),
        safe_search_documents(db, query=user_message, user_id=user_id, matter_id=active_matter_id),
    )

    add_message(db, thread_id=thread.id, role="user", content=user_message)
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)

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

    candidates = await extract_memory_candidates(db, user_id, user_message, assistant_content)
    save_memory_candidates(db, user_id, thread.id, assistant_message.id, candidates)

    await _maybe_refresh_summary(db, thread, user_id)

    return thread, assistant_message


async def create_chat_request(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
    matter_id: str | None = None,
    model: str | None = None,
    tier: str | None = None,
) -> tuple[ChatThread, list[dict[str, str]], str]:
    selected_model = resolve_model(db, user_id, feature="lexchat", tier=tier, model=model)
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    if matter_id is not None:
        thread.matter_id = matter_id
    active_matter_id = matter_id if matter_id is not None else thread.matter_id
    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id, limit=_MAX_MEMORIES_IN_PROMPT)
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


AGENT_SYSTEM_PROMPT = """You are LexCatalyst, a legal workflow assistant for junior lawyers.
Use your tools to search for relevant documents, knowledge bank entries, and memories before answering.
Answer clearly and conservatively.
Every document passage and knowledge bank entry returned by a tool is numbered like [1], [2]. When a statement relies on a source, cite it by putting its number in square brackets right after the statement, for example "caps are set at twelve months of fees [2]". Use only numbers that appeared in tool results, and never invent one.
Do not write a Sources or References section; the application lists the sources for you.
Do not invent citations or claim to have read documents unless you have searched for them with a tool."""


async def prepare_agent_context(
    db: Session,
    *,
    user_message: str,
    user_id: str,
    thread_id: str | None = None,
    model: str | None = None,
    tier: str | None = None,
    matter_id: str | None = None,
) -> tuple[ChatThread, list[dict], str]:
    """Build initial messages for the ReAct agent loop.

    Memories are pre-loaded (always relevant, cheap). Documents and KB are
    left for the agent to search via tools.
    """
    selected_model = resolve_model(db, user_id, feature="lexchat", tier=tier, model=model)
    get_llm(db, user_id, feature="lexchat", tier=tier, model=model)  # fail fast without a key
    thread = get_or_create_thread(db, thread_id, user_message, user_id)
    if matter_id is not None:
        thread.matter_id = matter_id
    active_matter_id = matter_id if matter_id is not None else thread.matter_id

    history = get_recent_messages(db, thread.id)
    memories = list_memories(db, user_id=user_id, limit=_MAX_MEMORIES_IN_PROMPT)

    add_message(db, thread_id=thread.id, role="user", content=user_message)
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)

    system_content = AGENT_SYSTEM_PROMPT

    if thread.summary:
        system_content += (
            "\n\nEarlier Conversation Summary:\n"
            f"{thread.summary}\n\n"
            "The summary above covers older parts of this conversation not shown in the message history below."
        )

    system_content += format_memory_context(memories)

    if active_matter_id:
        system_content += f"\n\nActive matter ID: {active_matter_id}. Prefer sources scoped to this matter."

    messages: list[dict] = [{"role": "system", "content": system_content}]
    messages.extend(
        {"role": m.role, "content": m.content}
        for m in history
        if m.role in {"user", "assistant"}
    )
    messages.append({"role": "user", "content": user_message})

    return thread, messages, selected_model


async def persist_assistant_message(
    db: Session,
    *,
    thread: ChatThread,
    content: str,
    model: str | None = None,
    tool_steps: list | None = None,
    sources: list | None = None,
) -> ChatMessage:
    """Save the assistant message to DB only — no memory extraction or summarization."""
    # `model` is the already-resolved model id from the agent loop.
    assistant_message = add_message(
        db,
        thread_id=thread.id,
        role="assistant",
        content=content,
        model=model,
        tool_steps=tool_steps or None,
        sources=sources or None,
    )
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(thread)
    return assistant_message


async def run_post_save_tasks(
    db: Session,
    *,
    user_id: str,
    thread: ChatThread,
    assistant_message: ChatMessage,
    user_message: str | None = None,
) -> None:
    """Run memory extraction and summarization after the response has been sent to the client."""
    if user_message:
        candidates = await extract_memory_candidates(db, user_id, user_message, assistant_message.content)
        save_memory_candidates(db, user_id, thread.id, assistant_message.id, candidates)
    await _maybe_refresh_summary(db, thread, user_id)


async def save_assistant_response(
    db: Session,
    *,
    user_id: str,
    thread: ChatThread,
    content: str,
    user_message: str | None = None,
    model: str | None = None,
    tool_steps: list | None = None,
) -> ChatMessage:
    assistant_message = await persist_assistant_message(
        db, thread=thread, content=content, model=model, tool_steps=tool_steps,
    )
    await run_post_save_tasks(
        db, user_id=user_id, thread=thread,
        assistant_message=assistant_message, user_message=user_message,
    )
    return assistant_message


GENERAL = "general"


def list_threads(
    db: Session,
    user_id: str,
    *,
    matter_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ChatThread]:
    """matter_filter: None = all threads, GENERAL = no matter, else a matter id."""
    stmt = select(ChatThread).where(ChatThread.user_id == user_id)
    if matter_filter == GENERAL:
        stmt = stmt.where(ChatThread.matter_id.is_(None))
    elif matter_filter:
        stmt = stmt.where(ChatThread.matter_id == matter_filter)
    stmt = stmt.order_by(desc(ChatThread.updated_at)).offset(offset).limit(limit)
    return list(db.scalars(stmt))


def list_thread_messages(
    db: Session,
    thread_id: str,
    user_id: str,
    *,
    limit: int = 200,
    before_message_id: str | None = None,
) -> list[ChatMessage]:
    """Return up to ``limit`` messages from a thread, oldest-first.

    Defaults to the most recent ``limit`` messages (oldest within the page first).
    Pass ``before_message_id`` to walk backwards: only messages strictly older
    than that message are returned.
    """
    thread_stmt = select(ChatThread).where(
        ChatThread.id == thread_id, ChatThread.user_id == user_id
    )
    if not db.scalar(thread_stmt):
        return []

    stmt = select(ChatMessage).where(ChatMessage.thread_id == thread_id)
    if before_message_id:
        cursor = db.scalar(
            select(ChatMessage.created_at).where(
                ChatMessage.id == before_message_id,
                ChatMessage.thread_id == thread_id,
            )
        )
        if cursor is None:
            return []
        stmt = stmt.where(ChatMessage.created_at < cursor)

    stmt = stmt.order_by(desc(ChatMessage.created_at)).limit(limit)
    rows = list(db.scalars(stmt))
    rows.reverse()
    return rows


def update_thread(
    db: Session,
    *,
    user_id: str,
    thread_id: str,
    title: str | None,
    matter_id: str | None,
    set_matter: bool,
) -> ChatThread | None:
    thread = db.scalar(
        select(ChatThread).where(
            ChatThread.id == thread_id, ChatThread.user_id == user_id,
        )
    )
    if not thread:
        return None
    if title is not None:
        thread.title = title.strip() or thread.title
    if set_matter:
        thread.matter_id = matter_id
    thread.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(thread)
    return thread


def delete_thread(db: Session, *, user_id: str, thread_id: str) -> bool:
    thread = db.scalar(
        select(ChatThread).where(
            ChatThread.id == thread_id, ChatThread.user_id == user_id,
        )
    )
    if not thread:
        return False
    db.delete(thread)  # cascade=all,delete-orphan removes messages + memory FKs
    db.commit()
    return True


def delete_message(db: Session, *, user_id: str, message_id: str) -> bool:
    """Delete a single chat message belonging to the given user.

    The agent loop reads thread history at the start of every turn, so
    removing a middle message will simply omit it from future context.
    Callers should be aware that this can make the conversation look
    incoherent on re-read.
    """
    message = db.scalar(
        select(ChatMessage)
        .join(ChatThread, ChatThread.id == ChatMessage.thread_id)
        .where(ChatMessage.id == message_id, ChatThread.user_id == user_id)
    )
    if not message:
        return False
    db.delete(message)
    db.commit()
    return True
