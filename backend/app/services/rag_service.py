from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, DocumentChunk
from app.providers.embedding_provider import embed_texts
from app.services.document_service import document_access_filter


@dataclass(frozen=True)
class DocumentSearchResult:
    chunk_id: str
    document_id: str
    filename: str
    text: str
    score: float
    page_number: int | None
    citation_label: str


async def search_documents(
    db: Session,
    *,
    query: str,
    user_id: str,
    matter_id: str | None = None,
    limit: int = 6,
) -> list[DocumentSearchResult]:
    if not query.strip():
        return []

    query_embedding = (await embed_texts([query]))[0]
    distance = DocumentChunk.embedding.cosine_distance(query_embedding).label("distance")
    stmt = (
        select(DocumentChunk, Document, distance)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(document_access_filter(user_id), Document.status == "ready")
    )
    if matter_id:
        stmt = stmt.where(Document.matter_id == matter_id)
    stmt = stmt.order_by(distance).limit(limit)

    results: list[DocumentSearchResult] = []
    for chunk, document, raw_distance in db.execute(stmt).all():
        distance_value = float(raw_distance)
        results.append(
            DocumentSearchResult(
                chunk_id=chunk.id,
                document_id=document.id,
                filename=document.filename,
                text=chunk.text,
                score=1.0 - distance_value,
                page_number=chunk.page_number,
                citation_label=chunk.citation_label,
            )
        )
    return results


def format_document_context(results: list[DocumentSearchResult]) -> str:
    if not results:
        return ""

    blocks = []
    for index, result in enumerate(results, start=1):
        blocks.append(
            "\n".join(
                [
                    f"[{index}] {result.citation_label}",
                    result.text,
                ]
            )
        )
    return "\n\n".join(blocks)
