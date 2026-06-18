from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import ActionItem, User
from app.providers.deepseek import DeepSeekProvider
from app.schemas import PageContext
from app.services.knowledge_bank_service import format_kb_context, search_kb_for_chat
from app.services.memory_service import format_memory_context, list_memories

BIRDIE_SYSTEM_PROMPT = """You are Birdie, a personal mentor embedded in LexCatalyst for junior lawyers.

Your role covers two things equally:
1. Legal hard skills — clause drafting, risk flags, firm style, partner preferences, legal reasoning
2. Soft skills & wellbeing — workload management, giving/receiving feedback, psychological safety, raising concerns

Rules:
- Be brief. 3–5 sentences unless asked to go deeper. No preamble, no padding.
- Be specific. Cite firm knowledge when it's relevant. Say "based on your firm's style guide" or "your KB says".
- Be direct. Give the actual answer, not a framing of the answer.
- Be a mentor, not a search engine. If the question has a human element (workload, relationships, fear), address it as a person would.
- Never lecture. One point at a time.

If firm knowledge is provided in the context below, use it. If not, draw on general best practice and flag it as such."""

_VIEW_LABELS = {
    "home": "the Home page",
    "chat": "the Chat page",
    "documents": "the Documents page",
    "wiki": "the Lex-Wiki",
    "knowledge_bank": "the Knowledge Bank",
    "actions": "the Workboard",
    "memories": "the Memories page",
    "wellbeing": "the Wellbeing page",
    "settings": "the Settings page",
}


def _format_workboard_context(db: Session, user: User) -> str:
    items = db.scalars(
        select(ActionItem)
        .where(
            or_(ActionItem.assignee_id == user.id, ActionItem.assigner_id == user.id),
            ActionItem.status != "done",
        )
        .order_by(ActionItem.updated_at.desc())
        .limit(10)
    ).all()
    if not items:
        return ""
    lines = []
    for item in items:
        suffix = " (submitted for review)" if item.active_handoff_id and item.status == "review" else ""
        lines.append(f"- {item.title} · {item.status} · {item.priority}{suffix}")
    return "\n\nWorkboard (user's active tickets):\n" + "\n".join(lines)


def _format_page_context(ctx: PageContext | None) -> str:
    if not ctx or not ctx.view:
        return ""
    location = _VIEW_LABELS.get(ctx.view, f"the {ctx.view} page")
    detail = (
        (ctx.thread_title and f', in thread "{ctx.thread_title}"')
        or (ctx.document_name and f', reading "{ctx.document_name}"')
        or (ctx.wiki_page_title and f', reading the "{ctx.wiki_page_title}" page')
        or (ctx.kb_entry_title and f', viewing KB entry "{ctx.kb_entry_title}"')
        or (ctx.action_title and f', reviewing action "{ctx.action_title}"')
        or ""
    )
    return f"\n\nCurrent context (what the user is working on right now):\nThe user is on {location}{detail}."


async def build_birdie_messages(
    db: Session,
    *,
    user: User,
    user_message: str,
    history: list[dict[str, str]],
    matter_id: str | None,
    page_context: PageContext | None = None,
) -> list[dict[str, str]]:
    kb_entries = await search_kb_for_chat(
        db,
        user_id=user.id,
        query=user_message,
        matter_id=matter_id,
        limit=4,
    )
    kb_context = format_kb_context(kb_entries)

    system_content = BIRDIE_SYSTEM_PROMPT

    memories = list_memories(db, user_id=user.id, limit=50)
    system_content += format_memory_context(memories)
    system_content += _format_workboard_context(db, user)
    system_content += _format_page_context(page_context)

    if kb_context:
        system_content += f"\n\n---\nFirm knowledge relevant to this question:\n{kb_context}"

    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    return messages


async def stream_birdie_response(
    db: Session,
    *,
    user: User,
    user_message: str,
    history: list[dict[str, str]],
    matter_id: str | None,
    page_context: PageContext | None = None,
):
    messages = await build_birdie_messages(
        db,
        user=user,
        user_message=user_message,
        history=history,
        matter_id=matter_id,
        page_context=page_context,
    )
    provider = DeepSeekProvider()
    async for chunk in provider.stream_chat(messages, model="deepseek-v4-flash"):
        yield chunk
