import json
from sqlalchemy import select, desc
from sqlalchemy.orm import Session
from app.models import Memory
from app.schemas import MemoryCreate, MemoryUpdate, MemoryExtractionResult, MemoryExtractionCandidate
from app.providers.deepseek import DeepSeekProvider

EXTRACTION_PROMPT = """You are a memory extraction assistant. Your task is to extract stable facts, user preferences, and important session notes from a conversation turn between a user and a legal assistant.

Extract memories into three categories:
1. semantic: stable facts about the user, their law firm, matter details, or personal context.
2. procedural: how the user wants the assistant or workflow to behave (e.g., "be concise", "flag risks briefly").
3. episodic: important events or actions that happened in this session (e.g., "user uploaded a contract", "user made a specific decision").

Rules:
- Capture stable, long-term info, not transient chat filler.
- Do not store guesses or unconfirmed claims.
- Assign a confidence score between 0.0 and 1.0.
- Only include memories with high confidence (>= 0.8).
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
