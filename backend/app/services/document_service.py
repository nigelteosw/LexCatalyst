import asyncio
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Document, DocumentChunk
from app.providers.embedding_provider import EmbeddingError, embed_texts
from app.services.ingestion_service import (
    IngestionError,
    UnsupportedDocumentError,
    chunk_text_blocks,
    extract_text_blocks,
    validate_supported_document,
)
from app.services.storage_service import StorageError, upload_document_file

MAX_ERROR_LENGTH = 1000


class DocumentProcessingError(RuntimeError):
    pass


async def ingest_uploaded_document(
    db: Session,
    *,
    user_id: str,
    filename: str,
    content_type: str,
    file_bytes: bytes,
) -> Document:
    validate_supported_document(filename, content_type)

    document = Document(
        user_id=user_id,
        filename=filename,
        content_type=content_type,
        status="uploaded",
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    document_id = document.id

    try:
        storage_key = await asyncio.to_thread(
            upload_document_file,
            file_bytes=file_bytes,
            user_id=user_id,
            document_id=document.id,
            filename=filename,
            content_type=content_type,
        )
        document.storage_key = storage_key
        document.status = "processing"
        document.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(document)

        blocks = await asyncio.to_thread(extract_text_blocks, file_bytes, filename, content_type)
        chunks = chunk_text_blocks(blocks, filename=filename)
        embeddings = await embed_texts([chunk.text for chunk in chunks])

        for chunk, embedding in zip(chunks, embeddings, strict=True):
            db.add(
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embedding=embedding,
                    page_number=chunk.page_number,
                    citation_label=chunk.citation_label,
                )
            )

        document.status = "ready"
        document.error_message = None
        document.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(document)
        return document
    except (
        StorageError,
        IngestionError,
        EmbeddingError,
        DocumentProcessingError,
        ValueError,
    ) as exc:
        db.rollback()
        document = db.get(Document, document_id)
        if document:
            document.status = "failed"
            document.error_message = str(exc)[:MAX_ERROR_LENGTH]
            document.updated_at = datetime.now(UTC)
            db.commit()
            db.refresh(document)
            return document
        raise


def list_user_documents(db: Session, user_id: str) -> list[tuple[Document, int]]:
    chunk_count = func.count(DocumentChunk.id).label("chunk_count")
    stmt = (
        select(Document, chunk_count)
        .outerjoin(DocumentChunk)
        .where(Document.user_id == user_id)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    )
    return [(document, count) for document, count in db.execute(stmt).all()]


def get_user_document(db: Session, user_id: str, document_id: str) -> tuple[Document, int] | None:
    chunk_count = func.count(DocumentChunk.id).label("chunk_count")
    stmt = (
        select(Document, chunk_count)
        .outerjoin(DocumentChunk)
        .where(Document.id == document_id, Document.user_id == user_id)
        .group_by(Document.id)
    )
    row = db.execute(stmt).one_or_none()
    if not row:
        return None
    document, count = row
    return document, count
