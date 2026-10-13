import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.dependencies import get_current_user
from app.models import (
    ClassAuditEvent, ClassMembership, MentorFeedback, MentorPairing, MentorshipClass, ReviewLesson, User,
)
from app.routers.mentorship import router
from app.services import lesson_service


class MentorshipRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__, ClassAuditEvent.__table__,
            MentorPairing.__table__, MentorFeedback.__table__, ReviewLesson.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id="owner", email="o@example.test", google_id="o", full_name="Olive Owner"),
            User(id="mentor", email="m@example.test", google_id="m", full_name="Mo Mentor"),
            User(id="mentee", email="e@example.test", google_id="e", full_name="Mel Mentee"),
            User(id="other", email="x@example.test", google_id="x", full_name="Oz Other"),
            User(id="member", email="p@example.test", google_id="p"),
            MentorshipClass(id="class-a", name="A", status="active", created_by="owner"),
            ClassMembership(class_id="class-a", user_id="owner", role="owner", status="active"),
            ClassMembership(class_id="class-a", user_id="mentor", role="mentor", status="active"),
            ClassMembership(class_id="class-a", user_id="mentee", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="other", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="member", role="member", status="active"),
        ])
        self.db.commit()

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.actor = "owner"
        app.dependency_overrides[get_current_user] = lambda: self.db.get(User, self.actor)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_pairing_round_trip(self) -> None:
        created = self.client.post("/mentorship/pairings", json={"mentor_user_id": "mentor", "mentee_user_id": "mentee"})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["mentee_name"], "Mel Mentee")
        pairing_id = created.json()["id"]

        self.assertEqual(len(self.client.get("/mentorship/pairings").json()), 1)
        self.assertEqual(self.client.delete(f"/mentorship/pairings/{pairing_id}").status_code, 204)
        self.assertEqual(self.client.get("/mentorship/pairings").json(), [])

    def test_plain_member_cannot_create_pairing(self) -> None:
        self.actor = "member"
        response = self.client.post("/mentorship/pairings", json={"mentor_user_id": "mentor", "mentee_user_id": "mentee"})
        self.assertEqual(response.status_code, 403)

    def test_me_shows_mentors_and_mentees(self) -> None:
        self.client.post("/mentorship/pairings", json={"mentor_user_id": "mentor", "mentee_user_id": "mentee"})
        self.actor = "mentor"
        self.assertEqual([p["user_id"] for p in self.client.get("/mentorship/me").json()["mentees"]], ["mentee"])
        self.actor = "mentee"
        self.assertEqual([p["user_id"] for p in self.client.get("/mentorship/me").json()["mentors"]], ["mentor"])

    def test_guidance_create_list_patch_and_delete(self) -> None:
        self.client.post("/mentorship/pairings", json={"mentor_user_id": "mentor", "mentee_user_id": "mentee"})
        self.actor = "mentor"
        created = self.client.post("/mentorship/feedback", json={"audience": "mentee", "mentee_user_id": "mentee", "note": "Define terms"})
        self.assertEqual(created.status_code, 201)
        row_id = created.json()["id"]

        self.actor = "mentee"
        listed = self.client.get("/mentorship/feedback", params={"mentee_id": "mentee"}).json()
        self.assertEqual([r["id"] for r in listed], [row_id])

        self.actor = "mentor"
        patched = self.client.patch(f"/mentorship/feedback/{row_id}", json={"note": "Define terms before use"})
        self.assertEqual(patched.json()["note"], "Define terms before use")
        self.assertEqual(self.client.delete(f"/mentorship/feedback/{row_id}").status_code, 204)

    def test_mentee_audience_without_mentee_is_unprocessable(self) -> None:
        self.actor = "owner"
        response = self.client.post("/mentorship/feedback", json={"audience": "mentee", "note": "Hi"})
        self.assertEqual(response.status_code, 422)

    def test_cross_mentee_feedback_read_returns_empty_list(self) -> None:
        self.client.post("/mentorship/pairings", json={"mentor_user_id": "mentor", "mentee_user_id": "mentee"})
        self.actor = "mentor"
        self.client.post("/mentorship/feedback", json={"audience": "mentee", "mentee_user_id": "mentee", "note": "Hi"})
        self.actor = "other"
        self.assertEqual(self.client.get("/mentorship/feedback", params={"mentee_id": "mentee"}).json(), [])

    def test_distill_then_second_distill_is_conflict_and_themes_reflect_lessons(self) -> None:
        self.client.post("/mentorship/pairings", json={"mentor_user_id": "mentor", "mentee_user_id": "mentee"})
        self.actor = "mentor"
        note = self.client.post("/mentorship/feedback", json={"audience": "mentee", "mentee_user_id": "mentee", "note": "Define terms"}).json()
        raw = '[{"title": "Define terms", "body": "Define before use.", "theme": "defined terms", "source_feedback_ids": ["%s"]}]' % note["id"]
        llm = SimpleNamespace(complete=AsyncMock(return_value=raw))

        self.actor = "mentee"
        with patch.object(lesson_service, "get_llm", return_value=llm):
            distilled = self.client.post("/mentorship/lessons/distill", json={})
            again = self.client.post("/mentorship/lessons/distill", json={})

        self.assertEqual(distilled.status_code, 200)
        self.assertEqual(distilled.json()[0]["theme"], "Defined Terms")
        self.assertEqual(again.status_code, 409)

        themes = self.client.get("/mentorship/mentees/mentee/themes").json()
        self.assertEqual([(t["theme"], t["count"]) for t in themes], [("Defined Terms", 1)])

        self.actor = "other"
        self.assertEqual(self.client.get("/mentorship/mentees/mentee/themes").json(), [])

    def test_unauthenticated_requests_are_rejected(self) -> None:
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        response = TestClient(app).get("/mentorship/pairings")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
