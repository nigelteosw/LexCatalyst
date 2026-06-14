import asyncio
import multiprocessing
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Document, DocumentChunk
from app.providers.embedding_provider import EmbeddingError, embed_texts
from app.services.ingestion_service import (
    IngestionError,
    TextBlock,
    UnsupportedDocumentError,
    chunk_text_blocks,
    extract_text_blocks,
    make_citation_label,
    validate_supported_document,
)
from app.services.storage_service import (
    StorageError,
    delete_document_file,
    download_document_file,
    upload_document_file,
)
from app.worker_types import WorkerClaim

MAX_ERROR_LENGTH = 1000
STALE_CLAIM_AFTER = timedelta(minutes=30)
MAX_PROCESSING_ATTEMPTS = 3
DOWNLOAD_TIMEOUT_SECONDS = 60.0
EXTRACTION_TIMEOUT_SECONDS = 120.0


class DocumentProcessingError(RuntimeError):
    pass


def _extract_blocks_child(
    connection,
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> None:
    try:
        connection.send(
            ("ok", extract_text_blocks(file_bytes, filename, content_type))
        )
    except BaseException as exc:  # noqa: BLE001 - report child failures to the parent
        connection.send(("error", f"{type(exc).__name__}: {exc}"))
    finally:
        connection.close()


def _extract_text_blocks_with_timeout(
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> list[TextBlock]:
    """Run extraction in a subprocess that can be terminated on timeout."""
    context = multiprocessing.get_context("spawn")
    receive_connection, send_connection = context.Pipe(duplex=False)
    process = context.Process(
        target=_extract_blocks_child,
        args=(send_connection, file_bytes, filename, content_type),
        name="document-extraction",
    )
    process.start()
    send_connection.close()
    deadline = time.monotonic() + EXTRACTION_TIMEOUT_SECONDS

    try:
        while time.monotonic() < deadline:
            if receive_connection.poll(0.1):
                status, payload = receive_connection.recv()
                process.join(timeout=1)
                if status == "error":
                    raise IngestionError(payload)
                return payload
            if not process.is_alive():
                break

        if process.is_alive():
            process.terminate()
            process.join(timeout=1)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)
            raise DocumentProcessingError(
                f"Extraction timed out after {int(EXTRACTION_TIMEOUT_SECONDS)}s"
            )
        raise DocumentProcessingError(
            f"Extraction process exited with code {process.exitcode} without returning text"
        )
    finally:
        receive_connection.close()
        if process.is_alive():
            process.terminate()
            process.join(timeout=1)


def document_access_filter(user_id: str):
    return Document.user_id == user_id


def can_access_document(
    db: Session,
    *,
    user_id: str,
    document: Document,
) -> bool:
    return document.user_id == user_id


async def create_pending_document(
    db: Session,
    *,
    user_id: str,
    filename: str,
    content_type: str,
    file_bytes: bytes,
    matter_id: str | None = None,
    team_id: str | None = None,
) -> Document:
    """Store an upload and enqueue durable document processing."""
    validate_supported_document(filename, content_type)

    document = Document(
        user_id=user_id,
        filename=filename,
        content_type=content_type,
        status="uploaded",
        matter_id=matter_id,
        team_id=team_id,
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
        document.processing_started_at = None
        document.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(document)
        return document
    except (StorageError, ValueError) as exc:
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


def claim_pending_document(db: Session) -> WorkerClaim | None:
    """Atomically claim one queued document, including stale jobs."""
    stale_before = datetime.now(UTC) - STALE_CLAIM_AFTER
    # Fail documents that have exhausted retries before attempting to claim.
    db.execute(
        update(Document)
        .where(
            Document.status == "processing",
            Document.processing_attempts >= MAX_PROCESSING_ATTEMPTS,
            or_(
                Document.processing_started_at.is_(None),
                Document.processing_started_at < stale_before,
            ),
        )
        .values(
            status="failed",
            error_message=f"Processing failed after {MAX_PROCESSING_ATTEMPTS} attempts (possible OOM or timeout)",
            updated_at=datetime.now(UTC),
        )
    )
    db.commit()

    document_id = db.scalar(
        select(Document.id)
        .where(
            Document.status == "processing",
            Document.processing_attempts < MAX_PROCESSING_ATTEMPTS,
            or_(
                Document.processing_started_at.is_(None),
                Document.processing_started_at < stale_before,
            ),
        )
        .order_by(Document.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if not document_id:
        return None

    started_at = datetime.now(UTC)
    db.execute(
        update(Document)
        .where(Document.id == document_id)
        .values(
            processing_started_at=started_at,
            processing_attempts=Document.processing_attempts + 1,
        )
    )
    db.commit()
    return WorkerClaim(job_id=document_id, started_at=started_at)


async def process_document(claim: WorkerClaim) -> None:
    """Download, extract, embed, and persist one claimed document."""
    document_id = claim.job_id
    metadata_db = SessionLocal()
    try:
        document = metadata_db.scalar(
            select(Document).where(
                Document.id == document_id,
                Document.status == "processing",
                Document.processing_started_at == claim.started_at,
            )
        )
        if not document:
            return
        storage_key = document.storage_key
        filename = document.filename
        content_type = document.content_type
    finally:
        metadata_db.close()

    if not storage_key:
        _mark_document_failed(claim, "Document has no stored file.")
        return

    print(f"[doc:{document_id}] downloading {filename!r}")
    try:
        file_bytes = await asyncio.wait_for(
            asyncio.to_thread(download_document_file, storage_key),
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        _mark_document_failed(claim, "Download timed out")
        return
    except StorageError as exc:
        _mark_document_failed(claim, str(exc))
        return

    print(f"[doc:{document_id}] extracting text ({len(file_bytes)} bytes)")
    try:
        blocks = await asyncio.to_thread(
            _extract_text_blocks_with_timeout,
            file_bytes,
            filename,
            content_type,
        )
        print(f"[doc:{document_id}] extracted {len(blocks)} blocks, chunking")
        chunks = chunk_text_blocks(blocks, filename=filename)
        print(f"[doc:{document_id}] embedding {len(chunks)} chunks")
        embeddings = await embed_texts([chunk.text for chunk in chunks])
    except (
        IngestionError,
        EmbeddingError,
        DocumentProcessingError,
        ValueError,
    ) as exc:
        _mark_document_failed(claim, str(exc))
        return
    except Exception as exc:  # noqa: BLE001 - worker must record terminal failures
        _mark_document_failed(claim, f"Unexpected error: {exc}")
        return

    db = SessionLocal()
    try:
        document = db.scalar(
            select(Document)
            .where(
                Document.id == document_id,
                Document.status == "processing",
                Document.processing_started_at == claim.started_at,
            )
            .with_for_update()
        )
        if not document:
            return

        # A stale job may be reclaimed after a worker restart. Replacing chunks
        # keeps processing idempotent if a previous attempt reached this stage.
        db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
        db.add_all(
            [
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embedding=embedding,
                    page_number=chunk.page_number,
                    citation_label=chunk.citation_label,
                )
                for chunk, embedding in zip(chunks, embeddings, strict=True)
            ]
        )
        document.status = "ready"
        document.error_message = None
        document.processing_started_at = None
        document.updated_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - persist worker failures
        db.rollback()
        _mark_document_failed(claim, f"Document persistence failed: {exc}")
    finally:
        db.close()


def _mark_document_failed(claim: WorkerClaim, message: str) -> None:
    db = SessionLocal()
    try:
        document = db.scalar(
            select(Document)
            .where(
                Document.id == claim.job_id,
                Document.status == "processing",
                Document.processing_started_at == claim.started_at,
            )
            .with_for_update()
        )
        if not document:
            return
        document.status = "failed"
        document.error_message = message[:MAX_ERROR_LENGTH]
        document.processing_started_at = None
        document.updated_at = datetime.now(UTC)
        db.commit()
    finally:
        db.close()


def list_user_documents(
    db: Session,
    user_id: str,
    *,
    limit: int = 100,
    offset: int = 0,
) -> list[tuple[Document, int]]:
    chunk_count = func.count(DocumentChunk.id).label("chunk_count")
    stmt = (
        select(Document, chunk_count)
        .outerjoin(DocumentChunk)
        .where(document_access_filter(user_id))
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [(document, count) for document, count in db.execute(stmt).all()]


def get_user_document(db: Session, user_id: str, document_id: str) -> tuple[Document, int] | None:
    chunk_count = func.count(DocumentChunk.id).label("chunk_count")
    stmt = (
        select(Document, chunk_count)
        .outerjoin(DocumentChunk)
        .where(Document.id == document_id, document_access_filter(user_id))
        .group_by(Document.id)
    )
    row = db.execute(stmt).one_or_none()
    if not row:
        return None
    document, count = row
    return document, count


def get_document_full_text(
    db: Session,
    *,
    user_id: str,
    document_id: str,
    max_chars: int = 100_000,
) -> tuple[Document, str] | None:
    """Return the document and its full extracted text (joined chunks).

    Truncates at `max_chars` to keep the LLM context manageable. Access
    is granted to the document owner OR to any member of the document's
    matter — matches the KB visibility model, so a lawyer on a matter can
    let the agent quote from a document a teammate uploaded.
    """
    document = db.scalar(
        select(Document).where(
            Document.id == document_id,
            document_access_filter(user_id),
        )
    )
    if not document:
        return None

    chunks = list(
        db.scalars(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document.id)
            .order_by(DocumentChunk.chunk_index)
        )
    )
    if not chunks:
        return document, ""

    parts: list[str] = []
    running = 0
    truncated = False
    for chunk in chunks:
        block = chunk.text
        if running + len(block) > max_chars:
            remaining = max_chars - running
            if remaining > 0:
                parts.append(block[:remaining])
            truncated = True
            break
        parts.append(block)
        running += len(block)

    body = "\n\n".join(parts)
    if truncated:
        body += "\n\n[Document truncated — call again with a more specific question or rely on the KB summary.]"
    return document, body


def rename_user_document(
    db: Session,
    *,
    user_id: str,
    document_id: str,
    filename: str,
) -> Document | None:
    document = db.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == user_id,
        )
    )
    if not document:
        return None

    requested_name = Path(filename).name.strip()
    if not requested_name:
        raise ValueError("Filename is required")

    current_suffix = Path(document.filename).suffix.lower()
    requested_suffix = Path(requested_name).suffix.lower()
    if not requested_suffix:
        requested_name = f"{requested_name}{current_suffix}"
    elif current_suffix and requested_suffix != current_suffix:
        raise ValueError(f"Filename must keep the {current_suffix} extension")
    if len(requested_name) > 255:
        raise ValueError("Filename must be 255 characters or fewer")

    document.filename = requested_name
    document.updated_at = datetime.now(UTC)
    chunks = list(
        db.scalars(
            select(DocumentChunk).where(DocumentChunk.document_id == document.id)
        )
    )
    for chunk in chunks:
        chunk.citation_label = make_citation_label(
            requested_name,
            chunk.page_number,
            chunk.chunk_index,
        )
    db.commit()
    db.refresh(document)
    return document


def delete_user_document(db: Session, user_id: str, document_id: str) -> bool:
    document = db.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.user_id == user_id,
        )
    )
    if not document:
        return False

    storage_key = document.storage_key
    db.delete(document)
    db.commit()

    try:
        delete_document_file(storage_key)
    except StorageError as exc:
        print(f"Document storage delete skipped: {exc}")

    return True
