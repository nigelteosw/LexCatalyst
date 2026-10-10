import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.models import ClassAuditEvent, ClassInvite, ClassJoinAttempt, ClassMembership, MentorshipClass, Team, User
from app.routers.mentorship_classes import router


class ClassRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        from sqlalchemy.pool import StaticPool
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine, tables=[User.__table__, MentorshipClass.__table__, ClassMembership.__table__, ClassInvite.__table__, ClassJoinAttempt.__table__, ClassAuditEvent.__table__, Team.__table__])
        self.db = Session(self.engine)
        self.owner = User(id="owner", email="owner@example.test", google_id="owner-google")
        self.student = User(id="student", email="student@example.test", google_id="student-google")
        self.db.add_all([self.owner, self.student])
        self.db.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.actor = self.owner
        app.dependency_overrides[get_current_user] = lambda: self.actor
        self.client = TestClient(app)
        self.settings_patch = patch("app.routers.mentorship_classes.get_settings", return_value=SimpleNamespace(class_invite_secret="x" * 32))
        self.settings_patch.start()

    def tearDown(self) -> None:
        self.settings_patch.stop()
        self.db.close()
        self.engine.dispose()

    def test_create_join_approve_and_current_class(self) -> None:
        self.assertEqual(self.client.get("/classes/current").status_code, 403)
        created = self.client.post("/classes", json={"name": "Autumn intake"})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["name"], "Autumn intake")
        code = self.client.post("/classes/current/invite").json()["code"]
        self.actor = self.student
        requested = self.client.post("/classes/join", json={"code": code})
        self.assertEqual(requested.status_code, 202)
        self.assertEqual(self.client.get("/classes/current").status_code, 403)
        self.actor = self.owner
        self.assertEqual(self.client.post("/classes/current/members/student/approve").status_code, 200)
        self.actor = self.student
        self.assertEqual(self.client.get("/classes/current").json()["id"], created.json()["id"])
        self.actor = self.owner
        self.assertEqual(self.client.post("/classes/current/transfer-owner", json={"user_id": "student"}).status_code, 200)
        self.assertEqual(self.client.post("/classes/current/leave").status_code, 200)
        self.assertEqual(self.client.get("/classes/status").json()["status"], "none")
