import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import KnowledgeBankEntry, PiiRedaction
from app.schemas import KnowledgeBankEntryCreate, ReviewAnnotationPromoteRequest
from app.services import knowledge_bank_service as kb
from app.services import review_annotation_service as ras


def _run(coro):
    return asyncio.run(coro)


def _annotation(promoted=None):
    return SimpleNamespace(
        id="ann",
        anchor_quote="Acme Corp shall indemnify",
        suggested_text="The Supplier shall indemnify",
        note="Never name the client in a standard clause.",
        promoted_kb_entry_id=promoted,
        updated_at=None,
    )


class PendingReviewEntryTests(unittest.TestCase):
    def test_creates_redacted_entry_with_pending_status_and_proposal(self) -> None:
        db = MagicMock()
        added: list = []
        db.add.side_effect = added.append
        user = SimpleNamespace(id="u", firm_role="partner", default_team_id=None)
        schema = KnowledgeBankEntryCreate(
            scope="firm_wide",
            entry_type="knowledge_bank",
            title="Indemnity position",
            body_markdown="Acme Corp shall indemnify",
        )
        with (
            patch.object(
                kb,
                "_propose_redactions",
                AsyncMock(return_value=({"Acme Corp": "[CLIENT]"}, "[CLIENT] shall indemnify")),
            ),
            patch.object(kb, "_embed_entry", AsyncMock()),
            patch.object(kb, "sync_metadata_safe"),
            patch.object(kb, "get_kb_entry", side_effect=lambda _db, _id: None),
        ):
            entry, redaction = _run(
                kb.create_pending_review_entry(
                    db, user=user, schema=schema, source_matter_id="matter"
                )
            )

        self.assertIsInstance(entry, KnowledgeBankEntry)
        self.assertEqual(entry.pii_status, "pending_review")
        self.assertEqual(entry.body_markdown, "[CLIENT] shall indemnify")
        self.assertIsInstance(redaction, PiiRedaction)
        self.assertEqual(redaction.original_content, "Acme Corp shall indemnify")
        self.assertEqual(redaction.target_scope, "firm_wide")
        self.assertIn(redaction, added)


class AnnotationPromotionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = MagicMock()
        self.user = SimpleNamespace(id="senior", firm_role="partner")
        self.handoff = SimpleNamespace(matter_id="matter")

    def test_wider_scope_goes_through_pending_review(self) -> None:
        pending = AsyncMock(return_value=(SimpleNamespace(id="kb-1"), object()))
        clean = AsyncMock()
        with (
            patch.object(kb, "create_pending_review_entry", pending),
            patch.object(kb, "create_kb_entry", clean),
        ):
            entry = _run(
                ras.promote_annotation_to_kb(
                    self.db,
                    annotation=_annotation(),
                    handoff=self.handoff,
                    user=self.user,
                    schema=ReviewAnnotationPromoteRequest(target_scope="firm_wide"),
                )
            )
        self.assertEqual(entry.id, "kb-1")
        clean.assert_not_called()
        pending.assert_awaited_once()
        self.assertEqual(pending.await_args.kwargs["source_matter_id"], "matter")

    def test_matter_scope_creates_clean_matter_entry(self) -> None:
        pending = AsyncMock()
        clean = AsyncMock(return_value=SimpleNamespace(id="kb-2"))
        with (
            patch.object(kb, "create_pending_review_entry", pending),
            patch.object(kb, "create_kb_entry", clean),
        ):
            _run(
                ras.promote_annotation_to_kb(
                    self.db,
                    annotation=_annotation(),
                    handoff=self.handoff,
                    user=self.user,
                    schema=ReviewAnnotationPromoteRequest(target_scope="matter"),
                )
            )
        pending.assert_not_called()
        schema = clean.await_args.kwargs["schema"]
        self.assertEqual(schema.scope, "matter")
        self.assertEqual(schema.matter_id, "matter")

    def test_repeated_promotion_is_rejected(self) -> None:
        with (
            patch.object(kb, "create_pending_review_entry", AsyncMock()) as pending,
            patch.object(kb, "create_kb_entry", AsyncMock()) as clean,
        ):
            with self.assertRaises(ras.ReviewAnnotationError):
                _run(
                    ras.promote_annotation_to_kb(
                        self.db,
                        annotation=_annotation(promoted="kb-existing"),
                        handoff=self.handoff,
                        user=self.user,
                        schema=ReviewAnnotationPromoteRequest(target_scope="firm_wide"),
                    )
                )
        pending.assert_not_called()
        clean.assert_not_called()


if __name__ == "__main__":
    unittest.main()
