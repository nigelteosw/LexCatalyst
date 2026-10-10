import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import postgresql

from app.schemas import ActionItemUpdate
from app.services.action_service import list_action_items, update_action_item


class ClassActionTests(unittest.TestCase):
    def test_board_list_is_filtered_to_active_team(self) -> None:
        db = MagicMock()
        user = SimpleNamespace(id="u", is_admin=False, firm_role="associate")
        with patch("app.services.action_service.require_class_context", return_value=SimpleNamespace(class_id="team-a")):
            list_action_items(db, user=user)
        stmt = db.scalars.call_args.args[0]
        sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
        self.assertIn("action_items.class_id = 'team-a'", sql)

    def test_partner_cannot_update_ticket_in_other_team(self) -> None:
        db = MagicMock()
        user = SimpleNamespace(id="u", is_admin=True, firm_role="partner")
        db.get.return_value = SimpleNamespace(id="foreign", class_id="team-b", assignee_id=None, assigner_id="other")
        with patch("app.services.action_service.require_class_context", return_value=SimpleNamespace(class_id="team-a")):
            result = update_action_item(db, user=user, item_id="foreign", schema=ActionItemUpdate(status="done"))
        self.assertIsNone(result)
        db.commit.assert_not_called()
