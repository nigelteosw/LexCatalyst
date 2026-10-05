import unittest

from app.services.agent_service import SourceRegistry


class SourceRegistryTests(unittest.TestCase):
    def test_numbers_start_at_one_and_are_sequential(self) -> None:
        reg = SourceRegistry()
        a = reg.add(kind="document", id="d1", title="MSA.pdf", locator="p. 3")
        b = reg.add(kind="kb_entry", id="k1", title="Playbook", locator="knowledge bank")
        self.assertEqual((a, b), (1, 2))
        self.assertEqual([s["n"] for s in reg.sources], [1, 2])

    def test_same_source_and_locator_reuses_its_number(self) -> None:
        reg = SourceRegistry()
        first = reg.add(kind="document", id="d1", title="MSA.pdf", locator="p. 3")
        again = reg.add(kind="document", id="d1", title="MSA.pdf", locator="p. 3")
        other_page = reg.add(kind="document", id="d1", title="MSA.pdf", locator="p. 4")
        self.assertEqual(first, again)
        self.assertNotEqual(first, other_page)
        self.assertEqual(len(reg.sources), 2)

    def test_document_and_kb_entry_with_same_id_are_distinct(self) -> None:
        reg = SourceRegistry()
        self.assertNotEqual(
            reg.add(kind="document", id="x", title="A"),
            reg.add(kind="kb_entry", id="x", title="A"),
        )

    def test_sources_are_json_ready(self) -> None:
        reg = SourceRegistry()
        reg.add(
            kind="document", id="d1", title="MSA.pdf", locator="p. 2", matter_id="m1",
            scope="matter", excerpt="9.3 The Processor shall indemnify.",
        )
        self.assertEqual(
            reg.sources[0],
            {
                "n": 1, "kind": "document", "id": "d1", "title": "MSA.pdf", "locator": "p. 2",
                "matter_id": "m1", "scope": "matter", "excerpt": "9.3 The Processor shall indemnify.",
            },
        )

    def test_excerpt_is_capped(self) -> None:
        reg = SourceRegistry()
        reg.add(kind="kb_entry", id="k", title="T", excerpt="x" * 5000)
        self.assertLessEqual(len(reg.sources[0]["excerpt"]), 1500)
