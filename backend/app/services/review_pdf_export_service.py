"""Flattened PDF export for review handoffs.

Pure rendering lives in :func:`render_annotated_pdf` so it can be exercised with
synthetic fixtures; :func:`export_flattened_pdf` only adds storage loading.

Coordinate model
----------------
``anchor_rects`` are HighlightArea objects from @react-pdf-viewer, expressed as
percentages of the *rendered* page — i.e. the CropBox, after ``/Rotate`` has
been applied — with a top-down Y axis::

    { pageIndex (0-based), left, top, width, height }   (all %)

To draw on the source page we convert each view-space point back to absolute
PDF user space via :func:`view_to_user`, then merge a reportlab overlay whose
content stream is written in that same user space.  Every annotation kind goes
through the same transform, so rotated and cropped pages behave alike.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from io import BytesIO
from typing import Protocol

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.models import ReviewHandoff


class AnnotationLike(Protocol):
    id: str
    kind: str
    anchor_rects: list[dict]
    anchor_quote: str
    suggested_text: str | None
    note: str | None
    status: str
    page_no: int
    created_at: object


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 in user space


def view_to_user(
    x: float, y: float, *, rotation: int, cropbox: Box
) -> tuple[float, float]:
    """Map a point in the rendered view (top-down, points) to PDF user space.

    The view is the CropBox rotated clockwise by ``rotation`` degrees, which is
    how pdf.js (and every other viewer) displays the page.
    """
    cx0, cy0, cx1, cy1 = cropbox
    cw, ch = cx1 - cx0, cy1 - cy0
    rotation %= 360
    if rotation == 0:
        u, v = x, ch - y
    elif rotation == 90:
        u, v = y, x
    elif rotation == 180:
        u, v = cw - x, y
    elif rotation == 270:
        u, v = cw - y, ch - x
    else:
        raise ValueError(f"Unsupported page rotation: {rotation}")
    return cx0 + u, cy0 + v


@dataclass(frozen=True)
class _PageGeometry:
    rotation: int
    cropbox: Box
    view_w: float
    view_h: float

    @classmethod
    def of(cls, page) -> "_PageGeometry":
        rotation = int(page.get("/Rotate", 0)) % 360
        cb = page.cropbox
        cropbox = (float(cb.left), float(cb.bottom), float(cb.right), float(cb.top))
        cw, ch = cropbox[2] - cropbox[0], cropbox[3] - cropbox[1]
        if rotation in (90, 270):
            return cls(rotation, cropbox, ch, cw)
        return cls(rotation, cropbox, cw, ch)

    def point(self, px: float, py: float) -> tuple[float, float]:
        """Percent view coordinates -> user space."""
        return view_to_user(
            px / 100 * self.view_w,
            py / 100 * self.view_h,
            rotation=self.rotation,
            cropbox=self.cropbox,
        )

    def bbox(self, rect: dict) -> Box:
        left, top = float(rect["left"]), float(rect["top"])
        right, bottom = left + float(rect["width"]), top + float(rect["height"])
        (ax, ay), (bx, by) = self.point(left, top), self.point(right, bottom)
        return min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)

    def midline(self, rect: dict) -> tuple[tuple[float, float], tuple[float, float]]:
        """Endpoints of a strike line through the rect, along the text direction."""
        left, top = float(rect["left"]), float(rect["top"])
        mid = top + float(rect["height"]) / 2
        return self.point(left, mid), self.point(left + float(rect["width"]), mid)


# ---------------------------------------------------------------------------
# Styling
# ---------------------------------------------------------------------------

_HIGHLIGHT = Color(1, 0.85, 0, alpha=0.35)
_STRIKE = Color(0.9, 0.1, 0.1, alpha=0.8)
_SUGGEST = Color(0.2, 0.5, 1, alpha=0.7)
_SUGGEST_TINT = Color(0.2, 0.5, 1, alpha=0.12)
_REJECTED = Color(0.55, 0.55, 0.55, alpha=0.6)
_REJECTED_TINT = Color(0.55, 0.55, 0.55, alpha=0.1)

STATUS_LABELS = {
    "open": "Open",
    "needs_rework": "Needs rework",
    "resolved": "Accepted",
    "rejected": "Rejected",
}
KIND_LABELS = {"highlight": "Highlight", "strike": "Strike", "suggestion": "Suggestion"}


def _ordered(annotations: Iterable[AnnotationLike]) -> list[AnnotationLike]:
    """Stable callout numbering: by page, then creation time, then id."""
    return sorted(annotations, key=lambda a: (a.page_no, str(a.created_at), a.id))


def _has_callout(a: AnnotationLike) -> bool:
    return bool((a.kind == "suggestion" and a.suggested_text) or a.note)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_annotated_pdf(src_bytes: bytes, annotations: Sequence[AnnotationLike]) -> bytes:
    """Stamp ``annotations`` onto ``src_bytes`` and append a reviewer-notes appendix."""
    reader = PdfReader(BytesIO(src_bytes))
    writer = PdfWriter()

    ordered = _ordered(annotations)
    numbers = {a.id: i for i, a in enumerate(ordered, 1)}

    # One (annotation, rect) pair per rectangle, grouped by page. Never N^2.
    by_page: dict[int, list[tuple[AnnotationLike, dict]]] = {}
    for ann in ordered:
        for rect in ann.anchor_rects:
            by_page.setdefault(int(rect.get("pageIndex", 0)), []).append((ann, rect))

    for page_idx, page in enumerate(reader.pages):
        pairs = by_page.get(page_idx, [])
        if pairs:
            page.merge_page(_overlay_for(page, pairs, numbers))
        writer.add_page(page)

    callouts = [a for a in ordered if _has_callout(a)]
    if callouts:
        for notes_page in PdfReader(BytesIO(_notes_pdf(callouts, numbers))).pages:
            writer.add_page(notes_page)

    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def _overlay_for(page, pairs: list[tuple[AnnotationLike, dict]], numbers: dict[str, int]):
    geom = _PageGeometry.of(page)
    mb = page.mediabox
    buf = BytesIO()
    # The overlay's content stream is merged verbatim into the page's user
    # space, so we draw at absolute coordinates; pagesize only sizes the box.
    c = canvas.Canvas(buf, pagesize=(float(mb.width), float(mb.height)))
    c.setLineWidth(0)

    labelled: set[str] = set()
    for ann, rect in pairs:
        rejected = ann.status == "rejected"
        x0, y0, x1, y1 = geom.bbox(rect)
        w, h = x1 - x0, y1 - y0

        if ann.kind == "highlight":
            c.setFillColor(_REJECTED_TINT if rejected else _HIGHLIGHT)
            c.rect(x0, y0, w, h, fill=1, stroke=0)
        elif ann.kind == "strike":
            (ax, ay), (bx, by) = geom.midline(rect)
            c.setStrokeColor(_REJECTED if rejected else _STRIKE)
            c.setLineWidth(1.2)
            c.line(ax, ay, bx, by)
            c.setLineWidth(0)
        elif ann.kind == "suggestion":
            (ax, ay), (bx, by) = geom.midline(rect)
            c.setStrokeColor(_REJECTED if rejected else _SUGGEST)
            c.setLineWidth(1.2)
            c.line(ax, ay, bx, by)
            c.setLineWidth(0)
            c.setFillColor(_REJECTED_TINT if rejected else _SUGGEST_TINT)
            c.rect(x0, y0, w, h, fill=1, stroke=0)

        # Number the first rectangle of any annotation that has an appendix entry.
        if ann.id not in labelled and _has_callout(ann):
            labelled.add(ann.id)
            _draw_label(c, geom, rect, numbers[ann.id])

    c.save()
    buf.seek(0)
    return PdfReader(buf).pages[0]


def _draw_label(c: canvas.Canvas, geom: _PageGeometry, rect: dict, number: int) -> None:
    """Small numbered tag just left of the mark, kept upright on rotated pages."""
    left, top = float(rect["left"]), float(rect["top"])
    x, y = geom.point(left, top)
    c.saveState()
    c.translate(x, y)
    c.rotate(geom.rotation)  # cancel the display rotation so text reads upright
    c.setFillColor(Color(0.2, 0.5, 1, alpha=0.9))
    c.roundRect(-14, -1, 12, 9, 2, fill=1, stroke=0)
    c.setFillColor(Color(1, 1, 1))
    c.setFont("Helvetica-Bold", 6.5)
    c.drawCentredString(-8, 1, str(number))
    c.restoreState()


def _notes_pdf(callouts: list[AnnotationLike], numbers: dict[str, int]) -> bytes:
    """Appendix listing every annotation with a note or suggestion, fully wrapped."""
    W, H = A4
    margin, indent = 40.0, 52.0
    text_w = W - margin - indent
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = H - 50.0

    def header() -> None:
        nonlocal y
        c.setFont("Helvetica-Bold", 11)
        c.setFillColor(black)
        c.drawString(margin, y, "Reviewer notes")
        c.setLineWidth(0.5)
        c.setStrokeColor(Color(0, 0, 0, alpha=0.2))
        c.line(margin, y - 8, W - margin, y - 8)
        y -= 28

    def ensure(space: float) -> None:
        nonlocal y
        if y - space < 60:
            c.showPage()
            y = H - 50.0
            header()

    def paragraph(text: str, *, font: str, size: float, color: Color, x: float, width: float) -> None:
        nonlocal y
        c.setFont(font, size)
        c.setFillColor(color)
        for line in simpleSplit(text, font, size, width):
            ensure(size + 3)
            c.drawString(x, y, line)
            y -= size + 3

    header()
    for ann in callouts:
        n = numbers[ann.id]
        status = STATUS_LABELS.get(ann.status, ann.status)
        kind = KIND_LABELS.get(ann.kind, ann.kind)
        ensure(40)
        paragraph(
            f"{n}. {kind} · p. {ann.page_no} · {status}",
            font="Helvetica-Bold", size=9, color=black, x=margin, width=W - 2 * margin,
        )
        if ann.anchor_quote:
            paragraph(
                f"“{ann.anchor_quote}”",
                font="Helvetica-Oblique", size=8.5, color=Color(0.35, 0.35, 0.35),
                x=indent, width=text_w,
            )
        if ann.kind == "suggestion" and ann.suggested_text:
            verb = "Rejected suggestion" if ann.status == "rejected" else "Replace with"
            paragraph(
                f"{verb}: {ann.suggested_text}",
                font="Helvetica", size=9,
                color=Color(0.55, 0.55, 0.55) if ann.status == "rejected" else Color(0.2, 0.5, 1),
                x=indent, width=text_w,
            )
        if ann.note:
            paragraph(ann.note, font="Helvetica", size=8.5, color=Color(0.25, 0.25, 0.25), x=indent, width=text_w)
        y -= 8

    c.save()
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Storage-backed entry point
# ---------------------------------------------------------------------------


def export_flattened_pdf(db: Session, *, handoff: ReviewHandoff) -> bytes:
    """Load the handoff's source PDF from storage and render its annotations."""
    from app.services.storage_service import download_document_file

    if not handoff.document or not handoff.document.storage_key:
        raise RuntimeError("Source document has no storage key")
    src_bytes = download_document_file(handoff.document.storage_key)
    return render_annotated_pdf(src_bytes, list(handoff.annotations))
