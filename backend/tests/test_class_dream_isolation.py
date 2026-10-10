import asyncio
import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ChatMessage, ChatThread, ClassMembership, DreamJob, Memory,
    MentorshipClass, User,
)
from app.schemas import DreamAddition, DreamProposal
from app.services.dream_service import (
    _apply_dream_proposal, _load_recent_messages, get_dream_job,
    process_dream_job, start_dream_job,
)
from app.worker_types import WorkerClaim


class ClassDreamIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            ChatThread.__table__, ChatMessage.__table__, Memory.__table__,
            DreamJob.__table__,
        ])
        self.db = Session(self.engine)
        self.user = User(id="reader", email="reader@example.test", google_id="reader")
        self.db.add(self.user)
        self.db.add_all([
            MentorshipClass(id="a", name="Current", status="active", created_by="reader"),
            MentorshipClass(id="b", name="Former", status="active", created_by="reader"),
        ])
        self.db.add(ClassMembership(class_id="a", user_id="reader", status="active", role="member"))
        self.db.add_all([
            ChatThread(id="thread-a", class_id="a", user_id="reader", title="Current"),
            ChatThread(id="thread-b", class_id="b", user_id="reader", title="Former"),
            Memory(id="memory-b", class_id="b", user_id="reader", category="semantic", content="Former private memory"),
            DreamJob(id="old-job", class_id="b", user_id="reader", status="completed"),
        ])
        self.db.flush()
        self.db.add_all([
            ChatMessage(thread_id="thread-a", role="user", content="Current prompt"),
            ChatMessage(thread_id="thread-b", role="user", content="Former private prompt"),
        ])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_dream_prompt_excludes_former_team_chat(self) -> None:
        self.assertEqual(
            [message.content for message in _load_recent_messages(self.db, user_id="reader")],
            ["Current prompt"],
        )

    def test_dream_job_is_bound_to_current_team(self) -> None:
        job = start_dream_job(self.db, user=self.user)
        self.assertEqual(self.db.get(DreamJob, job.job_id).class_id, "a")
        with self.assertRaises(Exception):
            get_dream_job(self.db, user=self.user, job_id="old-job")

    def test_dream_cannot_update_former_team_memory_or_create_unbound_memory(self) -> None:
        proposal = DreamProposal.model_validate({
            "updates": [{"memory_id": "memory-b", "content": "Leaked", "reason": "test"}],
        })
        with self.assertRaises(RuntimeError):
            _apply_dream_proposal(self.db, user_id="reader", class_id="a", proposal=proposal)
        self.db.rollback()
        self.assertEqual(self.db.get(Memory, "memory-b").content, "Former private memory")

        addition = DreamProposal(additions=[DreamAddition(category="semantic", content="Current memory", reason="test")])
        _apply_dream_proposal(self.db, user_id="reader", class_id="a", proposal=addition)
        self.db.commit()
        created = self.db.query(Memory).filter(Memory.content == "Current memory").one()
        self.assertEqual(created.class_id, "a")

    def test_membership_revoked_during_model_call_prevents_memory_write(self) -> None:
        started = datetime.now()
        job = DreamJob(id="live-job", class_id="a", user_id="reader", status="processing", processing_started_at=started)
        self.db.add(job)
        self.db.commit()

        async def remove_membership_after_prompt(*, user_id: str, class_id: str) -> DreamProposal:
            membership = self.db.query(ClassMembership).filter_by(user_id=user_id, class_id=class_id).one()
            membership.status = "removed"
            self.db.commit()
            return DreamProposal(additions=[DreamAddition(category="semantic", content="Must not persist", reason="test")])

        with patch("app.services.dream_service.SessionLocal", lambda: Session(self.engine)), patch(
            "app.services.dream_service._run_dream_consolidation", remove_membership_after_prompt,
        ):
            asyncio.run(process_dream_job(WorkerClaim(job_id="live-job", started_at=started)))

        self.db.expire_all()
        self.assertEqual(self.db.query(Memory).filter(Memory.content == "Must not persist").count(), 0)
        self.assertEqual(self.db.get(DreamJob, "live-job").status, "failed")


if __name__ == "__main__":
    unittest.main()
