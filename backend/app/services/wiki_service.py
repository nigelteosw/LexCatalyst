import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Document,
    DocumentChunk,
    User,
    WikiLink,
    WikiPage,
    WikiPageRevision,
    WikiPageSource,
)
from app.providers.deepseek import DeepSeekProvider
from app.schemas import WikiIngestRequest, WikiPageCreate, WikiPageUpdate

DEFAULT_PAGE_TYPES = {"source_summary", "issue", "timeline", "playbook", "memory_note"}
ALL_PAGE_TYPES = DEFAULT_PAGE_TYPES | {"entity", "clause", "authority", "question_answer"}
MAX_INGEST_CHUNKS = 10
MAX_CHUNK_CHARS = 2200


class WikiIngestionError(RuntimeError):
    pass


class WikiForbiddenError(RuntimeError):
    pass


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:220] or "wiki-page"


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def unique_slug(
    db: Session,
    title: str,
    page_id: str | None = None,
    owner_user_id: str | None = None,
) -> str:
    base = slugify(title)
    slug = base
    suffix = 2
    while True:
        stmt = select(WikiPage).where(WikiPage.slug == slug)
        if page_id:
            stmt = stmt.where(WikiPage.id != page_id)
        if owner_user_id:
            stmt = stmt.where(WikiPage.owner_user_id == owner_user_id)
        if not db.scalar(stmt):
            return slug
        slug = f"{base}-{suffix}"
        suffix += 1


def accessible_page_filter(user_id: str):
    return and_(
        WikiPage.status != "archived",
        or_(WikiPage.status == "published", WikiPage.owner_user_id == user_id),
    )


def list_wiki_pages(
    db: Session,
    *,
    user_id: str,
    status: str | None = None,
    page_type: str | None = None,
) -> list[WikiPage]:
    base_filter = (
        WikiPage.owner_user_id == user_id
        if status == "archived"
        else accessible_page_filter(user_id)
    )
    stmt = (
        select(WikiPage)
        .options(joinedload(WikiPage.author), joinedload(WikiPage.latest_editor))
        .where(base_filter)
    )
    if status:
        stmt = stmt.where(WikiPage.status == status)
    if page_type:
        stmt = stmt.where(WikiPage.page_type == page_type)
    stmt = stmt.order_by(desc(WikiPage.updated_at))
    return list(db.scalars(stmt))


def get_wiki_page(db: Session, *, user_id: str, page_id: str) -> WikiPage | None:
    stmt = (
        select(WikiPage)
        .options(joinedload(WikiPage.author), joinedload(WikiPage.latest_editor))
        .where(WikiPage.id == page_id, accessible_page_filter(user_id))
    )
    return db.scalar(stmt)


def create_wiki_page(db: Session, *, user_id: str, schema: WikiPageCreate) -> WikiPage:
    status = schema.status
    page = WikiPage(
        owner_user_id=user_id,
        author_user_id=user_id,
        latest_editor_user_id=user_id,
        title=schema.title,
        slug=unique_slug(db, schema.title, owner_user_id=user_id),
        body_markdown=schema.body_markdown,
        excerpt=schema.excerpt or make_excerpt(schema.body_markdown),
        page_type=schema.page_type,
        status=status,
        created_by="user",
        version=1,
        published_at=datetime.now(UTC) if status == "published" else None,
    )
    db.add(page)
    db.flush()
    add_revision(
        db,
        page=page,
        edited_by_user_id=user_id,
        edit_source="user",
        change_summary="Created page",
    )
    db.commit()
    db.refresh(page)
    return page


def update_wiki_page(
    db: Session,
    *,
    user_id: str,
    page_id: str,
    schema: WikiPageUpdate,
) -> WikiPage | None:
    page = get_wiki_page(db, user_id=user_id, page_id=page_id)
    if not page:
        return None
    if page.status == "published" and page.owner_user_id != user_id:
        raise WikiForbiddenError("Only the page owner can edit a published page")

    changed = False
    changed_body = False
    if schema.title is not None and schema.title != page.title:
        page.title = schema.title
        page.slug = unique_slug(db, schema.title, page_id=page.id, owner_user_id=user_id)
        changed = True
    if schema.body_markdown is not None and schema.body_markdown != page.body_markdown:
        page.body_markdown = schema.body_markdown
        changed_body = True
        changed = True
    if schema.page_type is not None and schema.page_type != page.page_type:
        page.page_type = schema.page_type
        changed = True
    if schema.excerpt is not None and schema.excerpt != page.excerpt:
        page.excerpt = schema.excerpt
        changed = True
    elif changed_body:
        page.excerpt = make_excerpt(page.body_markdown)
    if schema.status is not None and schema.status != page.status:
        page.status = schema.status
        if schema.status == "published" and page.published_at is None:
            page.published_at = datetime.now(UTC)
        changed = True

    if not changed:
        return page

    page.latest_editor_user_id = user_id
    page.updated_at = datetime.now(UTC)
    page.version += 1
    add_revision(
        db,
        page=page,
        edited_by_user_id=user_id,
        edit_source="user",
        change_summary=schema.change_summary or "Updated page",
    )
    db.commit()
    db.refresh(page)
    return page


def publish_wiki_page(db: Session, *, user_id: str, page_id: str) -> WikiPage | None:
    page = get_wiki_page(db, user_id=user_id, page_id=page_id)
    if not page or page.owner_user_id != user_id:
        return None
    page.status = "published"
    page.published_at = datetime.now(UTC)
    page.latest_editor_user_id = user_id
    page.updated_at = datetime.now(UTC)
    page.version += 1
    add_revision(
        db,
        page=page,
        edited_by_user_id=user_id,
        edit_source="user",
        change_summary="Published to team",
    )
    db.commit()
    db.refresh(page)
    return page


def archive_wiki_page(db: Session, *, user_id: str, page_id: str) -> bool:
    page = db.scalar(
        select(WikiPage).where(
            WikiPage.id == page_id,
            WikiPage.owner_user_id == user_id,
        )
    )
    if not page:
        return False
    if page.status == "archived":
        return True
    page.status = "archived"
    page.latest_editor_user_id = user_id
    page.updated_at = datetime.now(UTC)
    page.version += 1
    add_revision(
        db,
        page=page,
        edited_by_user_id=user_id,
        edit_source="user",
        change_summary="Archived page",
    )
    db.commit()
    return True


def list_wiki_page_sources(
    db: Session,
    *,
    user_id: str,
    page_id: str,
) -> list[WikiPageSource]:
    page = get_wiki_page(db, user_id=user_id, page_id=page_id)
    if not page:
        return []
    stmt = (
        select(WikiPageSource)
        .options(joinedload(WikiPageSource.chunk))
        .where(WikiPageSource.page_id == page_id)
        .order_by(WikiPageSource.created_at)
    )
    return list(db.scalars(stmt))


def search_wiki_pages(db: Session, *, user_id: str, query: str, limit: int = 5) -> list[WikiPage]:
    normalized = query.strip()
    if not normalized:
        return []
    pattern = f"%{escape_like(normalized[:200])}%"
    stmt = (
        select(WikiPage)
        .where(
            accessible_page_filter(user_id),
            or_(
                WikiPage.title.ilike(pattern, escape="\\"),
                WikiPage.body_markdown.ilike(pattern, escape="\\"),
            ),
        )
        .order_by(desc(WikiPage.updated_at))
        .limit(limit)
    )
    return list(db.scalars(stmt))


def format_wiki_context(pages: list[WikiPage]) -> str:
    if not pages:
        return ""
    blocks = []
    for index, page in enumerate(pages, start=1):
        excerpt = page.excerpt or make_excerpt(page.body_markdown)
        blocks.append(
            "\n".join(
                [
                    f"[W{index}] {page.title} ({page.page_type}, {page.status})",
                    excerpt,
                ]
            )
        )
    return "\n\n".join(blocks)


def build_wiki_graph(db: Session, *, user_id: str) -> dict[str, list[dict[str, str | None]]]:
    pages = list_wiki_pages(db, user_id=user_id)
    page_ids = {page.id for page in pages}
    nodes = [
        {
            "id": page.id,
            "label": page.title,
            "type": "page",
            "status": page.status,
        }
        for page in pages
    ]
    edges: list[dict[str, str | None]] = []

    if not page_ids:
        return {"nodes": nodes, "edges": edges}

    stmt = select(WikiLink).where(
        WikiLink.source_page_id.in_(page_ids),
        or_(WikiLink.target_page_id.is_(None), WikiLink.target_page_id.in_(page_ids)),
    )
    for link in db.scalars(stmt):
        if not link.target_page_id:
            continue
        edges.append(
            {
                "id": link.id,
                "source": link.source_page_id,
                "target": link.target_page_id,
                "label": link.link_text,
                "type": link.link_type,
            }
        )

    return {"nodes": nodes, "edges": edges}


async def ingest_document_to_wiki(
    db: Session,
    *,
    user: User,
    document_id: str,
    request: WikiIngestRequest,
) -> WikiPage:
    document = db.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == user.id,
        )
    )
    if not document:
        raise WikiIngestionError("Document not found")
    if document.status != "ready":
        raise WikiIngestionError("Document must be ready before generating a wiki page")
    if "source_summary" not in request.page_types:
        raise WikiIngestionError("The MVP only supports source_summary generation")

    existing = db.scalar(
        select(WikiPage)
        .options(joinedload(WikiPage.author), joinedload(WikiPage.latest_editor))
        .where(
            WikiPage.source_document_id == document_id,
            WikiPage.owner_user_id == user.id,
            WikiPage.status != "archived",
        )
    )
    if existing:
        return existing

    chunks = list(
        db.scalars(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document.id)
            .order_by(DocumentChunk.chunk_index)
            .limit(MAX_INGEST_CHUNKS)
        )
    )
    if not chunks:
        raise WikiIngestionError("Document has no searchable chunks")

    provider = DeepSeekProvider()
    content, _ = await provider.chat(
        build_ingestion_prompt(document=document, chunks=chunks),
        model=request.model,
    )
    payload = parse_json_object(content)
    page_payload = first_page_payload(payload)

    page = WikiPage(
        owner_user_id=user.id,
        author_user_id=user.id,
        title=clean_string(page_payload.get("title")) or f"{document.filename} - Source Summary",
        slug=unique_slug(db, clean_string(page_payload.get("slug")) or document.filename, owner_user_id=user.id),
        body_markdown=clean_string(page_payload.get("body_markdown")) or fallback_page_body(document),
        excerpt=clean_string(page_payload.get("excerpt")),
        page_type="source_summary",
        status="draft",
        created_by="llm",
        source_document_id=document.id,
        version=1,
    )
    page.excerpt = page.excerpt or make_excerpt(page.body_markdown)
    db.add(page)
    db.flush()

    add_revision(
        db,
        page=page,
        edited_by_user_id=None,
        edit_source="llm_ingestion",
        change_summary=f"Generated from {document.filename}",
    )
    add_sources(db, page=page, document=document, chunks=chunks, payload=page_payload)
    add_links(db, page=page, payload=page_payload, user_id=user.id)
    db.commit()
    db.refresh(page)
    return page


def add_revision(
    db: Session,
    *,
    page: WikiPage,
    edited_by_user_id: str | None,
    edit_source: str,
    change_summary: str,
) -> None:
    db.add(
        WikiPageRevision(
            page_id=page.id,
            body_markdown=page.body_markdown,
            edited_by_user_id=edited_by_user_id,
            edit_source=edit_source,
            change_summary=change_summary,
        )
    )


def add_sources(
    db: Session,
    *,
    page: WikiPage,
    document: Document,
    chunks: list[DocumentChunk],
    payload: dict[str, Any],
) -> None:
    chunks_by_id = {chunk.id: chunk for chunk in chunks}
    raw_sources = payload.get("sources")
    if not isinstance(raw_sources, list):
        raw_sources = []

    used_chunk_ids: set[str] = set()
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            continue
        chunk_id = clean_string(raw_source.get("chunk_id"))
        if chunk_id not in chunks_by_id:
            continue
        chunk = chunks_by_id[chunk_id]
        used_chunk_ids.add(chunk_id)
        db.add(
            WikiPageSource(
                page_id=page.id,
                document_id=document.id,
                chunk_id=chunk.id,
                citation_label=clean_string(raw_source.get("citation_label")) or chunk.citation_label,
                relevance_note=clean_string(raw_source.get("relevance_note")),
            )
        )

    if not used_chunk_ids:
        for chunk in chunks[:3]:
            db.add(
                WikiPageSource(
                    page_id=page.id,
                    document_id=document.id,
                    chunk_id=chunk.id,
                    citation_label=chunk.citation_label,
                    relevance_note="Source chunk used for generated summary.",
                )
            )


def add_links(db: Session, *, page: WikiPage, payload: dict[str, Any], user_id: str) -> None:
    raw_links = payload.get("links")
    if not isinstance(raw_links, list):
        return
    for raw_link in raw_links:
        if not isinstance(raw_link, dict):
            continue
        target_title = clean_string(raw_link.get("target_title"))
        target_page_id = None
        if target_title:
            target = db.scalar(
                select(WikiPage).where(
                    accessible_page_filter(user_id),
                    WikiPage.title.ilike(f"%{escape_like(target_title)}%", escape="\\"),
                )
            )
            target_page_id = target.id if target else None
        db.add(
            WikiLink(
                source_page_id=page.id,
                target_page_id=target_page_id,
                link_text=clean_string(raw_link.get("link_text")) or target_title or "Related",
                link_type=clean_string(raw_link.get("link_type")) or "related",
            )
        )


def build_ingestion_prompt(
    *,
    document: Document,
    chunks: list[DocumentChunk],
) -> list[dict[str, str]]:
    chunk_blocks = []
    for chunk in chunks:
        text = chunk.text[:MAX_CHUNK_CHARS]
        chunk_blocks.append(
            "\n".join(
                [
                    f"chunk_id: {chunk.id}",
                    f"citation_label: {chunk.citation_label}",
                    text,
                ]
            )
        )

    prompt = f"""Generate one LexCatalyst wiki source_summary page from the document chunks.

Return only valid JSON in this shape:
{{
  "pages": [
    {{
      "title": "...",
      "slug": "...",
      "page_type": "source_summary",
      "excerpt": "...",
      "body_markdown": "...",
      "links": [
        {{"target_title": "...", "link_text": "...", "link_type": "related"}}
      ],
      "sources": [
        {{"chunk_id": "...", "citation_label": "...", "relevance_note": "..."}}
      ]
    }}
  ]
}}

Rules:
- Use only the chunks below.
- Cite source-backed claims in Source Notes.
- Do not paste the full document.
- Preserve uncertainty and list open questions.
- Write for a junior lawyer reducing matter cognitive load.

Document filename: {document.filename}

Chunks:
{chr(10).join(chunk_blocks)}
"""
    return [{"role": "user", "content": prompt}]


def parse_json_object(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:].strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[3:].strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise WikiIngestionError(f"Wiki generator returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise WikiIngestionError("Wiki generator returned invalid JSON")
    return data


def first_page_payload(payload: dict[str, Any]) -> dict[str, Any]:
    pages = payload.get("pages")
    if not isinstance(pages, list) or not pages:
        raise WikiIngestionError("Wiki generator did not return any pages")
    first = pages[0]
    if not isinstance(first, dict):
        raise WikiIngestionError("Wiki generator returned an invalid page")
    return first


def make_excerpt(markdown: str, max_length: int = 280) -> str:
    plain = re.sub(r"[#*_`\[\]]", "", markdown)
    plain = " ".join(plain.split())
    if len(plain) <= max_length:
        return plain
    return f"{plain[: max_length - 3].rstrip()}..."


def clean_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def fallback_page_body(document: Document) -> str:
    return "\n\n".join(
        [
            f"## What This Is\n\nGenerated source summary for {document.filename}.",
            "## Key Points\n\n- The generator did not return a complete summary.",
            "## Issues To Watch\n\n- Review the source citations before relying on this page.",
            "## Open Questions\n\n- What legal issues should the team investigate next?",
        ]
    )
