from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import ActionItem, ChatMessage, ChatThread, Matter, MatterMember, ResourceMetadata, Team, TeamMember, User
from app.services.property_workboard_demo_service import seed_property_workboard


def test_property_demo_is_additive_repeatable_and_grants_matter_access():
    engine = create_engine('sqlite://')
    for model in (Team, User, TeamMember, Matter, MatterMember, ActionItem, ResourceMetadata, ChatThread, ChatMessage):
        model.__table__.create(engine)
    with Session(engine) as db:
        presenter = User(email='presenter@example.test', google_id='presenter', is_admin=True, firm_role='partner')
        db.add(presenter)
        db.flush()
        existing = ActionItem(title='Existing real work', assigner_id=presenter.id, tags=[])
        db.add(existing)
        db.commit()
        first = seed_property_workboard(db, presenter=presenter)
        assert first['tickets_created'] == 12
        assert first['matters'] == 4
        assert first['chats_created'] == 16
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
        second = seed_property_workboard(db, presenter=presenter)
        assert second['tickets_created'] == 0
        assert second['chats_created'] == 0
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
