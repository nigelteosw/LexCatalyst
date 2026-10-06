import asyncio

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import (
    ActionItem, ChatMessage, ChatThread, Document, Matter, MatterMember, ResourceMetadata,
    ReviewAnnotation, ReviewHandoff, ReviewLesson, Team, TeamMember, User,
)
from app.services import property_workboard_demo_service
from app.services.property_workboard_demo_service import seed_property_workboard


def _fake_upload(monkeypatch):
    async def create_pending_document(db, *, user_id, filename, content_type, file_bytes, matter_id, team_id):
        document = Document(user_id=user_id, filename=filename, content_type=content_type,
                            status='ready', matter_id=matter_id, team_id=team_id, file_size=len(file_bytes))
        db.add(document)
        db.commit()
        return document
    monkeypatch.setattr(property_workboard_demo_service.document_service, 'create_pending_document', create_pending_document)


def test_property_demo_is_additive_repeatable_and_grants_matter_access(monkeypatch):
    _fake_upload(monkeypatch)
    engine = create_engine('sqlite://')
    for model in (Team, User, TeamMember, Matter, MatterMember, Document, ActionItem, ResourceMetadata,
                  ChatThread, ChatMessage, ReviewHandoff, ReviewAnnotation, ReviewLesson):
        model.__table__.create(engine)
    with Session(engine) as db:
        presenter = User(email='presenter@example.test', google_id='presenter', is_admin=True, firm_role='partner')
        db.add(presenter)
        db.flush()
        existing = ActionItem(title='Existing real work', assigner_id=presenter.id, tags=[])
        db.add(existing)
        db.commit()
        first = asyncio.run(seed_property_workboard(db, presenter=presenter))
        assert first['tickets_created'] == 12
        assert first['matters'] == 4
        assert first['chats_created'] == 16
        assert first['review_rounds_created'] == 2
        rounds = {h.status: h for h in db.scalars(select(ReviewHandoff))}
        assert set(rounds) == {'returned', 'ready_for_review'}
        assert len(rounds['returned'].annotations) == 4
        assert len(list(db.scalars(select(ReviewLesson)))) == 4
        otp = db.scalar(select(ActionItem).where(ActionItem.title == 'Review option to purchase for Bishan condominium'))
        assert otp.active_handoff_id == rounds['ready_for_review'].id
        threads = list(db.scalars(select(ChatThread)))
        assert len(threads) == 16
        assert len(list(db.scalars(select(ChatThread).where(ChatThread.user_id == presenter.id)))) == 4
        assert all(thread.matter_id is not None for thread in threads)
        assert len(list(db.scalars(select(ChatMessage)))) == 32
        for thread in threads:
            assert db.scalar(select(MatterMember).where(MatterMember.matter_id == thread.matter_id, MatterMember.user_id == thread.user_id)) is not None
        messages = threads[0].messages
        messages[0].content = 'My edited conversation'
        db.commit()
        demo_items = list(db.scalars(select(ActionItem).where(ActionItem.id != existing.id)))
        assert {item.status for item in demo_items} == {'pending', 'in_progress', 'review', 'with_client', 'done'}
        assert all('property-workboard-demo' in item.tags for item in demo_items)
        assert len(list(db.scalars(select(MatterMember).where(MatterMember.user_id == presenter.id)))) == 4
        demo_items[0].status = 'done'
        db.commit()
        second = asyncio.run(seed_property_workboard(db, presenter=presenter))
        assert second['tickets_created'] == 0
        assert second['chats_created'] == 0
        assert second['review_rounds_created'] == 0
        assert len(list(db.scalars(select(ReviewHandoff)))) == 2
        assert len(list(db.scalars(select(ChatThread)))) == 16
        assert len(list(db.scalars(select(ChatMessage)))) == 32
        assert db.get(ChatMessage, messages[0].id).content == 'My edited conversation'
        assert db.get(ActionItem, existing.id).title == 'Existing real work'
        assert db.get(ActionItem, demo_items[0].id).status == 'done'
        assert len(list(db.scalars(select(ActionItem)))) == 13


def test_property_demo_route_is_hidden_without_demo_admin(monkeypatch):
    from types import SimpleNamespace
    import pytest
    from fastapi import HTTPException
    from app.routers import demo

    for demo_mode, is_admin in ((False, True), (True, False)):
        monkeypatch.setattr(demo, 'get_settings', lambda: SimpleNamespace(demo_mode=demo_mode))
        with pytest.raises(HTTPException) as error:
            demo.require_demo_admin(SimpleNamespace(is_admin=is_admin))
        assert error.value.status_code == 404
    monkeypatch.setattr(demo, 'get_settings', lambda: SimpleNamespace(demo_mode=True))
    admin = SimpleNamespace(is_admin=True)
    assert demo.require_demo_admin(admin) is admin
