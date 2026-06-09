import asyncio
import json
import re
from datetime import UTC, datetime

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Document,
    KnowledgeBankAccessLog,
    KnowledgeBankEntry,
    Matter,
    PiiRedaction,
    User,
    WikiPage,
)
from app.providers.deepseek import DeepSeekProvider
from app.providers.embedding_provider import EmbeddingError, embed_texts
from app.schemas import (
    KnowledgeBankEntryCreate,
    KnowledgeBankEntryUpdate,
    RedactionApprovalRequest,
)


class KnowledgeBankError(Exception):
    pass


async def _embed_entry(entry: KnowledgeBankEntry) -> None:
    text = f"{entry.title}\n\n{entry.body_markdown}".strip()
    try:
        entry.embedding = (await embed_texts([text]))[0]
    except EmbeddingError as exc:
        print(f"KB entry embedding skipped: {exc}")


def log_kb_access(
    db: Session,
    *,
    user_id: str,
    action: str,
    entry_id: str | None = None,
    matter_id: str | None = None,
    thread_id: str | None = None,
    ip_address: str | None = None,
    commit: bool = True,
) -> KnowledgeBankAccessLog:
    log = KnowledgeBankAccessLog(
        kb_entry_id=entry_id,
        user_id=user_id,
        action=action,
        context_matter_id=matter_id,
        context_thread_id=thread_id,
        ip_address=ip_address,
    )
    db.add(log)
    if commit:
        db.commit()
        db.refresh(log)
    return log


def _entry_query():
    return select(KnowledgeBankEntry).options(
        joinedload(KnowledgeBankEntry.team),
        joinedload(KnowledgeBankEntry.matter).joinedload(Matter.team),
    )


def build_kb_graph(db: Session) -> dict[str, list[dict[str, str | None]]]:
    entries = list(db.scalars(select(KnowledgeBankEntry).order_by(desc(KnowledgeBankEntry.updated_at))))
    entry_ids = {entry.id for entry in entries}
    nodes = [
        {
            "id": entry.id,
            "label": entry.title,
            "type": entry.entry_type,
            "status": entry.scope,
        }
        for entry in entries
    ]
    edges: list[dict[str, str | None]] = []
    for entry in entries:
        if entry.source_entry_id and entry.source_entry_id in entry_ids:
            edges.append(
                {
                    "id": f"{entry.source_entry_id}-{entry.id}",
                    "source": entry.source_entry_id,
                    "target": entry.id,
                    "label": "derived",
                    "type": "derived",
                }
            )
    return {"nodes": nodes, "edges": edges}


def list_kb_entries(
    db: Session,
    *,
    scope: str | None = None,
    entry_type: str | None = None,
    matter_id: str | None = None,
    team_id: str | None = None,
    pii_status: str | None = None,
    query: str | None = None,
) -> list[KnowledgeBankEntry]:
    stmt = _entry_query()
    if scope:
        stmt = stmt.where(KnowledgeBankEntry.scope == scope)
    if entry_type:
        stmt = stmt.where(KnowledgeBankEntry.entry_type == entry_type)
    if matter_id:
        stmt = stmt.where(KnowledgeBankEntry.matter_id == matter_id)
    if team_id:
        stmt = stmt.where(KnowledgeBankEntry.team_id == team_id)
    if pii_status:
        stmt = stmt.where(KnowledgeBankEntry.pii_status == pii_status)
    if query and query.strip():
        pattern = f"%{query.strip()}%"
        stmt = stmt.where(
            or_(
                KnowledgeBankEntry.title.ilike(pattern),
                KnowledgeBankEntry.body_markdown.ilike(pattern),
            )
        )
    return list(db.scalars(stmt.order_by(desc(KnowledgeBankEntry.updated_at))))


def get_kb_entry(db: Session, entry_id: str) -> KnowledgeBankEntry | None:
    return db.scalar(_entry_query().where(KnowledgeBankEntry.id == entry_id))


async def create_kb_entry(
    db: Session,
    *,
    user: User,
    schema: KnowledgeBankEntryCreate,
) -> KnowledgeBankEntry:
    matter = db.get(Matter, schema.matter_id) if schema.matter_id else None
    team_id = schema.team_id or (matter.team_id if matter else user.default_team_id)
    entry = KnowledgeBankEntry(
        team_id=team_id,
        matter_id=schema.matter_id,
        scope=schema.scope,
        entry_type=schema.entry_type,
        title=schema.title,
        body_markdown=schema.body_markdown,
        tags=schema.tags,
        pii_status=schema.pii_status,
        created_by=user.id,
        created_by_role=user.firm_role,
    )
    db.add(entry)
    db.flush()
    await _embed_entry(entry)
    log_kb_access(
        db,
        user_id=user.id,
        action="write",
        entry_id=entry.id,
        matter_id=entry.matter_id,
        commit=False,
    )
    db.commit()
    return get_kb_entry(db, entry.id) or entry


async def add_document_to_kb(
    db: Session,
    *,
    user: User,
    page: WikiPage,
) -> KnowledgeBankEntry:
    document = db.scalar(
        select(Document).where(
            Document.id == page.source_document_id,
            Document.user_id == user.id,
        )
    )
    if not document:
        raise KnowledgeBankError("Source document not found")

    existing = db.scalar(
        select(KnowledgeBankEntry).where(
            or_(
                KnowledgeBankEntry.id == page.id,
                KnowledgeBankEntry.source_document_id == document.id,
            ),
            KnowledgeBankEntry.created_by == user.id,
        )
    )
    if existing:
        return get_kb_entry(db, existing.id) or existing

    entry = KnowledgeBankEntry(
        id=page.id,
        team_id=document.team_id or user.default_team_id,
        matter_id=document.matter_id,
        source_document_id=document.id,
        scope="matter" if document.matter_id else "private",
        entry_type="matter_note",
        title=page.title,
        body_markdown=page.body_markdown,
        tags=["source summary"],
        pii_status="flagged",
        created_by=user.id,
        created_by_role=user.firm_role,
        version=page.version,
        created_at=page.created_at,
        updated_at=page.updated_at,
    )
    db.add(entry)
    db.flush()
    await _embed_entry(entry)
    log_kb_access(
        db,
        user_id=user.id,
        action="write",
        entry_id=entry.id,
        matter_id=entry.matter_id,
        commit=False,
    )
    db.commit()
    return get_kb_entry(db, entry.id) or entry


async def update_kb_entry(
    db: Session,
    *,
    user: User,
    entry_id: str,
    schema: KnowledgeBankEntryUpdate,
) -> KnowledgeBankEntry | None:
    entry = db.get(KnowledgeBankEntry, entry_id)
    if not entry:
        return None
    for field, value in schema.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    entry.version += 1
    await _embed_entry(entry)
    log_kb_access(
        db,
        user_id=user.id,
        action="write",
        entry_id=entry.id,
        matter_id=entry.matter_id,
        commit=False,
    )
    db.commit()
    return get_kb_entry(db, entry.id)


def delete_kb_entry(db: Session, *, user: User, entry_id: str) -> bool:
    entry = db.get(KnowledgeBankEntry, entry_id)
    if not entry:
        return False
    log_kb_access(
        db,
        user_id=user.id,
        action="write",
        entry_id=entry.id,
        matter_id=entry.matter_id,
        commit=False,
    )
    db.delete(entry)
    db.commit()
    return True


async def _propose_redactions(content: str) -> tuple[dict[str, str], str]:
    prompt = """You identify confidential details in legal work product before it is reused.
Return only valid JSON with:
{"redactions": [{"label": "company_name", "original": "Acme Ltd", "replacement": "[Client]"}]}

Identify company and party names, individual names, matter or case numbers, financial figures,
transaction-specific dates, addresses, email addresses, and phone numbers. Do not redact ordinary
legal language. Content:

""" + content

    try:
        provider = DeepSeekProvider()
        response, _ = await provider.chat(
            [
                {
                    "role": "system",
                    "content": "Return a concise JSON redaction proposal for lawyer review.",
                },
                {"role": "user", "content": prompt},
            ],
            model="deepseek-v4-flash",
        )
        cleaned = response.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:-3].strip()
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:-3].strip()
        payload = json.loads(cleaned)
        redactions = payload.get("redactions", [])
    except Exception as exc:
        print(f"KB PII scan fallback used: {exc}")
        redactions = []

    if not redactions:
        redactions = _fallback_redactions(content)

    fields: dict[str, str] = {}
    redacted = content
    for index, item in enumerate(redactions):
        original = str(item.get("original", "")).strip()
        replacement = str(item.get("replacement", "")).strip()
        label = str(item.get("label", f"field_{index + 1}")).strip()
        if not original or not replacement or original not in redacted:
            continue
        fields[f"{label}_{index + 1}"] = f"{original} -> {replacement}"
        redacted = redacted.replace(original, replacement)
    return fields, redacted


def _fallback_redactions(content: str) -> list[dict[str, str]]:
    patterns = [
        ("case_number", r"\b[A-Z]{1,4}-\d{4}-\d{2,6}\b", "[Matter Reference]"),
        ("email", r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "[Email Address]"),
        ("financial_figure", r"(?:£|\$|€)\s?\d[\d,.]*(?:\s?(?:m|bn|million|billion))?", "[Amount]"),
    ]
    results: list[dict[str, str]] = []
    for label, pattern, replacement in patterns:
        for match in re.findall(pattern, content, flags=re.IGNORECASE):
            results.append(
                {"label": label, "original": match, "replacement": replacement}
            )
    return results


async def promote_kb_entry(
    db: Session,
    *,
    user: User,
    entry_id: str,
    target_scope: str,
) -> tuple[KnowledgeBankEntry, PiiRedaction]:
    source = get_kb_entry(db, entry_id)
    if not source:
        raise KnowledgeBankError("Knowledge bank entry not found")
    if source.scope not in {"matter", "team"}:
        raise KnowledgeBankError("Only matter or team entries can be promoted")
    if target_scope == source.scope:
        raise KnowledgeBankError("Target scope must be broader than the current scope")

    redacted_fields, redacted_content = await _propose_redactions(source.body_markdown)
    promoted = KnowledgeBankEntry(
        team_id=source.team_id,
        matter_id=None if target_scope != "matter" else source.matter_id,
        source_entry_id=source.id,
        scope=target_scope,
        entry_type=source.entry_type,
        title=source.title,
        body_markdown=redacted_content,
        tags=source.tags,
        pii_status="pending_review",
        created_by=user.id,
        created_by_role=user.firm_role,
    )
    db.add(promoted)
    db.flush()
    redaction = PiiRedaction(
        kb_entry_id=promoted.id,
        source_matter_id=source.matter_id,
        target_scope=target_scope,
        redacted_fields=redacted_fields,
        original_content=source.body_markdown,
        redacted_content=redacted_content,
    )
    db.add(redaction)
    log_kb_access(
        db,
        user_id=user.id,
        action="share",
        entry_id=source.id,
        matter_id=source.matter_id,
        commit=False,
    )
    db.commit()
    db.refresh(redaction)
    return get_kb_entry(db, promoted.id) or promoted, redaction


def approve_redaction(
    db: Session,
    *,
    user: User,
    entry_id: str,
    schema: RedactionApprovalRequest,
) -> KnowledgeBankEntry | None:
    entry = db.get(KnowledgeBankEntry, entry_id)
    if not entry or entry.pii_status != "pending_review":
        return None
    redaction = db.scalar(
        select(PiiRedaction).where(PiiRedaction.kb_entry_id == entry.id)
    )
    if not redaction:
        raise KnowledgeBankError("Redaction proposal not found")

    if schema.redacted_content is not None:
        redaction.redacted_content = schema.redacted_content
        entry.body_markdown = schema.redacted_content
    if schema.redacted_fields is not None:
        redaction.redacted_fields = schema.redacted_fields
    entry.pii_status = "redacted"
    entry.version += 1
    redaction.approved_by = user.id
    redaction.approved_at = datetime.now(UTC)
    log_kb_access(
        db,
        user_id=user.id,
        action="redact_applied",
        entry_id=entry.id,
        commit=False,
    )
    db.commit()
    return get_kb_entry(db, entry.id)


def get_redaction_proposal(db: Session, entry_id: str) -> PiiRedaction | None:
    return db.scalar(select(PiiRedaction).where(PiiRedaction.kb_entry_id == entry_id))


def list_audit_log(db: Session, limit: int = 200) -> list[KnowledgeBankAccessLog]:
    stmt = (
        select(KnowledgeBankAccessLog)
        .order_by(desc(KnowledgeBankAccessLog.timestamp))
        .limit(limit)
    )
    return list(db.scalars(stmt))


async def search_kb_for_chat(
    db: Session,
    *,
    user_id: str,
    query: str,
    matter_id: str | None,
    limit: int = 6,
) -> list[KnowledgeBankEntry]:
    try:
        query_embedding = (await embed_texts([query]))[0]
    except EmbeddingError as exc:
        print(f"KB vector search skipped, falling back to keyword: {exc}")
        query_embedding = None

    base = _entry_query().where(
        KnowledgeBankEntry.pii_status.in_(["clean", "redacted"]),
        KnowledgeBankEntry.embedding.is_not(None),
    )

    if matter_id:
        matter = db.get(Matter, matter_id)
        team_id = matter.team_id if matter else None
        allowed = [
            KnowledgeBankEntry.scope == "firm_wide",
            KnowledgeBankEntry.matter_id == matter_id,
            KnowledgeBankEntry.created_by == user_id,
        ]
        if team_id:
            allowed.append(
                (KnowledgeBankEntry.scope == "team")
                & (KnowledgeBankEntry.team_id == team_id)
            )
        base = base.where(or_(*allowed))
    else:
        base = base.where(
            or_(
                KnowledgeBankEntry.scope == "firm_wide",
                (KnowledgeBankEntry.scope == "private")
                & (KnowledgeBankEntry.created_by == user_id),
            )
        )

    if query_embedding is not None:
        distance = KnowledgeBankEntry.embedding.cosine_distance(query_embedding).label("distance")
        stmt = base.add_columns(distance).order_by(distance).limit(limit)
        return [entry for entry, _ in db.execute(stmt).all()]

    # Keyword fallback if embedding is unavailable
    terms = re.findall(r"[A-Za-z0-9]{3,}", query)[:8]
    if terms:
        base = base.where(
            or_(
                *[
                    or_(
                        KnowledgeBankEntry.title.ilike(f"%{term}%"),
                        KnowledgeBankEntry.body_markdown.ilike(f"%{term}%"),
                    )
                    for term in terms
                ]
            )
        )
    return list(db.scalars(base.order_by(desc(KnowledgeBankEntry.updated_at)).limit(limit)))


def format_kb_context(entries: list[KnowledgeBankEntry]) -> str:
    if not entries:
        return ""
    return "\n\n".join(
        f"{entry.title} ({entry.entry_type}, {entry.scope})\n{entry.body_markdown}"
        for entry in entries
    )
