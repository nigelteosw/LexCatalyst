import unittest
from types import SimpleNamespace
import unittest.mock
from unittest.mock import MagicMock

from app.models import ReviewAnnotation
from app.schemas import ReviewAnnotationUpdate
from app.services.review_handoff_service import _carry_forward_annotations


class CarryForwardTests(unittest.TestCase):
    def _run(self):
        old = SimpleNamespace(
            id="old-ann",
            page_no=3,
            kind="suggest",
            anchor_quote="the Supplier shall",
            anchor_rects=[{"pageIndex": 2, "left": 10, "top": 20, "width": 30, "height": 4}],
            suggested_text="the Customer shall",
            note="Wrong party.",
            author_user_id="senior",
            replies=[],
        )
        db = MagicMock()
        db.scalars.return_value.unique.return_value = [old]
        added: list = []
        db.add.side_effect = added.append
        new_handoff = SimpleNamespace(id="round-2", document_id="doc-2")
        _carry_forward_annotations(db, prev_handoff_id="round-1", new_handoff=new_handoff)
        carried = [a for a in added if isinstance(a, ReviewAnnotation)]
        self.assertEqual(len(carried), 1)
        return old, carried[0]

    def test_carried_annotation_has_no_overlay_coordinates(self) -> None:
        _, new = self._run()
        self.assertEqual(new.anchor_rects, [])

    def test_carried_annotation_keeps_context_and_link(self) -> None:
        old, new = self._run()
        self.assertEqual(new.previous_annotation_id, old.id)
        self.assertEqual(new.anchor_quote, old.anchor_quote)
        self.assertEqual(new.suggested_text, old.suggested_text)
        self.assertEqual(new.note, old.note)
        self.assertEqual(new.page_no, old.page_no)  # hint only; no rects
        self.assertEqual(new.status, "open")
        self.assertEqual(new.document_id, "doc-2")


class ReanchorTests(unittest.TestCase):
    def test_update_schema_accepts_explicit_reanchor(self) -> None:
        schema = ReviewAnnotationUpdate(
            page_no=4,
            anchor_rects=[{"pageIndex": 3, "left": 1, "top": 2, "width": 3, "height": 4}],
        )
        payload = schema.model_dump(exclude_unset=True)
        self.assertEqual(payload["page_no"], 4)
        self.assertEqual(len(payload["anchor_rects"]), 1)


if __name__ == "__main__":
    unittest.main()


class ReplyHistoryTests(unittest.TestCase):
    def test_replies_stay_on_original_annotation(self) -> None:
        reply = SimpleNamespace(annotation_id="old-ann")
        old = SimpleNamespace(
            id="old-ann", page_no=1, kind="highlight", anchor_quote="q",
            anchor_rects=[], suggested_text=None, note=None,
            author_user_id="senior", replies=[reply],
        )
        db = MagicMock()
        db.scalars.return_value.unique.return_value = [old]
        _carry_forward_annotations(
            db, prev_handoff_id="round-1",
            new_handoff=SimpleNamespace(id="round-2", document_id="doc-2"),
        )
        self.assertEqual(reply.annotation_id, "old-ann")

    def test_history_walks_chain_and_checks_access(self) -> None:
        from fastapi import HTTPException

        from app.services.review_annotation_service import get_annotation_history

        oldest = SimpleNamespace(id="a0", handoff_id="h0", previous_annotation_id=None, replies=["r0"])
        middle = SimpleNamespace(id="a1", handoff_id="h1", previous_annotation_id="a0", replies=["r1"])
        current = SimpleNamespace(id="a2", handoff_id="h2", previous_annotation_id="a1", replies=[])
        by_id = {"a0": oldest, "a1": middle}
        db = MagicMock()
        user = SimpleNamespace(id="u", is_admin=False)

        with (
            unittest.mock.patch(
                "app.services.review_annotation_service.get_annotation",
                side_effect=lambda _db, aid: by_id.get(aid),
            ),
            unittest.mock.patch(
                "app.services.review_annotation_service.get_handoff",
                side_effect=lambda _db, hid: SimpleNamespace(id=hid),
            ),
            unittest.mock.patch(
                "app.services.review_annotation_service.require_handoff_access"
            ) as access,
        ):
            history = get_annotation_history(db, user=user, annotation=current)
            self.assertEqual([a.id for a in history], ["a1", "a0"])  # newest first
            self.assertEqual(access.call_count, 2)

            access.side_effect = HTTPException(status_code=403)
            self.assertEqual(get_annotation_history(db, user=user, annotation=current), [])
