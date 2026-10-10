import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import ChatMessage, ChatThread, ClassMembership, Matter, Memory, MentorshipClass, Team, User
from app.schemas import MemoryCreate
from app.services.memory_service import create_memory, get_memory, list_memories


class ClassMemoryAccessTests(unittest.TestCase):
    def test_old_team_memory_is_not_read_or_reused(self) -> None:
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            Team.__table__, Matter.__table__, ChatThread.__table__,
            ChatMessage.__table__, Memory.__table__,
        ])
        with Session(engine) as db:
            db.add(User(id="u", email="u@example.test", google_id="u"))
            db.add_all([
                MentorshipClass(id="a", name="A", status="active", created_by="u"),
                MentorshipClass(id="b", name="B", status="active", created_by="u"),
            ])
            db.add(ClassMembership(class_id="a", user_id="u", status="active", role="member"))
            db.add(Memory(id="old", class_id="b", user_id="u", category="semantic", content="Old team secret"))
            db.commit()
            self.assertEqual(list_memories(db, "u"), [])
            self.assertIsNone(get_memory(db, "u", "old"))
            fresh = create_memory(db, "u", MemoryCreate(category="semantic", content="Current team preference"))
            self.assertEqual(fresh.class_id, "a")
        engine.dispose()
