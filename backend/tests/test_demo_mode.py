import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.routers import demo
from app.schemas import AnchorRect, KnowledgeBankEntryCreate
from app.services import demo_seed_service as seed
from app.services.demo_pdfs import DISCLOSURE_BLOCKS, NDA_BLOCKS, SPA_BLOCKS, DemoPdf


def _user(uid="u1", *, admin=False, google_id="google-1"):
    return SimpleNamespace(
        id=uid,
        email=f"{uid}@x.test",
        full_name=uid,
        firm_role="associate",
        is_admin=admin,
        google_id=google_id,
    )


def _settings(demo_mode: bool):
    return SimpleNamespace(demo_mode=demo_mode)


class DemoGuardTests(unittest.TestCase):
    def test_404_when_demo_mode_off(self) -> None:
        with patch.object(demo, "get_settings", return_value=_settings(False)):
            with self.assertRaises(HTTPException) as raised:
                demo.require_demo_admin(_user(admin=True))
        self.assertEqual(raised.exception.status_code, 404)

    def test_404_for_non_admin(self) -> None:
        with patch.object(demo, "get_settings", return_value=_settings(True)):
            with self.assertRaises(HTTPException) as raised:
                demo.require_demo_admin(_user(admin=False))
        self.assertEqual(raised.exception.status_code, 404)

    def test_admin_allowed_in_demo_mode(self) -> None:
        admin = _user(admin=True)
        with patch.object(demo, "get_settings", return_value=_settings(True)):
            self.assertIs(demo.require_demo_admin(admin), admin)


class DemoSwitchTests(unittest.TestCase):
    def _switch(self, target):
        db = MagicMock()
        db.get.return_value = target
        return demo.demo_switch(demo.SwitchRequest(user_id="t"), db=db, _admin=_user(admin=True))

    def test_switches_into_dummy_user(self) -> None:
        with patch.object(demo, "create_access_token", return_value="tok") as make:
            result = self._switch(_user("jane", google_id="dummy:jane-pereira"))
        self.assertEqual(result["access_token"], "tok")
        self.assertEqual(make.call_args.args[0], {"sub": "jane"})

    def test_cannot_switch_into_real_user(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self._switch(_user("real", google_id="google-oauth-123"))
        self.assertEqual(raised.exception.status_code, 404)

    def test_unknown_user_is_404(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self._switch(None)
        self.assertEqual(raised.exception.status_code, 404)


class DemoRoleTests(unittest.TestCase):
    def _set_role(self, user, role, *, demo_mode=True):
        db = MagicMock()
        with (
            patch.object(demo, "get_settings", return_value=_settings(demo_mode)),
            patch.object(demo, "update_user_role", return_value=user) as update,
        ):
            result = demo.set_demo_role(demo.RoleRequest(firm_role=role), db=db, current_user=user)
        return result, update

    def test_404_when_demo_mode_off(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self._set_role(_user(), "partner", demo_mode=False)
        self.assertEqual(raised.exception.status_code, 404)

    def test_seeded_dummy_users_keep_their_roles(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            self._set_role(_user("jane", google_id="dummy:jane-pereira"), "partner")
        self.assertEqual(raised.exception.status_code, 404)

    def test_any_real_user_can_mimic_a_role(self) -> None:
        user = _user(admin=False)
        result, update = self._set_role(user, "senior_associate")
        self.assertEqual(update.call_args.kwargs["firm_role"], "senior_associate")
        self.assertIs(update.call_args.kwargs["user"], user)
        self.assertEqual(result["id"], user.id)

    def test_admin_can_return_to_admin(self) -> None:
        _result, update = self._set_role(_user(admin=False), "admin")
        self.assertEqual(update.call_args.kwargs["firm_role"], "admin")

    def test_rejects_unknown_role(self) -> None:
        with self.assertRaises(ValueError):
            demo.RoleRequest(firm_role="intern")


class DemoAdminSyncTests(unittest.TestCase):
    def test_login_promotes_real_users_to_admin_in_demo_mode(self) -> None:
        from app import auth

        db = MagicMock()
        existing = SimpleNamespace(is_admin=False, firm_role="associate", email="a@x.test")
        db.query.return_value.filter.return_value.first.return_value = existing
        info = {"sub": "g1", "email": "a@x.test"}
        with (
            patch.object(auth, "get_settings", return_value=SimpleNamespace(demo_mode=True, admin_emails=[])),
            patch.object(auth, "ensure_default_team"),
        ):
            user = auth.get_or_create_user(db, info)
        self.assertTrue(user.is_admin)
        self.assertEqual(user.firm_role, "partner")

    def test_login_unchanged_outside_demo_mode(self) -> None:
        from app import auth

        db = MagicMock()
        existing = SimpleNamespace(is_admin=False, firm_role="associate", email="a@x.test")
        db.query.return_value.filter.return_value.first.return_value = existing
        with (
            patch.object(auth, "get_settings", return_value=SimpleNamespace(demo_mode=False, admin_emails=[])),
            patch.object(auth, "ensure_default_team"),
        ):
            user = auth.get_or_create_user(db, {"sub": "g1", "email": "a@x.test"})
        self.assertFalse(user.is_admin)


class SeedContentTests(unittest.TestCase):
    def test_review_feedback_anchors_pass_rect_validation(self) -> None:
        pdf = DemoPdf(NDA_BLOCKS)
        for quote, kind, _suggested, note, status in seed.NDA_FEEDBACK:
            page_no, rects = pdf.anchor(quote)
            self.assertGreaterEqual(page_no, 1)
            self.assertTrue(rects)
            for rect in rects:
                AnchorRect.model_validate(rect)
            self.assertIn(kind, {"highlight", "strike", "suggestion"})
            self.assertTrue(note)
            self.assertIn(status, {"open", "needs_rework"})

    def test_round_one_has_a_needs_rework_comment(self) -> None:
        self.assertTrue(any(f[4] == "needs_rework" for f in seed.NDA_FEEDBACK))

    def test_demo_script_quotes_exist_in_spa(self) -> None:
        pdf = DemoPdf(SPA_BLOCKS)
        pdf.anchor("the Basket Amount shall be deducted from any claim")
        pdf.anchor("laws of the State of New York")

    def test_generated_pdfs_are_valid(self) -> None:
        for blocks in (NDA_BLOCKS, SPA_BLOCKS, DISCLOSURE_BLOCKS):
            self.assertTrue(DemoPdf(blocks).bytes.startswith(b"%PDF"))

    def test_kb_entries_are_valid_schema(self) -> None:
        for scope, entry_type, title, body, tags in seed.KB_ENTRIES:
            KnowledgeBankEntryCreate(
                scope=scope,
                entry_type=entry_type,
                title=title,
                body_markdown=body,
                tags=[*tags, seed.DEMO_TAG],
                matter_id="m" if scope == "matter" else None,
            )

    def test_tickets_cover_every_status_and_include_review_ticket(self) -> None:
        statuses = {t[2] for t in seed.TICKETS}
        self.assertEqual(statuses, {"pending", "in_progress", "review", "done"})
        self.assertIn(seed.SPA_TICKET, {t[0] for t in seed.TICKETS})


if __name__ == "__main__":
    unittest.main()
