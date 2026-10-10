import math
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from app.schemas import AnchorRect, ReviewAnnotationCreate, ReviewAnnotationUpdate
from app.services.review_handoff_service import ReviewHandoffError, create_handoff


def _rect(**overrides):
    base = {"pageIndex": 0, "left": 10.0, "top": 20.0, "width": 30.0, "height": 4.0}
    base.update(overrides)
    return base


def _create(**overrides):
    payload = {
        "document_id": "doc",
        "page_no": 1,
        "kind": "highlight",
        "anchor_quote": "text",
        "anchor_rects": [_rect()],
    }
    payload.update(overrides)
    return ReviewAnnotationCreate(**payload)


class AnchorRectSchemaTests(unittest.TestCase):
    def test_round_trips_camel_case_wire_format(self) -> None:
        rect = AnchorRect.model_validate(_rect())
        self.assertEqual(rect.page_index, 0)
        self.assertEqual(rect.model_dump(by_alias=True)["pageIndex"], 0)

    def test_missing_key_rejected(self) -> None:
        bad = _rect(); del bad["height"]
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[bad])

    def test_empty_rects_rejected_on_create(self) -> None:
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[])

    def test_negative_page_index_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[_rect(pageIndex=-1)])

    def test_non_finite_rejected(self) -> None:
        for bad in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValidationError, msg=repr(bad)):
                _create(anchor_rects=[_rect(left=bad)])

    def test_out_of_bounds_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[_rect(left=101)])
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[_rect(top=-0.1)])
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[_rect(left=90, width=20)])  # extends past the page

    def test_zero_size_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            _create(anchor_rects=[_rect(width=0)])

    def test_cross_page_rects_survive(self) -> None:
        created = _create(anchor_rects=[_rect(pageIndex=0), _rect(pageIndex=1, top=0)])
        dumped = [r.model_dump(by_alias=True) for r in created.anchor_rects]
        self.assertEqual([r["pageIndex"] for r in dumped], [0, 1])


class AnnotationUpdateTests(unittest.TestCase):
    def test_explicit_null_status_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            ReviewAnnotationUpdate.model_validate({"status": None})

    def test_omitted_status_is_fine(self) -> None:
        upd = ReviewAnnotationUpdate.model_validate({"note": "x"})
        self.assertEqual(upd.model_dump(exclude_unset=True), {"note": "x"})

    def test_reanchor_requires_non_empty_rects(self) -> None:
        with self.assertRaises(ValidationError):
            ReviewAnnotationUpdate.model_validate({"anchor_rects": []})
        with self.assertRaises(ValidationError):
            ReviewAnnotationUpdate.model_validate({"anchor_rects": None})


class HandoffEligibilityTests(unittest.TestCase):
    def _db(self, document):
        db = MagicMock()
        db.get.return_value = document
        db.scalar.return_value = None
        return db

    def _schema(self):
        return SimpleNamespace(document_id="doc", matter_id=None, action_id=None, reviewer_id=None)

    def test_docx_cannot_enter_review(self) -> None:
        doc = SimpleNamespace(
            id="doc", class_id="class-a", user_id="u", matter_id=None, filename="draft.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            storage_key="k", status="ready",
        )
        with patch("app.services.review_handoff_service.require_active_class_id", return_value="class-a"):
            with self.assertRaises(ReviewHandoffError):
                create_handoff(self._db(doc), user=SimpleNamespace(id="u", is_admin=False), schema=self._schema())

    def test_pdf_without_stored_file_cannot_enter_review(self) -> None:
        doc = SimpleNamespace(
            id="doc", class_id="class-a", user_id="u", matter_id=None, filename="draft.pdf",
            content_type="application/pdf", storage_key=None, status="uploaded",
        )
        with patch("app.services.review_handoff_service.require_active_class_id", return_value="class-a"):
            with self.assertRaises(ReviewHandoffError):
                create_handoff(self._db(doc), user=SimpleNamespace(id="u", is_admin=False), schema=self._schema())

    def test_pdf_still_extracting_is_allowed(self) -> None:
        from unittest.mock import patch

        from app.services import review_handoff_service as rhs

        doc = SimpleNamespace(
            id="doc", class_id="class-a", user_id="u", matter_id=None, filename="draft.pdf",
            content_type="application/pdf", storage_key="k", status="processing",
        )
        with patch.object(rhs, "sync_metadata_safe"), patch.object(rhs, "require_active_class_id", return_value="class-a"):
            handoff = create_handoff(self._db(doc), user=SimpleNamespace(id="u", is_admin=False), schema=self._schema())
        self.assertEqual(handoff.document_id, "doc")


if __name__ == "__main__":
    unittest.main()
