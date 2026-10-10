import asyncio

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import (
    ClassMembership, MentorshipClass, ActionItem, ChatMessage, ChatThread, Document, Matter, MatterMember, ResourceMetadata,
    ReviewAnnotation, ReviewHandoff, ReviewLesson, Team, TeamMember, User,
)
from app.services import property_workboard_demo_service
from app.services.property_workboard_demo_service import seed_property_workboard


def _fake_upload(monkeypatch):
    async def create_pending_document(db, *, user_id, filename, content_type, file_bytes, matter_id, team_id):
        document = Document(class_id=db.get(Matter, matter_id).class_id, user_id=user_id, filename=filename, content_type=content_type,
                            status='ready', matter_id=matter_id, team_id=team_id, file_size=len(file_bytes))
        db.add(document)
        db.commit()
        return document
    monkeypatch.setattr(property_workboard_demo_service.document_service, 'create_pending_document', create_pending_document)

    async def seed_style_guide(db, *, presenter):  # KB entries need embeddings; not under test here
        return False
    monkeypatch.setattr(property_workboard_demo_service, '_seed_style_guide', seed_style_guide)


def test_property_demo_is_additive_repeatable_and_grants_matter_access(monkeypatch):
    _fake_upload(monkeypatch)
    engine = create_engine('sqlite://')
    for model in (MentorshipClass, ClassMembership, Team, User, TeamMember, Matter, MatterMember, Document, ActionItem, ResourceMetadata,
                  ChatThread, ChatMessage, ReviewHandoff, ReviewAnnotation, ReviewLesson):
        model.__table__.create(engine)
    with Session(engine) as db:
        presenter = User(email='presenter@example.test', google_id='presenter', is_admin=True, firm_role='partner')
        db.add(presenter)
        db.flush()
        db.add(MentorshipClass(id='class', name='Test team', status='active'))
        db.add(ClassMembership(class_id='class', user_id=presenter.id, role='owner', status='active'))
        existing = ActionItem(class_id='class', title='Existing real work', assigner_id=presenter.id, tags=[])
        db.add(existing)
        db.commit()
        first = asyncio.run(seed_property_workboard(db, presenter=presenter))
        assert first['tickets_created'] == 12
        assert first['matters'] == 4
        assert first['chats_created'] == 16
        assert first['review_rounds_created'] == 2
        tampines = db.scalar(select(Matter).where(Matter.case_number == 'DEMO-SG-PROP-002'))
        tampines_docs = list(db.scalars(select(Document).where(Document.matter_id == tampines.id)))
        assert first['tampines_documents'] == 3 and len(tampines_docs) == 3
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


def test_property_demo_retries_failed_pdfs_without_duplicate_rounds(monkeypatch):
    _fake_upload(monkeypatch)
    engine = create_engine('sqlite://')
    for model in (MentorshipClass, ClassMembership, Team, User, TeamMember, Matter, MatterMember, Document, ActionItem, ResourceMetadata,
                  ChatThread, ChatMessage, ReviewHandoff, ReviewAnnotation, ReviewLesson):
        model.__table__.create(engine)
    with Session(engine) as db:
        presenter = User(email='retry@example.test', google_id='retry', is_admin=True, firm_role='partner')
        db.add(presenter)
        db.flush()
        db.add(MentorshipClass(id='class', name='Test team', status='active'))
        db.add(ClassMembership(class_id='class', user_id=presenter.id, role='owner', status='active'))
        db.commit()
        asyncio.run(seed_property_workboard(db, presenter=presenter))
        documents = list(db.scalars(select(Document).where(Document.filename.like('Bishan%'))))
        for document in documents:
            document.status = 'failed'
            document.error_message = 'R2 unavailable'
        documents[1].storage_key = 'already-uploaded'
        db.commit()
        monkeypatch.setattr(property_workboard_demo_service.document_service, 'upload_document_file',
                            lambda **kwargs: 'demo/' + kwargs['document_id'])
        result = asyncio.run(seed_property_workboard(db, presenter=presenter))
        assert [d.status for d in documents] == ['processing', 'processing']
        assert all(d.storage_key and d.error_message is None for d in documents)
        assert documents[1].storage_key == 'already-uploaded'
        assert result['documents_processing'] == 2
        assert result['documents_failed'] == 0
        assert len(list(db.scalars(select(ReviewHandoff)))) == 2


def test_property_demo_completes_a_partial_document_seed(monkeypatch):
    _fake_upload(monkeypatch)
    engine = create_engine('sqlite://')
    for model in (MentorshipClass, ClassMembership, Team, User, TeamMember, Matter, MatterMember, Document, ActionItem, ResourceMetadata,
                  ChatThread, ChatMessage, ReviewHandoff, ReviewAnnotation, ReviewLesson):
        model.__table__.create(engine)
    original = property_workboard_demo_service.document_service.create_pending_document
    calls = 0
    async def interrupted(db, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError('seed interrupted')
        return await original(db, **kwargs)
    monkeypatch.setattr(property_workboard_demo_service.document_service, 'create_pending_document', interrupted)
    with Session(engine) as db:
        presenter = User(email='partial@example.test', google_id='partial', is_admin=True, firm_role='partner')
        db.add(presenter)
        db.flush()
        db.add(MentorshipClass(id='class', name='Test team', status='active'))
        db.add(ClassMembership(class_id='class', user_id=presenter.id, role='owner', status='active'))
        db.commit()
        import pytest
        with pytest.raises(RuntimeError, match='seed interrupted'):
            asyncio.run(seed_property_workboard(db, presenter=presenter))
        monkeypatch.setattr(property_workboard_demo_service.document_service, 'create_pending_document', original)
        result = asyncio.run(seed_property_workboard(db, presenter=presenter))
        assert result['review_rounds_created'] == 2
        assert len(list(db.scalars(select(Document)))) == 5  # 2 Bishan notes + 3 Tampines documents
        assert len(list(db.scalars(select(ReviewLesson)))) == 4


def test_property_demo_is_separate_in_each_testing_team(monkeypatch):
    _fake_upload(monkeypatch)
    engine = create_engine('sqlite://')
    for model in (MentorshipClass, ClassMembership, Team, User, TeamMember, Matter, MatterMember,
                  Document, ActionItem, ResourceMetadata, ChatThread, ChatMessage,
                  ReviewHandoff, ReviewAnnotation, ReviewLesson):
        model.__table__.create(engine)
    with Session(engine) as db:
        presenters = []
        for class_id in ('alpha', 'beta'):
            user = User(id=class_id, email=f'{class_id}@example.test', google_id=class_id, is_admin=True, firm_role='partner')
            db.add_all([user, MentorshipClass(id=class_id, name=class_id, status='active')])
            db.add(ClassMembership(class_id=class_id, user_id=class_id, role='owner', status='active'))
            presenters.append(user)
        db.commit()
        for presenter in presenters:
            result = asyncio.run(seed_property_workboard(db, presenter=presenter))
            assert result['tickets_created'] == 12
        for class_id in ('alpha', 'beta'):
            assert len(list(db.scalars(select(Matter).where(Matter.class_id == class_id)))) == 4
            assert len(list(db.scalars(select(ActionItem).where(ActionItem.class_id == class_id)))) == 12
            assert len(list(db.scalars(select(Document).where(Document.class_id == class_id)))) == 5
        from app.routers.demo import demo_users, demo_switch, SwitchRequest
        from fastapi import HTTPException
        import pytest
        alpha_users = demo_users(db=db, _admin=presenters[0])
        beta_users = demo_users(db=db, _admin=presenters[1])
        assert len(alpha_users) == len(beta_users) == 3
        assert {u['id'] for u in alpha_users}.isdisjoint(u['id'] for u in beta_users)
        with pytest.raises(HTTPException) as error:
            demo_switch(SwitchRequest(user_id=beta_users[0]['id']), db=db, _admin=presenters[0])
        assert error.value.status_code == 404
    engine.dispose()


def test_meridian_demo_reset_preserves_other_testing_team(monkeypatch):
    from unittest.mock import AsyncMock
    from app.database import Base
    from app.models import KnowledgeBankEntry, Memory
    from app.services import demo_seed_service, knowledge_bank_service, entry_metadata_service
    from app.services.mentorship_class_service import require_active_class_id
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    async def upload(db, *, user_id, filename, content_type, file_bytes, matter_id, team_id):
        document = Document(class_id=require_active_class_id(db, user_id), user_id=user_id,
                            filename=filename, content_type=content_type, storage_key='',
                            status='ready', matter_id=matter_id, team_id=team_id, file_size=len(file_bytes))
        db.add(document)
        db.commit()
        return document
    monkeypatch.setattr(demo_seed_service.document_service, 'create_pending_document', upload)
    monkeypatch.setattr(knowledge_bank_service, 'embed_texts', AsyncMock(return_value=[[0.0] * 1536]))
    monkeypatch.setattr(entry_metadata_service, 'get_llm', lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('No external provider in test')))
    with Session(engine) as db:
        presenters = []
        for class_id in ('alpha', 'beta'):
            user = User(id=class_id, email=f'{class_id}@example.test', google_id=class_id, is_admin=True, firm_role='partner')
            db.add_all([user, MentorshipClass(id=class_id, name=class_id, status='active')])
            db.add(ClassMembership(class_id=class_id, user_id=class_id, role='owner', status='active'))
            presenters.append(user)
        db.commit()
        for presenter in presenters:
            summary = asyncio.run(demo_seed_service.seed_demo(db, presenter=presenter))
            assert summary['documents'] == 3
            assert summary['kb_entries'] == len(demo_seed_service.KB_ENTRIES)
        roots = (Team, Matter, Document, KnowledgeBankEntry, ActionItem, ReviewHandoff, ChatThread, Memory)
        beta_ids = {model: {row.id for row in db.scalars(select(model).where(model.class_id == 'beta'))} for model in roots}
        asyncio.run(demo_seed_service.seed_demo(db, presenter=presenters[0]))
        for model, ids in beta_ids.items():
            assert {row.id for row in db.scalars(select(model).where(model.class_id == 'beta'))} == ids
        assert len(list(db.scalars(select(Document).where(Document.class_id == 'alpha')))) == 3
    engine.dispose()
