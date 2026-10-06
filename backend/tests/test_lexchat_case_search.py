import unittest
from unittest.mock import MagicMock, patch

from app.services import agent_service as agent
from app.services import elitigation_service as el


SEARCH_HTML = '''<div class="card-body gd">
<a class="gd-heardertext" href="/gd/s/2026_SGHC_101">Example v Example</a>
<a class="citation-num-link">[2026] SGHC 101 |</a>
<a class="decision-date-link" data-searchparam='DecisionDate:"2026-08-01"'></a>
<a class="gd-cw">[Land — Ownership]</a></div>'''
JUDGMENT_HTML = '<p class="Judg-1">12 The property was held on trust.</p>'


class LexChatCaseSearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_stream_exposes_tool_and_emits_citable_sources(self):
        class Provider:
            async def stream_with_tools(self, messages, tools):
                if messages[-1]["role"] == "tool":
                    self_test.assertIn("[1] [2026] SGHC 101", messages[-1]["content"])
                    yield "token", "The property was held on trust [1]."
                elif any(t["function"]["name"] == "search_elitigation" for t in tools):
                    yield "tool_calls", {"content": None, "tool_calls": [{
                        "id": "case-search", "type": "function", "function": {
                            "name": "search_elitigation", "arguments": '{"query":"property","newest_first":true}',
                        },
                    }]}
                else:
                    yield "token", "Search tool missing"

        self_test = self
        with (
            patch.object(agent, "get_llm", return_value=Provider()),
            patch.object(el, "_get", side_effect=lambda url, params=None: SEARCH_HTML if params else JUDGMENT_HTML),
        ):
            events = [event async for event in agent.run_agent_loop(
                [{"role": "user", "content": "Recent property cases on eLitigation"}],
                MagicMock(), user=MagicMock(id="u1"), matter_id=None, model="test",
            )]
        self.assertEqual([kind for kind, _ in events], ["tool_call", "tool_result", "sources", "token"])
        self.assertEqual(events[2][1]["sources"][0]["url"], "https://www.elitigation.sg/gd/s/2026_SGHC_101")
        self.assertIn("[1]", events[-1][1]["content"])

    async def execute(self, args, get):
        registry = agent.SourceRegistry()
        db = MagicMock()
        with patch.object(el, "_get", side_effect=get):
            result = await agent._execute_tool(
                "search_elitigation", args, db=db, user=MagicMock(id="u1"),
                matter_id="m1", registry=registry,
            )
        return result, registry, db

    async def test_search_returns_numbered_judgment_excerpt_and_public_source(self):
        def get(url, params=None):
            if url == el.SEARCH_URL:
                self.assertEqual(params["SearchPhrase"], "property")
                self.assertEqual(params["SortBy"], "DateOfDecision")
                self.assertEqual(params["YearOfDecision"], "2026")
                self.assertEqual(params["SortAscending"], "False")
                return SEARCH_HTML
            self.assertEqual(url, "https://www.elitigation.sg/gd/s/2026_SGHC_101")
            return JUDGMENT_HTML

        (body, summary), registry, db = await self.execute(
            {"query": "property", "newest_first": True, "year": 2026}, get,
        )
        self.assertIn("[1] [2026] SGHC 101", body)
        self.assertIn("2026-08-01", body)
        self.assertIn("[para 12] The property was held on trust.", body)
        self.assertEqual(summary, "1 judgment")
        self.assertEqual(registry.sources[0]["kind"], "elitigation")
        self.assertEqual(registry.sources[0]["url"], "https://www.elitigation.sg/gd/s/2026_SGHC_101")
        self.assertIsNone(registry.sources[0]["matter_id"])
        self.assertEqual(db.add.call_args.args[0].kind, "case_search")

    async def test_search_failure_is_not_reported_as_no_results(self):
        def get(url, params=None):
            raise el.ElitigationError("service unavailable")
        (body, summary), registry, _ = await self.execute({"query": "property"}, get)
        self.assertIn("unavailable", body)
        self.assertEqual(summary, "search unavailable")
        self.assertEqual(registry.sources, [])

    async def test_empty_search_is_explicit(self):
        (body, summary), registry, _ = await self.execute({"query": "property"}, lambda *a: "")
        self.assertIn("No eLitigation judgments", body)
        self.assertEqual(summary, "no results")
        self.assertEqual(registry.sources, [])

    async def test_excerpt_failure_keeps_verified_metadata_without_inventing_text(self):
        def get(url, params=None):
            if url == el.SEARCH_URL:
                return SEARCH_HTML
            raise el.ElitigationError("unavailable")
        (body, _), registry, _ = await self.execute({"query": "property"}, get)
        self.assertIn("[2026] SGHC 101", body)
        self.assertIn("excerpt unavailable", body)
        self.assertIsNone(registry.sources[0]["excerpt"])

    async def test_invalid_year_does_not_search(self):
        def get(*args):
            self.fail("invalid arguments must not reach eLitigation")
        (body, summary), _, _ = await self.execute({"query": "property", "year": "bad"}, get)
        self.assertIn("year", body)
        self.assertEqual(summary, "invalid arguments")
