import shutil
import unittest
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.pdfgen import canvas

from app.services.review_pdf_export_service import (
    render_annotated_pdf,
    view_to_user,
)

HAS_POPPLER = shutil.which("pdftoppm") is not None


def _source_pdf(*, width=400, height=600, rotation=0, cropbox=None, pages=1) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    for _ in range(pages):
        c.setFont("Helvetica", 12)
        c.drawString(60, 540, "Hello reviewer")
        c.showPage()
    c.save()
    reader = PdfReader(BytesIO(buf.getvalue()))
    writer = PdfWriter()
    for page in reader.pages:
        if rotation:
            page.rotate(rotation)
        if cropbox:
            page.cropbox = RectangleObject(cropbox)
        writer.add_page(page)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def _ann(kind="highlight", rects=(), *, quote="Hello", suggested=None, note=None,
         status="open", page_no=1, offset=0, ann_id="a"):
    return SimpleNamespace(
        id=ann_id,
        kind=kind,
        anchor_rects=[dict(r) for r in rects],
        anchor_quote=quote,
        suggested_text=suggested,
        note=note,
        status=status,
        page_no=page_no,
        created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=offset),
    )


def _rect(page_index, left, top, width, height):
    return {"pageIndex": page_index, "left": left, "top": top, "width": width, "height": height}


def _render_pixel(pdf_bytes: bytes, page_index: int, x: float, y: float):
    from pdf2image import convert_from_bytes

    # use_cropbox: render what a viewer shows (the CropBox), not the MediaBox.
    image = convert_from_bytes(
        pdf_bytes, dpi=72, first_page=page_index + 1, last_page=page_index + 1, use_cropbox=True
    )[0]
    return image.convert("RGB").getpixel((int(x), int(y))), image.size


def _is_yellowish(px) -> bool:
    r, g, b = px
    return r > 200 and g > 160 and b < 200 and (r - b) > 40


class GeometryTests(unittest.TestCase):
    """view_to_user maps a point in the rendered (rotated, cropped) view, expressed
    top-down in points, to absolute PDF user-space coordinates."""

    crop = (50.0, 50.0, 350.0, 550.0)  # 300 x 500 visible area, offset origin

    def test_rotation_0_top_left_of_view_is_top_left_of_cropbox(self):
        self.assertEqual(view_to_user(0, 0, rotation=0, cropbox=self.crop), (50.0, 550.0))
        self.assertEqual(view_to_user(300, 500, rotation=0, cropbox=self.crop), (350.0, 50.0))

    def test_rotation_90_top_left_of_view_is_bottom_left_of_cropbox(self):
        # 90° clockwise display: view is 500 wide x 300 tall.
        self.assertEqual(view_to_user(0, 0, rotation=90, cropbox=self.crop), (50.0, 50.0))
        self.assertEqual(view_to_user(500, 0, rotation=90, cropbox=self.crop), (50.0, 550.0))

    def test_rotation_180_top_left_of_view_is_bottom_right_of_cropbox(self):
        self.assertEqual(view_to_user(0, 0, rotation=180, cropbox=self.crop), (350.0, 50.0))

    def test_rotation_270_top_left_of_view_is_top_right_of_cropbox(self):
        self.assertEqual(view_to_user(0, 0, rotation=270, cropbox=self.crop), (350.0, 550.0))
        self.assertEqual(view_to_user(500, 300, rotation=270, cropbox=self.crop), (50.0, 50.0))


class DrawOnceTests(unittest.TestCase):
    def test_multiline_mark_is_drawn_once_per_rectangle(self):
        rects = [_rect(0, 10, 10 + i * 5, 50, 3) for i in range(3)]
        pdf = render_annotated_pdf(_source_pdf(), [_ann(rects=rects)])
        page = PdfReader(BytesIO(pdf)).pages[0]
        content = page.get_contents().get_data()
        # One *filled* rectangle per rectangle, not N^2 (the page clip is `re W n`).
        self.assertEqual(content.count(b" re\nf"), 3, content)


@unittest.skipUnless(HAS_POPPLER, "pdftoppm not installed")
class RenderedFidelityTests(unittest.TestCase):
    """Render the export with poppler and sample the pixel under each mark."""

    def _assert_mark_at(self, pdf, *, page_index, cx, cy, view_size):
        px, size = _render_pixel(pdf, page_index, cx, cy)
        self.assertEqual(size, view_size, "rendered page size should match rotated view")
        self.assertTrue(_is_yellowish(px), f"expected highlight at ({cx},{cy}), got {px}")
        far, _ = _render_pixel(pdf, page_index, size[0] - 5, size[1] - 5)
        self.assertEqual(far, (255, 255, 255))

    def test_rotation_0(self):
        rect = _rect(0, left=25, top=10, width=50, height=5)  # view 400x600
        pdf = render_annotated_pdf(_source_pdf(), [_ann(rects=[rect])])
        self._assert_mark_at(pdf, page_index=0, cx=200, cy=75, view_size=(400, 600))

    def test_rotation_90(self):
        rect = _rect(0, left=25, top=10, width=50, height=5)  # view 600x400
        pdf = render_annotated_pdf(_source_pdf(rotation=90), [_ann(rects=[rect])])
        self._assert_mark_at(pdf, page_index=0, cx=300, cy=50, view_size=(600, 400))

    def test_rotation_180(self):
        rect = _rect(0, left=25, top=10, width=50, height=5)
        pdf = render_annotated_pdf(_source_pdf(rotation=180), [_ann(rects=[rect])])
        self._assert_mark_at(pdf, page_index=0, cx=200, cy=75, view_size=(400, 600))

    def test_rotation_270(self):
        rect = _rect(0, left=25, top=10, width=50, height=5)
        pdf = render_annotated_pdf(_source_pdf(rotation=270), [_ann(rects=[rect])])
        self._assert_mark_at(pdf, page_index=0, cx=300, cy=50, view_size=(600, 400))

    def test_cropped_page_uses_cropbox_origin(self):
        crop = (50, 50, 350, 550)  # view 300x500
        rect = _rect(0, left=10, top=10, width=40, height=6)
        pdf = render_annotated_pdf(_source_pdf(cropbox=crop), [_ann(rects=[rect])])
        self._assert_mark_at(pdf, page_index=0, cx=90, cy=65, view_size=(300, 500))

    def test_cropped_and_rotated(self):
        crop = (50, 50, 350, 550)  # rotated 90 -> view 500x300
        rect = _rect(0, left=10, top=10, width=40, height=6)
        pdf = render_annotated_pdf(_source_pdf(rotation=90, cropbox=crop), [_ann(rects=[rect])])
        self._assert_mark_at(pdf, page_index=0, cx=150, cy=39, view_size=(500, 300))

    def test_mixed_page_sizes(self):
        # Page 1: 400x600, page 2: 600x400 (landscape by MediaBox, no /Rotate).
        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=(400, 600)); c.showPage()
        c.setPageSize((600, 400)); c.showPage(); c.save()
        rect = _rect(1, left=25, top=10, width=50, height=5)
        pdf = render_annotated_pdf(buf.getvalue(), [_ann(rects=[rect], page_no=2)])
        self._assert_mark_at(pdf, page_index=1, cx=300, cy=50, view_size=(600, 400))


class NotesAppendixTests(unittest.TestCase):
    def _notes_text(self, pdf: bytes) -> str:
        reader = PdfReader(BytesIO(pdf))
        return "".join(p.extract_text() for p in reader.pages[1:])

    def test_long_text_and_unicode_survive_without_truncation(self):
        clause = ("The Supplier shall indemnify the Customer — including its affiliates — "
                  "against all losses arising from a breach of clause 12 (Confidentialité). ") * 4
        suggested = "Each party shall indemnify the other against third-party claims. " * 5
        ann = _ann("suggestion", [_rect(0, 10, 10, 50, 3)], quote=clause, suggested=suggested,
                   note="Mutual indemnity is our standard position — see précédent.")
        text = self._notes_text(render_annotated_pdf(_source_pdf(), [ann]))
        squashed = "".join(text.split())
        for expected in (clause, suggested, "précédent", "—"):
            self.assertIn("".join(expected.split()), squashed)

    def test_highlight_and_strike_notes_are_included_with_page_refs(self):
        anns = [
            _ann("highlight", [_rect(0, 10, 10, 50, 3)], note="Check defined term.", ann_id="h"),
            _ann("strike", [_rect(1, 10, 10, 50, 3)], note="Delete: duplicated in 4.2.", page_no=2, offset=1, ann_id="s"),
        ]
        text = self._notes_text(render_annotated_pdf(_source_pdf(pages=2), anns))
        self.assertIn("Check defined term.", text)
        self.assertIn("Delete: duplicated in 4.2.", text)
        self.assertIn("p. 1", text)
        self.assertIn("p. 2", text)

    def test_statuses_distinguish_rejected_from_accepted(self):
        anns = [
            _ann("suggestion", [_rect(0, 10, 10, 50, 3)], suggested="A", status="resolved", ann_id="ok"),
            _ann("suggestion", [_rect(0, 10, 20, 50, 3)], suggested="B", status="rejected", offset=1, ann_id="no"),
        ]
        text = self._notes_text(render_annotated_pdf(_source_pdf(), anns))
        self.assertIn("Accepted", text)
        self.assertIn("Rejected", text)

    def test_callouts_are_numbered_stably_by_page_then_time(self):
        anns = [
            _ann("suggestion", [_rect(1, 10, 10, 50, 3)], suggested="second", page_no=2, offset=0, ann_id="b"),
            _ann("suggestion", [_rect(0, 10, 10, 50, 3)], suggested="first", page_no=1, offset=5, ann_id="a"),
        ]
        text = self._notes_text(render_annotated_pdf(_source_pdf(pages=2), anns))
        self.assertLess(text.index("first"), text.index("second"))
        self.assertIn("1.", text)
        self.assertIn("2.", text)

    def test_no_notes_page_when_nothing_to_say(self):
        pdf = render_annotated_pdf(_source_pdf(), [_ann(rects=[_rect(0, 10, 10, 50, 3)])])
        self.assertEqual(len(PdfReader(BytesIO(pdf)).pages), 1)


if __name__ == "__main__":
    unittest.main()
