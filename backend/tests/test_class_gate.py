import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.class_gate import install_class_gate
from app.database import Base
from app.models import ClassMembership, MentorshipClass, Team, User


class ClassGateTests(unittest.TestCase):
    def test_pending_user_cannot_reach_workspace_endpoint(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine, tables=[User.__table__, MentorshipClass.__table__, ClassMembership.__table__, Team.__table__])
        db_factory = sessionmaker(bind=engine)
        with Session(engine) as db:
            db.add(User(id="student", email="student@example.test", google_id="student"))
            db.commit()
        app = FastAPI()
        install_class_gate(app)

        @app.get("/documents")
        def documents():
            return {"private": "must not reach"}

        @app.get("/classes/status")
        def status():
            return {"status": "pending"}

        with patch("app.class_gate.SessionLocal", db_factory), patch(
            "app.class_gate.authenticate_user_token",
            side_effect=lambda db, token: db.get(User, "student"),
        ):
            client = TestClient(app)
            headers = {"Authorization": "Bearer valid-token"}
            self.assertEqual(client.get("/documents", headers=headers).status_code, 403)
            self.assertEqual(client.get("/classes/status", headers=headers).status_code, 200)
            self.assertEqual(client.get("/documents").status_code, 401)
        engine.dispose()
