import asyncio
import hashlib
import json
import re
from datetime import UTC, datetime

from sqlalchemy import desc, exists, func, or_, select
from sqlalchemy.orm import Session, defer, joinedload

from app.models import (
    Document,
    KnowledgeBankAccessLog,
    KnowledgeBankEntry,
    Matter,
    MatterMember,
    PiiRedaction,
    TeamMember,
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

MAX_EMBEDDING_TEXT_CHARS = 30_000


class KnowledgeBankError(Exception):
    pass


class KnowledgeBankScopeError(KnowledgeBankError):
    pass


def _resolve_scope_targets(
    db: Session,
    *,
    user: User,
    scope: str,
    team_id: str | None,
    matter_id: str | None,
) -> tuple[str | None, str | None]:
    if scope in {"firm_wide", "private"}:
        return None, None

    if scope == "team":
        resolved_team_id = team_id or user.default_team_id
        if not resolved_team_id:
            raise KnowledgeBankScopeError("Select a team for team access")
        is_member = db.scalar(
            select(TeamMember.id).where(
                TeamMember.team_id == resolved_team_id,
                TeamMember.user_id == user.id,
            )
        )
        if not is_member:
            raise KnowledgeBankScopeError("You do not have access to that team")
        return resolved_team_id, None

    if scope == "matter":
        if not matter_id:
            raise KnowledgeBankScopeError("Select a matter for matter access")
        matter = db.get(Matter, matter_id)
        if not matter:
            raise KnowledgeBankScopeError("Matter not found")
        is_member = db.scalar(
            select(MatterMember.id).where(
                MatterMember.matter_id == matter.id,
                MatterMember.user_id == user.id,
            )
        )
        if not is_member:
            raise KnowledgeBankScopeError("You do not have access to that matter")
        return matter.team_id, matter.id

    raise KnowledgeBankScopeError("Invalid Knowledge Bank scope")


def _entry_embedding_text(entry: KnowledgeBankEntry) -> str:
    return f"{entry.title}\n\n{entry.body_markdown}".strip()[:MAX_EMBEDDING_TEXT_CHARS]


def _entry_embedding_hash(entry: KnowledgeBankEntry) -> str:
    return hashlib.sha256(_entry_embedding_text(entry).encode("utf-8")).hexdigest()


def _embedding_is_stale(entry: KnowledgeBankEntry) -> bool:
    return (
        entry.embedding is None
        or entry.embedding_content_hash != _entry_embedding_hash(entry)
    )


async def _embed_entry(entry: KnowledgeBankEntry) -> None:
    try:
        entry.embedding = (await embed_texts([_entry_embedding_text(entry)]))[0]
        entry.embedding_content_hash = _entry_embedding_hash(entry)
    except EmbeddingError as exc:
        raise KnowledgeBankError(f"Knowledge Bank embedding failed: {exc}") from exc


async def backfill_missing_kb_embeddings(
    db: Session,
    *,
    limit: int = 100,
) -> tuple[int, int, int]:
    orphaned_matter_entries = list(
        db.scalars(
            select(KnowledgeBankEntry).where(
                KnowledgeBankEntry.scope == "matter",
                KnowledgeBankEntry.matter_id.is_(None),
                KnowledgeBankEntry.source_document_id.is_not(None),
            )
        )
    )
    for entry in orphaned_matter_entries:
        entry.scope = "private"

    all_entries = list(
        db.scalars(
            select(KnowledgeBankEntry)
            .order_by(KnowledgeBankEntry.created_at)
        )
    )
    stale_entries = [entry for entry in all_entries if _embedding_is_stale(entry)]
    entries = stale_entries[:limit]
    try:
        if entries:
            embeddings = await embed_texts(
                [_entry_embedding_text(entry) for entry in entries]
            )

            for entry, embedding in zip(entries, embeddings, strict=True):
                entry.embedding = embedding
                entry.embedding_content_hash = _entry_embedding_hash(entry)

        if entries or orphaned_matter_entries:
            db.commit()
    except EmbeddingError as exc:
        db.rollback()
        raise KnowledgeBankError(f"Knowledge Bank backfill failed: {exc}") from exc
    except Exception:
        db.rollback()
        raise

    remaining_count = max(0, len(stale_entries) - len(entries))
    return len(entries), len(orphaned_matter_entries), remaining_count


def log_kb_access(
    db: Session,
    *,
    user_id: str,
    entry_id: str | None = None,
    matter_id: str | None = None,
    thread_id: str | None = None,
    ip_address: str | None = None,
    commit: bool = True,
) -> KnowledgeBankAccessLog:
    log = KnowledgeBankAccessLog(
        kb_entry_id=entry_id,
        user_id=user_id,
        action="edit",
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
        defer(KnowledgeBankEntry.embedding),
        defer(KnowledgeBankEntry.embedding_content_hash),
        joinedload(KnowledgeBankEntry.team),
        joinedload(KnowledgeBankEntry.matter).joinedload(Matter.team),
    )


MAX_KB_GRAPH_NODES = 500


def build_kb_graph(
    db: Session,
    *,
    user: User,
) -> dict[str, list[dict[str, str | None]]]:
    stmt = select(
        KnowledgeBankEntry.id,
        KnowledgeBankEntry.title,
        KnowledgeBankEntry.entry_type,
        KnowledgeBankEntry.scope,
        KnowledgeBankEntry.source_entry_id,
    )
    scope_filter = _user_kb_scope_filter(user)
    if scope_filter is not None:
        stmt = stmt.where(scope_filter)
    entries = list(
        db.execute(
            stmt.order_by(desc(KnowledgeBankEntry.updated_at)).limit(MAX_KB_GRAPH_NODES)
        ).mappings()
    )
    entry_ids = {entry["id"] for entry in entries}
    nodes = [
        {
            "id": entry["id"],
            "label": entry["title"],
            "type": entry["entry_type"],
            "status": entry["scope"],
        }
        for entry in entries
    ]
    edges: list[dict[str, str | None]] = []
    for entry in entries:
        source_entry_id = entry["source_entry_id"]
        if source_entry_id and source_entry_id in entry_ids:
            edges.append(
                {
                    "id": f"{source_entry_id}-{entry['id']}",
                    "source": source_entry_id,
                    "target": entry["id"],
                    "label": "derived",
                    "type": "derived",
                }
            )
    return {"nodes": nodes, "edges": edges}


def _user_kb_scope_filter(user: User):
    """Build a WHERE clause that limits results to entries the user can read."""
    return or_(
        KnowledgeBankEntry.scope == "firm_wide",
        (KnowledgeBankEntry.scope == "team")
        & exists(
            select(TeamMember.id).where(
                TeamMember.team_id == KnowledgeBankEntry.team_id,
                TeamMember.user_id == user.id,
            )
        ),
        (KnowledgeBankEntry.scope == "matter")
        & exists(
            select(MatterMember.id).where(
                MatterMember.matter_id == KnowledgeBankEntry.matter_id,
                MatterMember.user_id == user.id,
            )
        ),
        (KnowledgeBankEntry.scope == "private")
        & (KnowledgeBankEntry.created_by == user.id),
    )


def _apply_kb_filters(
    stmt,
    *,
    user: User,
    scope: str | None,
    entry_type: str | None,
    matter_id: str | None,
    context_matter_id: str | None,
    team_id: str | None,
    pii_status: str | None,
    query: str | None,
):
    scope_filter = _user_kb_scope_filter(user)
    if scope_filter is not None:
        stmt = stmt.where(scope_filter)
    if scope:
        stmt = stmt.where(KnowledgeBankEntry.scope == scope)
    if entry_type:
        stmt = stmt.where(KnowledgeBankEntry.entry_type == entry_type)
    if matter_id:
        stmt = stmt.where(KnowledgeBankEntry.matter_id == matter_id)
    if context_matter_id:
        stmt = stmt.where(
            or_(
                KnowledgeBankEntry.scope != "matter",
                KnowledgeBankEntry.matter_id == context_matter_id,
            )
        )
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
    return stmt


def list_kb_entries(
    db: Session,
    *,
    user: User,
    scope: str | None = None,
    entry_type: str | None = None,
    matter_id: str | None = None,
    context_matter_id: str | None = None,
    team_id: str | None = None,
    pii_status: str | None = None,
    query: str | None = None,
    limit: int = 30,
    offset: int = 0,
) -> tuple[list[dict], int | None]:
    stmt = select(
        KnowledgeBankEntry.id,
        KnowledgeBankEntry.team_id,
        KnowledgeBankEntry.matter_id,
        KnowledgeBankEntry.source_entry_id,
        KnowledgeBankEntry.source_document_id,
        KnowledgeBankEntry.scope,
        KnowledgeBankEntry.entry_type,
        KnowledgeBankEntry.title,
        func.substr(KnowledgeBankEntry.body_markdown, 1, 600).label("body_preview"),
        KnowledgeBankEntry.tags,
        KnowledgeBankEntry.pii_status,
        KnowledgeBankEntry.status,
        KnowledgeBankEntry.error_message,
        KnowledgeBankEntry.created_by,
        KnowledgeBankEntry.created_by_role,
        KnowledgeBankEntry.version,
        KnowledgeBankEntry.created_at,
        KnowledgeBankEntry.updated_at,
    )
    stmt = _apply_kb_filters(
        stmt,
        user=user,
        scope=scope,
        entry_type=entry_type,
        matter_id=matter_id,
        context_matter_id=context_matter_id,
        team_id=team_id,
        pii_status=pii_status,
        query=query,
    )
    rows = list(
        db.execute(
            stmt.order_by(desc(KnowledgeBankEntry.updated_at))
            .limit(limit + 1)
            .offset(offset)
        ).mappings()
    )
    has_more = len(rows) > limit
    return [dict(row) for row in rows[:limit]], offset + limit if has_more else None


def get_kb_entry_statuses(
    db: Session,
    *,
    user: User,
    entry_ids: list[str],
) -> list[dict]:
    if not entry_ids:
        return []
    stmt = select(
        KnowledgeBankEntry.id,
        KnowledgeBankEntry.status,
        KnowledgeBankEntry.error_message,
        KnowledgeBankEntry.version,
        KnowledgeBankEntry.updated_at,
    ).where(KnowledgeBankEntry.id.in_(entry_ids[:100]))
    scope_filter = _user_kb_scope_filter(user)
    if scope_filter is not None:
        stmt = stmt.where(scope_filter)
    return [dict(row) for row in db.execute(stmt).mappings()]


def get_kb_entry(db: Session, entry_id: str) -> KnowledgeBankEntry | None:
    return db.scalar(_entry_query().where(KnowledgeBankEntry.id == entry_id))


async def create_kb_entry(
    db: Session,
    *,
    user: User,
    schema: KnowledgeBankEntryCreate,
) -> KnowledgeBankEntry:
    team_id, matter_id = _resolve_scope_targets(
        db,
        user=user,
        scope=schema.scope,
        team_id=schema.team_id,
        matter_id=schema.matter_id,
    )
    entry = KnowledgeBankEntry(
        team_id=team_id,
        matter_id=matter_id,
        scope=schema.scope,
        entry_type=schema.entry_type,
        title=schema.title,
        body_markdown=schema.body_markdown,
        tags=schema.tags,
        pii_status=schema.pii_status,
        created_by=user.id,
        created_by_role=user.firm_role,
    )
    try:
        db.add(entry)
        db.flush()
        await _embed_entry(entry)
        log_kb_access(
            db,
            user_id=user.id,
            entry_id=entry.id,
            matter_id=entry.matter_id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
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
        if (
            existing.title != page.title
            or existing.body_markdown != page.body_markdown
            or _embedding_is_stale(existing)
        ):
            existing.title = page.title
            existing.body_markdown = page.body_markdown
            existing.version = max(existing.version + 1, page.version)
            try:
                await _embed_entry(existing)
                log_kb_access(
                    db,
                    user_id=user.id,
                    entry_id=existing.id,
                    matter_id=existing.matter_id,
                    commit=False,
                )
                db.commit()
            except Exception:
                db.rollback()
                raise
        return get_kb_entry(db, existing.id) or existing

    entry = KnowledgeBankEntry(
        id=page.id,
        team_id=document.team_id or user.default_team_id,
        matter_id=document.matter_id,
        source_document_id=document.id,
        scope="matter" if document.matter_id else "private",
        entry_type="knowledge_bank",
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
    try:
        db.add(entry)
        db.flush()
        await _embed_entry(entry)
        log_kb_access(
            db,
            user_id=user.id,
            entry_id=entry.id,
            matter_id=entry.matter_id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_kb_entry(db, entry.id) or entry


async def sync_linked_wiki_page_to_kb(
    db: Session,
    *,
    user: User,
    page: WikiPage,
) -> KnowledgeBankEntry | None:
    """Re-sync a KB entry from an updated wiki page.

    Only entries created via the legacy wiki-ingestion path share an id
    with their wiki page. Entries created via the async KB ingestion path
    own their content (DeepSeek Pro summary) and must NOT be overwritten
    by wiki edits — we'd silently clobber the Pro-generated summary.
    """
    if not page.source_document_id:
        return None
    linked_entry = db.scalar(
        select(KnowledgeBankEntry.id).where(
            KnowledgeBankEntry.id == page.id,
            KnowledgeBankEntry.created_by == user.id,
        )
    )
    if not linked_entry:
        return None
    return await add_document_to_kb(db, user=user, page=page)


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
    updates = schema.model_dump(exclude_unset=True)
    classification_fields = {"scope", "team_id", "matter_id"}
    if classification_fields.intersection(schema.model_fields_set):
        if entry.created_by != user.id:
            raise KnowledgeBankScopeError("Only the entry owner can change its access scope")
        target_scope = updates.get("scope", entry.scope)
        target_team_id, target_matter_id = _resolve_scope_targets(
            db,
            user=user,
            scope=target_scope,
            team_id=updates.get("team_id", entry.team_id),
            matter_id=updates.get("matter_id", entry.matter_id),
        )
        updates["scope"] = target_scope
        updates["team_id"] = target_team_id
        updates["matter_id"] = target_matter_id
    changed = any(getattr(entry, field) != value for field, value in updates.items())
    if not changed:
        return get_kb_entry(db, entry.id)

    content_changed = any(
        field in updates and getattr(entry, field) != updates[field]
        for field in ("title", "body_markdown")
    )
    try:
        for field, value in updates.items():
            setattr(entry, field, value)
        entry.version += 1
        if content_changed or _embedding_is_stale(entry):
            await _embed_entry(entry)
        log_kb_access(
            db,
            user_id=user.id,
            entry_id=entry.id,
            matter_id=entry.matter_id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_kb_entry(db, entry.id)


def delete_kb_entry(db: Session, *, user: User, entry_id: str) -> bool:
    entry = db.get(KnowledgeBankEntry, entry_id)
    if not entry:
        return False
    log_kb_access(
        db,
        user_id=user.id,
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
    try:
        db.add(promoted)
        db.flush()
        await _embed_entry(promoted)
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
            entry_id=source.id,
            matter_id=source.matter_id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(redaction)
    return get_kb_entry(db, promoted.id) or promoted, redaction


async def approve_redaction(
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

    try:
        if schema.redacted_content is not None:
            redaction.redacted_content = schema.redacted_content
            entry.body_markdown = schema.redacted_content
        if schema.redacted_fields is not None:
            redaction.redacted_fields = schema.redacted_fields
        entry.pii_status = "redacted"
        entry.version += 1
        redaction.approved_by = user.id
        redaction.approved_at = datetime.now(UTC)
        await _embed_entry(entry)
        log_kb_access(
            db,
            user_id=user.id,
            entry_id=entry.id,
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_kb_entry(db, entry.id)


def get_redaction_proposal(db: Session, entry_id: str) -> PiiRedaction | None:
    return db.scalar(select(PiiRedaction).where(PiiRedaction.kb_entry_id == entry_id))


def list_audit_log(db: Session, limit: int = 200) -> list[KnowledgeBankAccessLog]:
    stmt = (
        select(KnowledgeBankAccessLog)
        .where(KnowledgeBankAccessLog.action == "edit")
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
    user = db.get(User, user_id)
    if not user:
        return []

    try:
        query_embedding = (await embed_texts([query]))[0]
    except EmbeddingError as exc:
        print(f"KB vector search skipped, falling back to keyword: {exc}")
        query_embedding = None

    base = _entry_query().where(
        KnowledgeBankEntry.embedding.is_not(None),
        KnowledgeBankEntry.embedding_content_hash.is_not(None),
    )
    scope_filter = _user_kb_scope_filter(user)
    if scope_filter is not None:
        base = base.where(scope_filter)

    if matter_id:
        base = base.where(
            or_(
                KnowledgeBankEntry.scope != "matter",
                KnowledgeBankEntry.matter_id == matter_id,
            )
        )
    else:
        base = base.where(KnowledgeBankEntry.scope != "matter")

    base = base.where(
        or_(
            KnowledgeBankEntry.pii_status.in_(["clean", "redacted"]),
            (KnowledgeBankEntry.pii_status == "flagged")
            & KnowledgeBankEntry.scope.in_(["matter", "private"]),
        )
    )

    if query_embedding is not None:
        distance = KnowledgeBankEntry.embedding.cosine_distance(query_embedding).label("distance")
        stmt = base.add_columns(distance).order_by(distance).limit(limit * 3)
        candidates = [entry for entry, _ in db.execute(stmt).all()]
        return [entry for entry in candidates if not _embedding_is_stale(entry)][:limit]

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
    candidates = list(
        db.scalars(base.order_by(desc(KnowledgeBankEntry.updated_at)).limit(limit * 3))
    )
    return [entry for entry in candidates if not _embedding_is_stale(entry)][:limit]


def format_kb_context(entries: list[KnowledgeBankEntry]) -> str:
    if not entries:
        return ""
    return "\n\n".join(
        f"{entry.title} ({entry.entry_type}, {entry.scope})\n{entry.body_markdown}"
        for entry in entries
    )
