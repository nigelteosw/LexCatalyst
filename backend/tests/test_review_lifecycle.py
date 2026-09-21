import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.schemas import ReviewAnnotationCreate
from app.services import review_handoff_service as rhs
from app.services.review_annotation_service import create_annotation
from app.services.review_handoff_service import (
    ReviewHandoffError,
    assert_transition,
    is_handoff_active,
    reject_handoff,
    return_handoff_for_rework,
    update_handoff_status,
)


def _handoff(status: str, *, action_id="action"):
    return SimpleNamespace(
        id="round-1",
        status=status,
        action_id=action_id,
        reviewer_id="senior",
        completed_at=None,
        return_reason=None,
    )


class TransitionRuleTests(unittest.TestCase):
    def test_active_statuses(self) -> None:
        self.assertTrue(is_handoff_active(_handoff("ready_for_review")))
        self.assertTrue(is_handoff_active(_handoff("in_review")))
        self.assertFalse(is_handoff_active(_handoff("completed")))
        self.assertFalse(is_handoff_active(_handoff("returned")))

    def test_forward_transitions_allowed(self) -> None:
        assert_transition(_handoff("ready_for_review"), "in_review")
        assert_transition(_handoff("ready_for_review"), "completed")
        assert_transition(_handoff("in_review"), "completed")
        assert_transition(_handoff("in_review"), "returned")

    def test_same_status_is_a_noop(self) -> None:
        assert_transition(_handoff("in_review"), "in_review")
        assert_transition(_handoff("completed"), "completed")

    def test_terminal_rounds_cannot_transition(self) -> None:
        for terminal in ("completed", "returned"):
            for target in ("ready_for_review", "in_review", "completed", "returned"):
                if target == terminal:
                    continue
                with self.assertRaises(ReviewHandoffError, msg=f"{terminal}->{target}"):
                    assert_transition(_handoff(terminal), target)

    def test_cannot_move_backwards_to_ready(self) -> None:
        with self.assertRaises(ReviewHandoffError):
            assert_transition(_handoff("in_review"), "ready_for_review")

    def test_unknown_status_rejected(self) -> None:
        with self.assertRaises(ReviewHandoffError):
            assert_transition(_handoff("in_review"), "archived")


def _db_with_locked(handoff, action=None):
    db = MagicMock()
    db.scalar.return_value = handoff  # locked row fetch
    db.get.return_value = action
    return db


class OldRoundCannotResetNewerRoundTests(unittest.TestCase):
    """Returning or rejecting a round that is no longer the action's active
    handoff must not change the action."""

    def setUp(self) -> None:
        self._sync = patch.object(rhs, "sync_metadata_safe")
        self._sync.start()
        self.addCleanup(self._sync.stop)
        self._get = patch.object(rhs, "get_handoff", side_effect=lambda _db, _id: _id)
        self._get.start()
        self.addCleanup(self._get.stop)

    def test_return_on_old_round_leaves_action_alone(self) -> None:
        old = _handoff("in_review")
        action = SimpleNamespace(active_handoff_id="round-2", status="review")
        db = _db_with_locked(old, action)

        return_handoff_for_rework(db, old.id)

        self.assertEqual(old.status, "returned")
        self.assertEqual(action.status, "review")
        self.assertEqual(action.active_handoff_id, "round-2")

    def test_return_on_current_round_updates_action(self) -> None:
        current = _handoff("in_review")
        action = SimpleNamespace(active_handoff_id="round-1", status="review")
        db = _db_with_locked(current, action)

        return_handoff_for_rework(db, current.id)

        self.assertEqual(action.status, "in_progress")

    def test_reject_on_old_round_leaves_action_alone(self) -> None:
        old = _handoff("in_review")
        action = SimpleNamespace(active_handoff_id="round-2", status="review")
        db = _db_with_locked(old, action)

        reject_handoff(db, handoff_id=old.id, reason="stale")

        self.assertEqual(old.status, "returned")
        self.assertEqual(old.return_reason, "stale")
        self.assertEqual(action.active_handoff_id, "round-2")
        self.assertEqual(action.status, "review")

    def test_return_on_terminal_round_is_rejected(self) -> None:
        done = _handoff("completed")
        db = _db_with_locked(done, None)
        with self.assertRaises(ReviewHandoffError):
            return_handoff_for_rework(db, done.id)

    def test_status_update_on_terminal_round_is_rejected(self) -> None:
        done = _handoff("returned")
        db = _db_with_locked(done, None)
        with self.assertRaises(ReviewHandoffError):
            update_handoff_status(db, handoff_id=done.id, status="in_review")


class ClosedRoundAnnotationTests(unittest.TestCase):
    def test_cannot_annotate_completed_round(self) -> None:
        handoff = SimpleNamespace(id="round-1", document_id="doc", status="completed")
        db = _db_with_locked(handoff)
        schema = ReviewAnnotationCreate(
            document_id="doc", page_no=1, kind="highlight", anchor_quote="x"
        )
        with self.assertRaises(ReviewHandoffError):
            create_annotation(
                db, handoff=handoff, user=SimpleNamespace(id="senior"), schema=schema
            )
        db.add.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class RouterLifecycleTests(unittest.TestCase):
    def test_response_can_annotate_is_false_on_closed_round(self) -> None:
        from datetime import UTC, datetime

        from app.routers.review_handoffs import _serialise_handoff

        now = datetime.now(UTC)
        base = dict(
            id="h", action_id=None, matter_id=None, document_id="d",
            submitted_by="junior", submitted_at=now, reviewer_id="senior",
            completed_at=None, return_reason=None, error_message=None,
            created_at=now, updated_at=now, submitter=None, reviewer=None,
            annotations=[], document=None,
        )
        senior = SimpleNamespace(id="senior", firm_role="associate", is_admin=False)
        db = MagicMock(); db.get.return_value = None

        active = _serialise_handoff(SimpleNamespace(status="in_review", **base), db=db, user=senior)
        self.assertTrue(active.can_annotate)
        closed = _serialise_handoff(SimpleNamespace(status="completed", **base), db=db, user=senior)
        self.assertTrue(closed.can_review)
        self.assertFalse(closed.can_annotate)

    def test_annotation_on_closed_round_returns_409(self) -> None:
        from fastapi import HTTPException

        from app.routers import review_handoffs as router

        handoff = SimpleNamespace(id="h", document_id="d", status="completed", action_id=None, reviewer_id="senior")
        db = MagicMock(); db.scalar.return_value = handoff; db.get.return_value = None
        senior = SimpleNamespace(id="senior", firm_role="partner", is_admin=False)
        schema = ReviewAnnotationCreate(document_id="d", page_no=1, kind="highlight", anchor_quote="x")
        with (
            patch.object(router, "get_handoff", return_value=handoff),
            patch.object(router, "require_handoff_access"),
        ):
            with self.assertRaises(HTTPException) as raised:
                router.post_annotation("h", schema, db, senior)
        self.assertEqual(raised.exception.status_code, 409)


class ResubmitTests(unittest.TestCase):
    def _db(self, *, previous_status: str):
        from app.models import ActionItem, Document, ReviewHandoff

        document = SimpleNamespace(id="doc-2", user_id="junior", matter_id=None)
        action = SimpleNamespace(
            id="action", assignee_id="junior", assigner_id="senior",
            matter_id=None, active_handoff_id="round-1", status="in_progress",
        )
        previous = _handoff(previous_status)
        by_type = {Document: document, ActionItem: action, ReviewHandoff: previous}
        db = MagicMock()
        db.get.side_effect = lambda model, _id: by_type.get(model)
        db.scalar.return_value = None
        return db, action

    def test_new_round_refused_while_previous_is_active(self) -> None:
        db, _ = self._db(previous_status="in_review")
        schema = SimpleNamespace(document_id="doc-2", matter_id=None, action_id="action", reviewer_id=None)
        with self.assertRaises(ReviewHandoffError):
            rhs.create_handoff(db, user=SimpleNamespace(id="junior", is_admin=False), schema=schema)
        db.add.assert_not_called()

    def test_new_round_allowed_after_return(self) -> None:
        db, action = self._db(previous_status="returned")
        schema = SimpleNamespace(document_id="doc-2", matter_id=None, action_id="action", reviewer_id=None)
        with (
            patch.object(rhs, "_carry_forward_annotations") as carry,
            patch.object(rhs, "sync_metadata_safe"),
        ):
            handoff = rhs.create_handoff(db, user=SimpleNamespace(id="junior", is_admin=False), schema=schema)
        carry.assert_called_once()
        self.assertEqual(action.active_handoff_id, handoff.id)
        self.assertEqual(action.status, "review")
