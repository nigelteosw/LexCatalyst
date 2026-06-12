from sqlalchemy.orm import Session

from app.models import User
from app.providers.deepseek import DeepSeekProvider
from app.services.knowledge_bank_service import format_kb_context, search_kb_for_chat

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


async def build_birdie_messages(
    db: Session,
    *,
    user: User,
    user_message: str,
    history: list[dict[str, str]],
    matter_id: str | None,
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
):
    messages = await build_birdie_messages(
        db,
        user=user,
        user_message=user_message,
        history=history,
        matter_id=matter_id,
    )
    provider = DeepSeekProvider()
    async for chunk in provider.stream_chat(messages, model="deepseek-v4-flash"):
        yield chunk
