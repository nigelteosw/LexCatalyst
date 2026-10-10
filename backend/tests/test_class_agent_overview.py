import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import postgresql

from app.services.agent_tools import _matter_overview


class ClassAgentOverviewTests(unittest.TestCase):
    def test_ticket_and_review_counts_stay_in_current_team(self) -> None:
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        user = SimpleNamespace(id="u")
        with patch("app.services.agent_tools.list_matters", return_value=[]), patch(
            "app.services.agent_tools.require_class_context",
            return_value=SimpleNamespace(class_id="team-a"),
        ):
            _matter_overview(db, user)
        statements = [str(call.args[0].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for call in db.execute.call_args_list]
        self.assertIn("action_items.class_id = 'team-a'", statements[0])
        self.assertIn("review_handoffs.class_id = 'team-a'", statements[1])
