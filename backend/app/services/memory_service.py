import json
from sqlalchemy import select, desc
from sqlalchemy.orm import Session
from app.models import Memory
from app.schemas import MemoryCreate, MemoryUpdate, MemoryExtractionResult, MemoryExtractionCandidate
from app.providers.deepseek import DeepSeekProvider

EXTRACTION_PROMPT = """You are a memory extraction assistant. Extract patterns about who the user is and how they work from a conversation between a user and a legal assistant.

Extract memories into three categories:
1. semantic: the user's role, expertise, or domain focus (e.g., "user is a litigator specialising in IP", "user is a senior associate at a mid-size firm"). NOT client names, matter details, case facts, or firm names.
2. procedural: how the user wants the assistant to behave or how they prefer to work (e.g., "user wants risks flagged upfront", "user prefers plain-language summaries", "user always asks for jurisdiction analysis").
3. episodic: decisions or patterns the user showed this session that reveal working style (e.g., "user consistently prioritises commercial risk over legal technicalities"). NOT one-off events or session-specific actions.

Rules:
- Capture patterns and preferences, not facts about specific cases, clients, or matters.
- Never store names of clients, opposing parties, firms, or case-specific details — these are sensitive and transient.
- Do not store guesses or unconfirmed claims.
- Assign a confidence score between 0.0 and 1.0.
- Only include memories with high confidence (>= 0.8).
- If nothing pattern-worthy is in the conversation, return an empty memories list.
- Return ONLY a valid JSON object matching this schema:
{{"memories": [{{"category": "...", "content": "...", "confidence": 0.95}}]}}

Conversation Turn:
User: {user_message}
Assistant: {assistant_message}
"""


def create_memory(db: Session, user_id: str, schema: MemoryCreate, confidence: float = 1.0) -> Memory:
    memory = Memory(
        user_id=user_id,
        category=schema.category,
        content=schema.content,
        source_thread_id=schema.source_thread_id,
        source_message_id=schema.source_message_id,
        confidence=confidence,
    )
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return memory


_MEMORY_CATEGORIES = {
    "semantic": "Stable facts/preferences",
    "procedural": "Working style",
    "episodic": "Past events",
}


def format_memory_context(memories: list[Memory]) -> str:
    if not memories:
        return ""
    blocks = []
    for cat, label in _MEMORY_CATEGORIES.items():
        items = [m.content for m in memories if m.category == cat]
        if items:
            blocks.append(f"{label}:\n- " + "\n- ".join(items))
    if not blocks:
        return ""
    return "\n\nUser Context (Long-term Memory):\n" + "\n\n".join(blocks)


def list_memories(db: Session, user_id: str, category: str | None = None, limit: int | None = None) -> list[Memory]:
    stmt = select(Memory).where(Memory.user_id == user_id)
    if category:
        stmt = stmt.where(Memory.category == category)
    stmt = stmt.order_by(desc(Memory.updated_at))
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt))


def get_memory(db: Session, user_id: str, memory_id: str) -> Memory | None:
    stmt = select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    return db.scalar(stmt)


def update_memory(db: Session, user_id: str, memory_id: str, schema: MemoryUpdate) -> Memory | None:
    memory = get_memory(db, user_id, memory_id)
    if not memory:
        return None
    
    if schema.category is not None:
        memory.category = schema.category
    if schema.content is not None:
        memory.content = schema.content
    if schema.category is not None or schema.content is not None:
        memory.justification = None
    
    db.commit()
    db.refresh(memory)
    return memory


def delete_memory(db: Session, user_id: str, memory_id: str) -> bool:
    memory = get_memory(db, user_id, memory_id)
    if not memory:
        return False
    
    db.delete(memory)
    db.commit()
    return True


async def extract_memory_candidates(user_message: str, assistant_message: str) -> list[MemoryExtractionCandidate]:
    provider = DeepSeekProvider()
    prompt = EXTRACTION_PROMPT.format(user_message=user_message, assistant_message=assistant_message)
    
    try:
        content, _ = await provider.chat([{"role": "user", "content": prompt}])
        # Strip potential markdown code blocks if the LLM includes them
        cleaned_content = content.strip()
        if cleaned_content.startswith("```json"):
            cleaned_content = cleaned_content[7:-3].strip()
        elif cleaned_content.startswith("```"):
            cleaned_content = cleaned_content[3:-3].strip()
            
        data = json.loads(cleaned_content)
        result = MemoryExtractionResult.model_validate(data)
        return [m for m in result.memories if m.confidence >= 0.8]
    except Exception as e:
        print(f"Memory extraction failed: {e}")
        return []


def save_memory_candidates(
    db: Session,
    user_id: str,
    thread_id: str,
    message_id: str,
    candidates: list[MemoryExtractionCandidate],
) -> list[Memory]:
    if not candidates:
        return []

    existing = {
        m.content.strip().lower()
        for m in db.scalars(select(Memory).where(Memory.user_id == user_id))
    }

    saved = []
    for candidate in candidates:
        normalised = candidate.content.strip().lower()
        if normalised in existing:
            continue
        memory = Memory(
            user_id=user_id,
            category=candidate.category,
            content=candidate.content,
            source_thread_id=thread_id,
            source_message_id=message_id,
            confidence=candidate.confidence,
        )
        db.add(memory)
        existing.add(normalised)
        saved.append(memory)

    if saved:
        db.commit()
        for s in saved:
            db.refresh(s)
    return saved
