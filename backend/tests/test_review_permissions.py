import unittest
from types import SimpleNamespace
import unittest.mock
from unittest.mock import MagicMock

from fastapi import HTTPException

from app.services.review_handoff_service import (
    can_remove_handoff,
    can_review_handoff,
    require_handoff_removal,
    require_reviewer,
)


def _user(uid: str, *, firm_role: str = "associate", is_admin: bool = False):
    return SimpleNamespace(id=uid, firm_role=firm_role, is_admin=is_admin)


def _handoff(*, submitted_by="junior", reviewer_id="senior", action_id="action"):
    return SimpleNamespace(
        id="handoff",
        submitted_by=submitted_by,
        reviewer_id=reviewer_id,
        action_id=action_id,
    )


def _db(action=None):
    db = MagicMock()
    db.get.return_value = action
    return db


class ReviewerCapabilityTests(unittest.TestCase):
    def test_submitter_who_is_a_matter_member_cannot_review(self) -> None:
        db = _db(action=SimpleNamespace(assigner_id="senior"))
        self.assertFalse(can_review_handoff(db, user=_user("junior"), handoff=_handoff()))

    def test_assigned_reviewer_can_review(self) -> None:
        db = _db(action=SimpleNamespace(assigner_id="someone-else"))
        self.assertTrue(can_review_handoff(db, user=_user("senior"), handoff=_handoff()))

    def test_action_assigner_can_review(self) -> None:
        db = _db(action=SimpleNamespace(assigner_id="assigner"))
        self.assertTrue(can_review_handoff(db, user=_user("assigner"), handoff=_handoff()))

    def test_partner_and_senior_associate_can_review(self) -> None:
        db = _db(action=None)
        handoff = _handoff(action_id=None)
        self.assertTrue(
            can_review_handoff(db, user=_user("p", firm_role="partner"), handoff=handoff)
        )
        self.assertTrue(
            can_review_handoff(
                db, user=_user("s", firm_role="senior_associate"), handoff=handoff
            )
        )
        self.assertFalse(
            can_review_handoff(db, user=_user("a", firm_role="associate"), handoff=handoff)
        )

    def test_admin_can_review(self) -> None:
        db = _db(action=None)
        self.assertTrue(
            can_review_handoff(db, user=_user("x", is_admin=True), handoff=_handoff())
        )

    def test_require_reviewer_raises_403_for_non_reviewer(self) -> None:
        db = _db(action=SimpleNamespace(assigner_id="senior"))
        with self.assertRaises(HTTPException) as raised:
            require_reviewer(db, user=_user("junior"), handoff=_handoff())
        self.assertEqual(raised.exception.status_code, 403)

    def test_require_reviewer_passes_for_reviewer(self) -> None:
        db = _db(action=None)
        require_reviewer(db, user=_user("senior"), handoff=_handoff())


class RemovalCapabilityTests(unittest.TestCase):
    def test_submitter_can_remove_own_handoff(self) -> None:
        db = _db(action=None)
        self.assertTrue(can_remove_handoff(db, user=_user("junior"), handoff=_handoff()))

    def test_reviewer_can_remove_handoff(self) -> None:
        db = _db(action=None)
        self.assertTrue(can_remove_handoff(db, user=_user("senior"), handoff=_handoff()))

    def test_unrelated_member_cannot_remove_handoff(self) -> None:
        db = _db(action=SimpleNamespace(assigner_id="senior"))
        self.assertFalse(can_remove_handoff(db, user=_user("member"), handoff=_handoff()))

    def test_require_handoff_removal_raises_403(self) -> None:
        db = _db(action=SimpleNamespace(assigner_id="senior"))
        with self.assertRaises(HTTPException) as raised:
            require_handoff_removal(db, user=_user("member"), handoff=_handoff())
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()


class RouterEnforcementTests(unittest.TestCase):
    """A submitter (who has read access) must not be able to perform reviewer
    mutations by calling the route handlers directly."""

    def setUp(self) -> None:
        from app.routers import review_handoffs as router

        self.router = router
        self.junior = _user("junior")
        self.handoff = _handoff()
        self.db = _db(action=SimpleNamespace(assigner_id="senior"))
        # Read access passes; only the reviewer capability should block.
        self._patches = [
            unittest.mock.patch.object(router, "get_handoff", return_value=self.handoff),
            unittest.mock.patch.object(router, "require_handoff_access"),
            unittest.mock.patch.object(
                router, "get_annotation", return_value=SimpleNamespace(handoff_id="handoff")
            ),
        ]
        for p in self._patches:
            p.start()
            self.addCleanup(p.stop)

    def _assert_403(self, fn, *args, **kwargs):
        with self.assertRaises(HTTPException) as raised:
            fn(*args, **kwargs)
        self.assertEqual(raised.exception.status_code, 403)

    def test_submitter_cannot_change_status(self) -> None:
        schema = SimpleNamespace(status="completed", reviewer_id=None)
        self._assert_403(self.router.patch_handoff, "handoff", schema, self.db, self.junior)

    def test_submitter_cannot_reject(self) -> None:
        schema = SimpleNamespace(reason="no")
        self._assert_403(
            self.router.post_reject_handoff, "handoff", schema, self.db, self.junior
        )

    def test_unrelated_member_cannot_delete_handoff(self) -> None:
        self._assert_403(self.router.remove_handoff, "handoff", self.db, _user("member"))

    def test_submitter_cannot_create_annotation(self) -> None:
        schema = SimpleNamespace()
        self._assert_403(
            self.router.post_annotation, "handoff", schema, self.db, self.junior
        )

    def test_submitter_cannot_update_annotation(self) -> None:
        schema = SimpleNamespace()
        self._assert_403(
            self.router.patch_annotation, "handoff", "ann", schema, self.db, self.junior
        )

    def test_submitter_cannot_delete_annotation(self) -> None:
        self._assert_403(
            self.router.remove_annotation, "handoff", "ann", self.db, self.junior
        )


class HandoffResponseCapabilityTests(unittest.TestCase):
    def test_response_carries_viewer_capabilities(self) -> None:
        from datetime import UTC, datetime

        from app.routers.review_handoffs import _serialise_handoff

        now = datetime.now(UTC)
        handoff = SimpleNamespace(
            id="handoff",
            action_id=None,
            matter_id=None,
            document_id="doc",
            submitted_by="junior",
            submitted_at=now,
            status="in_review",
            reviewer_id="senior",
            completed_at=None,
            return_reason=None,
            error_message=None,
            created_at=now,
            updated_at=now,
            submitter=None,
            reviewer=None,
            annotations=[],
            document=None,
        )
        db = _db(action=None)

        as_junior = _serialise_handoff(handoff, db=db, user=_user("junior"))
        self.assertFalse(as_junior.can_review)
        self.assertTrue(as_junior.can_remove)

        as_senior = _serialise_handoff(handoff, db=db, user=_user("senior"))
        self.assertTrue(as_senior.can_review)
        self.assertTrue(as_senior.can_remove)

        as_member = _serialise_handoff(handoff, db=db, user=_user("member"))
        self.assertFalse(as_member.can_review)
        self.assertFalse(as_member.can_remove)
