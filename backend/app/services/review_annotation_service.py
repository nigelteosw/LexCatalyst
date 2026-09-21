"""Review Annotation service.

Annotations are text-anchored marks (highlight / strike / suggestion) that
a senior reviewer places on a junior's uploaded PDF.  See
docs/plans/pdf-redlining-review.md §6.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    KnowledgeBankEntry,
    ReviewAnnotation,
    ReviewAnnotationReply,
    ReviewHandoff,
    User,
)
from app.services.review_handoff_service import lock_active_handoff
from app.schemas import (
    KnowledgeBankEntryCreate,
    ReviewAnnotationCreate,
    ReviewAnnotationPromoteRequest,
    ReviewAnnotationUpdate,
)

MAX_NOTE = 10_000
MAX_BODY = 10_000


class ReviewAnnotationError(RuntimeError):
    pass


def _annotation_query():
    return select(ReviewAnnotation).options(
        joinedload(ReviewAnnotation.author),
        joinedload(ReviewAnnotation.replies).joinedload(ReviewAnnotationReply.author),
    )


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------


def list_annotations(
    db: Session, *, handoff_id: str
) -> list[ReviewAnnotation]:
    stmt = (
        _annotation_query()
        .where(ReviewAnnotation.handoff_id == handoff_id)
        .order_by(ReviewAnnotation.page_no, ReviewAnnotation.created_at)
    )
    return list(db.scalars(stmt).unique())


def get_annotation(db: Session, annotation_id: str) -> ReviewAnnotation | None:
    return db.scalar(
        _annotation_query().where(ReviewAnnotation.id == annotation_id)
    )


def create_annotation(
    db: Session,
    *,
    handoff: ReviewHandoff,
    user: User,
    schema: ReviewAnnotationCreate,
) -> ReviewAnnotation:
    lock_active_handoff(db, handoff.id)
    annotation = ReviewAnnotation(
        handoff_id=handoff.id,
        document_id=handoff.document_id,
        page_no=schema.page_no,
        kind=schema.kind,
        anchor_quote=schema.anchor_quote,
        anchor_rects=schema.anchor_rects,
        suggested_text=schema.suggested_text,
        note=schema.note,
        author_user_id=user.id,
        status="open",
    )
    db.add(annotation)

    # Flip handoff to in_review on first reviewer mark
    if handoff.status == "ready_for_review":
        handoff.status = "in_review"

    db.commit()
    db.refresh(annotation)
    return get_annotation(db, annotation.id)  # type: ignore[return-value]


def update_annotation(
    db: Session,
    *,
    annotation: ReviewAnnotation,
    schema: ReviewAnnotationUpdate,
) -> ReviewAnnotation:
    lock_active_handoff(db, annotation.handoff_id)
    payload = schema.model_dump(exclude_unset=True)
    for field, value in payload.items():
        setattr(annotation, field, value)
    annotation.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(annotation)
    return get_annotation(db, annotation.id)  # type: ignore[return-value]


def delete_annotation(db: Session, annotation: ReviewAnnotation) -> None:
    lock_active_handoff(db, annotation.handoff_id)
    db.delete(annotation)
    db.commit()


# ---------------------------------------------------------------------------
# Replies
# ---------------------------------------------------------------------------


def list_replies(
    db: Session, *, annotation_id: str
) -> list[ReviewAnnotationReply]:
    stmt = (
        select(ReviewAnnotationReply)
        .options(joinedload(ReviewAnnotationReply.author))
        .where(ReviewAnnotationReply.annotation_id == annotation_id)
        .order_by(ReviewAnnotationReply.created_at)
    )
    return list(db.scalars(stmt).unique())


def post_reply(
    db: Session,
    *,
    annotation: ReviewAnnotation,
    user: User,
    body_markdown: str,
) -> ReviewAnnotationReply:
    if not body_markdown.strip():
        raise ReviewAnnotationError("Reply body cannot be empty")
    reply = ReviewAnnotationReply(
        annotation_id=annotation.id,
        author_user_id=user.id,
        body_markdown=body_markdown[:MAX_BODY],
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


def delete_reply(
    db: Session, *, reply: ReviewAnnotationReply, user: User
) -> None:
    if reply.author_user_id != user.id:
        raise ReviewAnnotationError("Only the author can delete their reply")
    db.delete(reply)
    db.commit()


# ---------------------------------------------------------------------------
# KB promotion
# ---------------------------------------------------------------------------


async def promote_annotation_to_kb(
    db: Session,
    *,
    annotation: ReviewAnnotation,
    handoff: ReviewHandoff,
    user: User,
    schema: ReviewAnnotationPromoteRequest,
) -> KnowledgeBankEntry:
    from app.services import knowledge_bank_service as kb

    if annotation.promoted_kb_entry_id:
        raise ReviewAnnotationError("This annotation has already been promoted")

    # Build body_markdown from annotation content
    parts: list[str] = []
    wording = annotation.suggested_text or annotation.anchor_quote
    if wording:
        parts.append(f"## Standard position\n\n{wording.strip()}")
    if annotation.note:
        parts.append(f"## Reasoning\n\n{annotation.note.strip()}")
    if annotation.anchor_quote and annotation.suggested_text:
        parts.append(
            "## Example clause (counter-example)\n\n> "
            + annotation.anchor_quote.strip().replace("\n", "\n> ")
        )
    body_markdown = "\n\n".join(parts) or "(empty)"

    title = schema.title or (
        (annotation.note or annotation.anchor_quote or "Promoted annotation").split(".")[0][:120]
    )

    kb_schema = KnowledgeBankEntryCreate(
        team_id=None,
        matter_id=handoff.matter_id if schema.target_scope == "matter" else None,
        scope=schema.target_scope,
        entry_type=schema.entry_type,
        title=title,
        body_markdown=body_markdown,
        tags=schema.tags,
    )

    if schema.target_scope == "matter":
        # Stays inside the matter's access boundary; no redaction needed.
        entry = await kb.create_kb_entry(db, user=user, schema=kb_schema)
    else:
        # Wider scopes must pass PII review before readers/search see the content.
        entry, _ = await kb.create_pending_review_entry(
            db, user=user, schema=kb_schema, source_matter_id=handoff.matter_id
        )
    annotation.promoted_kb_entry_id = entry.id
    annotation.updated_at = datetime.now(UTC)
    db.commit()
    return entry


# ---------------------------------------------------------------------------
# Flattened PDF export
# ---------------------------------------------------------------------------


def export_flattened_pdf(db: Session, *, handoff: ReviewHandoff) -> bytes:
    """Stamp annotations onto the handoff's source PDF and return the bytes.

    Coordinate notes
    ----------------
    anchor_rects are stored as HighlightArea objects from @react-pdf-viewer:
        { pageIndex (int, 0-based), left, top, width, height  (all %) }

    pypdf gives us page dimensions in default user units (1/72 inch).
    reportlab also uses those units with Y=0 at the bottom-left.

    Conversion for a rect on a page of width W, height H (pts):
        x      = left   / 100 * W
        y_top  = top    / 100 * H          (from top in pdf.js space)
        h_pts  = height / 100 * H
        w_pts  = width  / 100 * W
        rl_y   = H - y_top - h_pts         (flip to reportlab bottom-left origin)
    """
    from io import BytesIO

    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas

    from app.services.storage_service import StorageError, download_document_file

    if not handoff.document or not handoff.document.storage_key:
        raise RuntimeError("Source document has no storage key")

    src_bytes = download_document_file(handoff.document.storage_key)
    reader = PdfReader(BytesIO(src_bytes))
    writer = PdfWriter()

    # Group annotations by page index
    annotations_by_page: dict[int, list[ReviewAnnotation]] = {}
    for ann in handoff.annotations:
        for rect in ann.anchor_rects:
            pi = rect.get("pageIndex", 0)
            annotations_by_page.setdefault(pi, []).append(ann)

    for page_idx in range(len(reader.pages)):
        page = reader.pages[page_idx]
        W_raw = float(page.mediabox.width)
        H_raw = float(page.mediabox.height)

        # /Rotate swaps the visible orientation; 90° and 270° flip W↔H.
        rotation = int(page.get("/Rotate", 0)) % 360
        if rotation in (90, 270):
            W, H = H_raw, W_raw
        else:
            W, H = W_raw, H_raw

        # Build an overlay page with reportlab
        overlay_buf = BytesIO()
        c = canvas.Canvas(overlay_buf, pagesize=(W, H))
        c.setLineWidth(0)

        page_anns = annotations_by_page.get(page_idx, [])
        for ann in page_anns:
            for rect in ann.anchor_rects:
                if rect.get("pageIndex", 0) != page_idx:
                    continue
                x = rect["left"] / 100 * W
                y_top = rect["top"] / 100 * H
                w_pts = rect["width"] / 100 * W
                h_pts = rect["height"] / 100 * H
                rl_y = H - y_top - h_pts

                if ann.kind == "highlight":
                    c.setFillColor(Color(1, 0.85, 0, alpha=0.35))
                    c.setStrokeColor(Color(1, 0.85, 0, alpha=0))
                    c.rect(x, rl_y, w_pts, h_pts, fill=1, stroke=0)

                elif ann.kind == "strike":
                    c.setStrokeColor(Color(0.9, 0.1, 0.1, alpha=0.8))
                    c.setLineWidth(1.2)
                    mid_y = rl_y + h_pts / 2
                    c.line(x, mid_y, x + w_pts, mid_y)
                    c.setLineWidth(0)

                elif ann.kind == "suggestion":
                    # Strike original
                    c.setStrokeColor(Color(0.2, 0.5, 1, alpha=0.7))
                    c.setLineWidth(1.2)
                    mid_y = rl_y + h_pts / 2
                    c.line(x, mid_y, x + w_pts, mid_y)
                    c.setLineWidth(0)
                    # Light blue tint
                    c.setFillColor(Color(0.2, 0.5, 1, alpha=0.12))
                    c.rect(x, rl_y, w_pts, h_pts, fill=1, stroke=0)

        c.save()
        overlay_buf.seek(0)

        # Merge overlay onto the source page
        overlay_reader = PdfReader(overlay_buf)
        if overlay_reader.pages:
            page.merge_page(overlay_reader.pages[0])

        writer.add_page(page)

    # Append a "Reviewer notes" appendix for suggestion callouts
    suggestion_anns = [a for a in handoff.annotations if a.kind == "suggestion" and (a.suggested_text or a.note)]
    if suggestion_anns:
        _append_notes_page(writer, suggestion_anns)

    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def _append_notes_page(writer: "PdfWriter", suggestions: list[ReviewAnnotation]) -> None:  # type: ignore[name-defined]
    """Append a plain-text appendix listing suggestion callouts."""
    from io import BytesIO

    from pypdf import PdfReader
    from reportlab.lib.colors import black, Color
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    W, H = A4
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, H - 50, "Reviewer notes")
    c.setLineWidth(0.5)
    c.setStrokeColor(Color(0, 0, 0, alpha=0.2))
    c.line(40, H - 58, W - 40, H - 58)

    y = H - 78
    for i, ann in enumerate(suggestions, 1):
        if y < 80:
            c.showPage()
            y = H - 50
        c.setFont("Helvetica-Bold", 9)
        c.setFillColor(black)
        c.drawString(40, y, f"{i}. {ann.anchor_quote[:80]}{'…' if len(ann.anchor_quote) > 80 else ''}")
        y -= 14
        if ann.suggested_text:
            c.setFont("Helvetica", 9)
            c.setFillColor(Color(0.2, 0.5, 1))
            c.drawString(52, y, f"→ {ann.suggested_text[:100]}{'…' if len(ann.suggested_text) > 100 else ''}")
            y -= 14
        if ann.note:
            c.setFont("Helvetica-Oblique", 8)
            c.setFillColor(Color(0.3, 0.3, 0.3))
            c.drawString(52, y, ann.note[:120])
            y -= 18
        else:
            y -= 4

    c.save()
    buf.seek(0)
    from pypdf import PdfReader
    notes_reader = PdfReader(buf)
    for page in notes_reader.pages:
        writer.add_page(page)
