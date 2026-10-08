import asyncio
import json
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import agent_service, agent_tools, birdie_service


def _names(tools):
    return [t["function"]["name"] for t in tools]


class SharedToolListTests(unittest.TestCase):
    def test_lexchat_and_birdie_offer_the_same_tools(self) -> None:
        self.assertIs(agent_service.TOOLS, agent_tools.TOOLS)
        self.assertIs(birdie_service.TOOLS, agent_tools.TOOLS)

    def test_tool_names_are_unique_and_cover_work_and_documents(self) -> None:
        names = _names(agent_tools.TOOLS)
        self.assertEqual(len(names), len(set(names)))
        for expected in (
            "list_workboard_tickets", "get_workboard_progress", "create_workboard_ticket",
            "find_documents", "read_document", "list_matters", "search_documents",
            "search_knowledge_bank", "search_memories", "get_kb_entry", "search_elitigation",
        ):
            self.assertIn(expected, names)

    def test_every_tool_is_handled_somewhere(self) -> None:
        handled = agent_tools.SHARED_TOOL_NAMES | {"search_elitigation"}
        self.assertEqual(set(_names(agent_tools.TOOLS)), handled)

    def test_birdie_prompt_uses_the_shared_workboard_rules(self) -> None:
        self.assertIn(agent_tools.WORKBOARD_RULES, birdie_service.BIRDIE_SYSTEM_PROMPT)


class MatterOverviewTests(unittest.TestCase):
    def test_overdue_first_then_reviews_then_next_due(self) -> None:
        soon = datetime(2026, 10, 12, tzinfo=UTC)
        later = soon + timedelta(days=30)
        matters = [
            SimpleNamespace(id="calm", title="Calm", case_number="C-1"),
            SimpleNamespace(id="late", title="Late", case_number="L-1"),
            SimpleNamespace(id="soon", title="Soon", case_number="S-1"),
            SimpleNamespace(id="review", title="Review", case_number="R-1"),
        ]
        overview = agent_tools.build_matter_overview(
            matters,
            [("calm", 1, 0, later, 0), ("late", 3, 2, soon, 1), ("soon", 1, 0, soon, 0), (None, 1, 0, None, 0)],
            [("review", 1, 0)],
        )
        order = [m["title"] for m in overview["matters"]]
        self.assertEqual(order, ["Late", "Review", "Soon", "Calm", "General"])
        late = overview["matters"][0]
        self.assertEqual((late["overdue_tickets"], late["open_tickets"]), (2, 3))
        self.assertEqual(late["next_due"], soon.isoformat())

    def test_matters_with_no_work_are_still_listed_with_zero_counts(self) -> None:
        overview = agent_tools.build_matter_overview(
            [SimpleNamespace(id="m", title="Quiet", case_number=None)], [], [],
        )
        self.assertEqual(overview["matters"][0]["open_tickets"], 0)
        self.assertEqual(overview["total"], 1)

    def test_list_is_capped(self) -> None:
        matters = [SimpleNamespace(id=str(i), title=f"M{i}", case_number=None) for i in range(40)]
        overview = agent_tools.build_matter_overview(matters, [], [])
        self.assertEqual(len(overview["matters"]), agent_tools.MAX_MATTERS)
        self.assertTrue(overview["truncated"])


class SummaryTests(unittest.TestCase):
    def test_summaries(self) -> None:
        self.assertEqual(agent_tools.summarise_result("find_documents", {"results": [1, 2]}), "2 documents found")
        self.assertEqual(agent_tools.summarise_result("read_document", {"filename": "OTP.pdf"}), "Read OTP.pdf")
        self.assertEqual(agent_tools.summarise_result("create_workboard_ticket", {"changed": True}), "Workboard updated")
        self.assertEqual(agent_tools.summarise_result("list_workboard_tickets", {"tickets": []}), "Workboard checked")
        self.assertEqual(agent_tools.summarise_result("get_kb_entry", {"error": "nope"}), "nope")

    def test_today_line_names_the_weekday(self) -> None:
        self.assertRegex(agent_tools.today_line(), r"Today is \w+day \d{1,2} \w+ \d{4}\.")


class UnknownToolTests(unittest.TestCase):
    def test_unknown_tool_returns_error_not_exception(self) -> None:
        result = asyncio.run(
            agent_tools.execute_shared_tool("nope", {}, db=MagicMock(), user=MagicMock(), matter_id=None)
        )
        self.assertIn("error", result)


class _FakeProvider:
    """Round 1: two identical create calls. Round 2: a plain answer."""

    def __init__(self) -> None:
        self.tool_sets: list[list] = []

    async def stream_with_tools(self, messages, tools):
        self.tool_sets.append(tools)
        if len(self.tool_sets) == 1:
            call = {"type": "function", "function": {"name": "create_workboard_ticket", "arguments": json.dumps({"title": "Chase OTP"})}}
            yield ("tool_calls", {"tool_calls": [{**call, "id": "a"}, {**call, "id": "b"}], "content": None})
        else:
            yield ("token", "Created.")


class LexChatLoopTests(unittest.TestCase):
    def _run(self, execute):
        provider = _FakeProvider()
        events = []

        async def go():
            with patch.object(agent_service, "get_llm", return_value=provider), \
                 patch.object(agent_service, "execute_shared_tool", execute):
                async for event in agent_service.run_agent_loop(
                    [{"role": "user", "content": "add a ticket"}], MagicMock(),
                    user=SimpleNamespace(id="u1"), matter_id=None, model="m",
                ):
                    events.append(event)

        asyncio.run(go())
        return provider, events

    def test_lexchat_offers_workboard_and_document_tools(self) -> None:
        provider, _ = self._run(AsyncMock(return_value={"changed": True, "ticket": {"id": "t1"}}))
        offered = set(_names(provider.tool_sets[0]))
        self.assertTrue({"list_workboard_tickets", "find_documents", "list_matters"} <= offered)

    def test_repeated_create_in_one_turn_runs_once_and_signals_board_refresh_once(self) -> None:
        execute = AsyncMock(return_value={"changed": True, "ticket": {"id": "t1"}})
        _, events = self._run(execute)
        self.assertEqual(execute.await_count, 1)
        self.assertEqual([e for e, _ in events].count("workboard_changed"), 1)
        results = [d for e, d in events if e == "tool_result"]
        self.assertEqual([r["changed"] for r in results], [True, False])

    def test_workboard_reads_go_through_the_shared_executor(self) -> None:
        execute = AsyncMock(return_value={"tickets": [], "total": 0, "truncated": False})

        async def call():
            with patch.object(agent_service, "execute_shared_tool", execute):
                return await agent_service._execute_tool(
                    "list_workboard_tickets", {"scope": "all"}, db=MagicMock(),
                    user=SimpleNamespace(id="u1"), matter_id=None,
                    registry=agent_service.SourceRegistry(),
                )

        text, summary = asyncio.run(call())
        self.assertEqual(json.loads(text)["total"], 0)
        self.assertEqual(summary, "Workboard checked")


if __name__ == "__main__":
    unittest.main()
