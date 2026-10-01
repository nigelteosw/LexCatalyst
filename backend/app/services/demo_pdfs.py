"""Synthetic demo PDFs with known text positions, so seeded highlights sit on the real text.

Everything here is invented demo content; no real client or matter data.
"""

import io
from dataclasses import dataclass

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = A4
MARGIN = 56
BODY_FONT, BODY_SIZE, LEADING = "Helvetica", 10.5, 17
HEAD_FONT, HEAD_SIZE = "Helvetica-Bold", 11.5
TITLE_SIZE = 15


@dataclass
class _Line:
    page_index: int
    x: float
    baseline: float
    size: float
    font: str
    text: str


class DemoPdf:
    def __init__(self, blocks: list[tuple[str, str]]) -> None:
        """blocks: ("title" | "heading" | "para", text)."""
        self.lines: list[_Line] = []
        self.bytes = self._render(blocks)

    def _render(self, blocks: list[tuple[str, str]]) -> bytes:
        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        page_index, y = 0, PAGE_H - MARGIN
        width = PAGE_W - 2 * MARGIN
        for kind, text in blocks:
            font, size = (
                (HEAD_FONT, TITLE_SIZE)
                if kind == "title"
                else (HEAD_FONT, HEAD_SIZE)
                if kind == "heading"
                else (BODY_FONT, BODY_SIZE)
            )
            wrapped = simpleSplit(text, font, size, width)
            needed = len(wrapped) * LEADING + (10 if kind != "para" else 4)
            if y - needed < MARGIN:
                pdf.showPage()
                page_index, y = page_index + 1, PAGE_H - MARGIN
            if kind != "para":
                y -= 6
            for line in wrapped:
                pdf.setFont(font, size)
                pdf.drawString(MARGIN, y, line)
                self.lines.append(_Line(page_index, MARGIN, y, size, font, line))
                y -= LEADING
            y -= 4
        pdf.save()
        return buffer.getvalue()

    def anchor(self, quote: str) -> tuple[int, list[dict]]:
        """Return (1-based page number, rects as page percentages) for ``quote``.

        The quote may wrap across lines; one rect is produced per line fragment. Raises
        ValueError when the quote is not in the document.
        """
        for page_index in sorted({l.page_index for l in self.lines}):
            page_lines = [l for l in self.lines if l.page_index == page_index]
            joined, starts = "", []
            for line in page_lines:
                starts.append(len(joined))
                joined += line.text + " "
            at = joined.find(quote)
            if at == -1:
                continue
            end = at + len(quote)
            rects: list[dict] = []
            for line, start in zip(page_lines, starts):
                lo, hi = max(at, start), min(end, start + len(line.text))
                if lo >= hi:
                    continue
                prefix = line.text[: lo - start]
                fragment = line.text[lo - start : hi - start]
                x0 = line.x + stringWidth(prefix, line.font, line.size)
                w = stringWidth(fragment, line.font, line.size)
                rects.append(
                    {
                        "pageIndex": page_index,
                        "left": round(x0 / PAGE_W * 100, 3),
                        "top": round((PAGE_H - line.baseline - line.size * 0.82) / PAGE_H * 100, 3),
                        "width": round(w / PAGE_W * 100, 3),
                        "height": round(line.size * 1.2 / PAGE_H * 100, 3),
                    }
                )
            return page_index + 1, rects
        raise ValueError(f"Quote not found in demo PDF: {quote!r}")


NDA_BLOCKS = [
    ("title", "Mutual Non-Disclosure Agreement"),
    ("para", "Between Meridian Capital Ltd (the Disclosing Party) and Oaktree Holdings Ltd (the Receiving Party). Synthetic demo document."),
    ("heading", "1. Definitions"),
    ("para", "Confidential Information means all non-public information, in any form, disclosed by the Disclosing Party to the Receiving Party in connection with the Purpose."),
    ("para", "Purpose means the evaluation of a potential acquisition of shares in Oaktree Holdings Ltd by Meridian Capital Ltd."),
    ("heading", "2. Obligations of the Receiving Party"),
    ("para", "The Receiving Party shall keep all Proprietary Information strictly confidential and shall use it solely for the Purpose."),
    ("para", "The parties hereby agree and do hereby acknowledge that the Receiving Party shall not disclose Confidential Information to any third party without prior written consent."),
    ("heading", "3. Term"),
    ("para", "The obligations in this Agreement continue for two years from the date of last disclosure."),
    ("heading", "4. Indemnity"),
    ("para", "The Receiving Party shall indemnify the Disclosing Party against all losses arising from any breach of this Agreement, without limit."),
    ("heading", "5. Return of Information"),
    ("para", "On written request the Receiving Party shall promptly return or destroy all Confidential Information and confirm in writing that it has done so."),
    ("heading", "6. Governing Law"),
    ("para", "This Agreement shall be governed by and construed in accordance with the laws of the State of New York."),
]

SPA_BLOCKS = [
    ("title", "Share Purchase Agreement (Extract)"),
    ("para", "Between Meridian Capital Ltd (the Buyer) and the Sellers named in Schedule 1. Synthetic demo document."),
    ("heading", "4. Warranties"),
    ("para", "The Sellers warrant to the Buyer that the Disclosure Letter fairly discloses all matters that are material to the Business as at the date of this Agreement."),
    ("heading", "7. Indemnities and Limitations"),
    ("para", "The Sellers are liable only for Losses in excess of the Basket Amount of GBP 50,000, and the Basket Amount shall be deducted from any claim."),
    ("para", "The total liability of the Sellers under this Agreement shall not exceed the Purchase Price."),
    ("heading", "12. Governing Law"),
    ("para", "This Agreement is governed by the laws of the State of New York, and the parties submit to the courts of New York."),
]

DISCLOSURE_BLOCKS = [
    ("title", "Disclosure Letter (Extract)"),
    ("para", "From the Sellers to Meridian Capital Ltd. Synthetic demo document."),
    ("heading", "Schedule 1: General Disclosures"),
    ("para", "The Company is party to a supply agreement with Harbour Logistics Ltd that may be terminated on ninety days' notice."),
    ("para", "One employee grievance was raised in March and resolved informally without any payment."),
    ("heading", "Schedule 2: Litigation"),
    ("para", "No material litigation is pending or, to the Sellers' knowledge, threatened against the Company."),
]
