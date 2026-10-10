import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import ChatThread, ClassMembership, Matter, MentorshipClass, Team, User
from app.services.chat_service import get_or_create_thread, list_threads


class ClassChatAccessTests(unittest.TestCase):
    def test_previous_team_thread_is_not_reused_or_listed(self) -> None:
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            Team.__table__, Matter.__table__, ChatThread.__table__,
        ])
        with Session(engine) as db:
            db.add(User(id="u", email="u@example.test", google_id="u"))
            db.add_all([
                MentorshipClass(id="a", name="A", status="active", created_by="u"),
                MentorshipClass(id="b", name="B", status="active", created_by="u"),
            ])
            db.add(ClassMembership(class_id="a", user_id="u", role="member", status="active"))
            db.add(ChatThread(id="old", class_id="b", user_id="u", title="Old team secret"))
            db.commit()
            self.assertEqual(list_threads(db, "u"), [])
            fresh = get_or_create_thread(db, "old", "New question", "u")
            self.assertNotEqual(fresh.id, "old")
            self.assertEqual(fresh.class_id, "a")
        engine.dispose()
