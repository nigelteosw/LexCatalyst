"""Regression coverage for access failures found during pre-push review."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.dependencies import check_kb_read, check_kb_write, require_matter_member
from app.models import (
    BirdieReview, BirdieSuggestion, BirdieSuggestionReply, ChatMessage, ChatThread, ClassAuditEvent,
    ClassInvite, ClassJoinAttempt, ClassMembership, KnowledgeBankEntry, Matter,
    MatterMember, MentorshipClass, ResourceMetadata, RetrievalAuditEvent, Team,
    TeamMember, User,
)
from app.services import agent_service, agent_tools, birdie_service, chat_service, birdie_review_service as reviews
from app.services.audit_service import record_retrieval
from app.services.mentorship_class_service import (
    ClassAccessError, approve_member, archive_class, create_class, remove_member,
    request_join, require_class_context, rotate_invite, set_member_role,
)
from app.services.organization_service import list_matters
from app.services.resource_metadata_service import list_resource_metadata
from app.routers.organizations import patch_matter, remove_matter, post_matter_member
from app.schemas import MatterUpdate, MatterMemberCreate, PageContext


class ClassReviewFindingsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        Base.metadata.create_all(self.engine, tables=[model.__table__ for model in (
            User, MentorshipClass, ClassMembership, ClassAuditEvent, ClassInvite,
            ClassJoinAttempt, Team, TeamMember, Matter, MatterMember,
            BirdieReview, BirdieSuggestion, BirdieSuggestionReply, RetrievalAuditEvent,
            KnowledgeBankEntry, ResourceMetadata,
            ChatThread, ChatMessage,
        )])
        self.db = Session(self.engine)
        self.user = User(id='actor', email='actor@example.test', google_id='actor', is_admin=True, firm_role='partner')
        self.other = User(id='other', email='other@example.test', google_id='other')
        self.db.add_all([self.user, self.other, MentorshipClass(id='a', name='Alpha', status='active'), MentorshipClass(id='b', name='Beta', status='active')])
        self.db.add(ClassMembership(id='membership', class_id='a', user_id='actor', role='owner', status='active'))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_review_creation_and_audit_derive_current_class(self):
        review = reviews.create_review(self.db, user=self.user, url='https://example.test', title='Draft', text='Private draft', matter_id=None, model='test')
        event = record_retrieval(self.db, user_id='actor', kind='case_search', query='trusts', returned_ids=[])
        self.assertEqual(review.class_id, 'a')
        self.assertEqual(event.class_id, 'a')

    def test_review_history_and_suggestions_cannot_cross_class_switch(self):
        review = BirdieReview(id='old', class_id='b', user_id='actor', source_url='https://example.test', source_text='Former team secret', status='ready', stats={})
        review.suggestions.append(BirdieSuggestion(id='suggestion', anchor_text='secret', anchor_start=12, anchor_end=18, type='comment', reason='Secret advice', category='question'))
        self.db.add(review)
        self.db.commit()
        self.assertIsNone(reviews.get_review(self.db, 'old', 'actor'))
        self.assertIsNone(reviews.latest_review_for_url(self.db, 'https://example.test', 'actor'))
        self.assertIsNone(reviews.get_suggestion(self.db, 'suggestion', 'actor'))
        self.assertEqual(reviews.reset_reviews_for_url(self.db, 'https://example.test', 'actor'), 0)
        self.assertIsNotNone(self.db.get(BirdieReview, 'old'))

    def test_admin_cannot_read_or_write_someone_elses_private_kb(self):
        entry = KnowledgeBankEntry(class_id='a', created_by='other', created_by_role='associate', scope='private', entry_type='note', title='Private', body_markdown='Secret')
        self.assertFalse(check_kb_read(self.db, self.user, entry))
        self.assertFalse(check_kb_write(self.db, self.user, entry))

    def test_admin_cannot_discover_private_metadata_even_with_team_link(self):
        self.db.add(Team(id='team', class_id='a', name='Local'))
        self.db.add(TeamMember(team_id='team', user_id='actor', role='partner'))
        self.db.add(ResourceMetadata(class_id='a', resource_type='document', resource_id='secret', owner_user_id='other', created_by='other', team_id='team', scope='private', title='Confidential title'))
        self.db.commit()
        self.assertEqual(list_resource_metadata(self.db, user=self.user), [])

    def test_partner_admin_needs_explicit_matter_membership(self):
        self.db.add(Team(id='team', class_id='a', name='Local'))
        self.db.add(Matter(id='matter', class_id='a', team_id='team', case_number='P-1', title='Private matter'))
        self.db.commit()
        self.assertEqual(list_matters(self.db, self.user), [])
        with self.assertRaises(HTTPException):
            require_matter_member(self.db, self.user, 'matter')

    def test_retrieval_audit_derives_current_class(self):
        event = record_retrieval(self.db, user_id='actor', kind='case_search', query='trusts', returned_ids=[])
        self.assertEqual(event.class_id, 'a')

    def test_matter_mutation_routes_reject_foreign_class_even_for_admin(self):
        self.db.add(Team(id='foreign-team', class_id='b', name='Foreign'))
        self.db.add(Matter(id='foreign-matter', class_id='b', team_id='foreign-team', case_number='F-1', title='Foreign matter'))
        self.db.commit()
        for operation in (
            lambda: patch_matter('foreign-matter', MatterUpdate(title='Changed'), self.db, self.user),
            lambda: remove_matter('foreign-matter', self.db, self.user),
            lambda: post_matter_member('foreign-matter', MatterMemberCreate(user_id='actor', role='partner'), self.db, self.user),
        ):
            with self.assertRaises(HTTPException) as caught:
                operation()
            self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.db.get(Matter, 'foreign-matter').title, 'Foreign matter')

    def test_matter_cannot_enroll_member_of_another_class(self):
        self.db.add(Team(id='team', class_id='a', name='Local'))
        self.db.add(Matter(id='matter', class_id='a', team_id='team', case_number='M-1', title='Local matter'))
        self.db.add(MatterMember(matter_id='matter', user_id='actor', role='partner'))
        self.db.add(ClassMembership(class_id='b', user_id='other', role='member', status='active'))
        self.db.commit()
        with self.assertRaises(HTTPException) as caught:
            post_matter_member('matter', MatterMemberCreate(user_id='other', role='associate'), self.db, self.user)
        self.assertEqual(caught.exception.status_code, 404)

    def test_removed_mentor_rejoins_as_member(self):
        context = require_class_context(self.db, self.user)
        code = rotate_invite(self.db, context=context, secret='x' * 32)
        request_join(self.db, user=self.other, code=code, source_ip='127.0.0.1', secret='x' * 32)
        approve_member(self.db, context=context, target_user_id='other')
        set_member_role(self.db, context=context, target_user_id='other', role='mentor')
        remove_member(self.db, context=context, target_user_id='other')
        request_join(self.db, user=self.other, code=code, source_ip='127.0.0.1', secret='x' * 32)
        approve_member(self.db, context=context, target_user_id='other')
        self.assertEqual(require_class_context(self.db, self.other).role, 'member')

    def test_archive_releases_membership_so_owner_can_create_again(self):
        archive_class(self.db, context=require_class_context(self.db, self.user))
        cohort = create_class(self.db, user=self.user, name='New team')
        self.assertEqual(require_class_context(self.db, self.user).class_id, cohort.id)

    def revoke(self):
        with Session(self.engine) as db:
            membership = db.get(ClassMembership, 'membership')
            membership.status = 'removed'
            db.commit()

    def test_lexchat_and_birdie_stop_tokens_after_live_revocation(self):
        for module, is_birdie in ((agent_service, False), (birdie_service, True)):
            with self.subTest(loop=module.__name__):
                self.db.get(ClassMembership, 'membership').status = 'active'
                self.db.commit()
                owner = self
                class Provider:
                    async def stream_with_tools(self, messages, tools):
                        yield 'token', 'Allowed'
                        owner.revoke()
                        yield 'token', 'Must not be delivered'
                events = []
                async def run():
                    with patch.object(module, 'get_llm', return_value=Provider()), patch.object(birdie_service, 'build_birdie_messages', AsyncMock(return_value=[])):
                        stream = module.stream_birdie_response(self.db, user=self.user, user_message='Hi', history=[], matter_id=None) if is_birdie else module.run_agent_loop([], self.db, user=self.user, matter_id=None, model='test')
                        async for event in stream:
                            events.append(event)
                with self.assertRaises(ClassAccessError):
                    asyncio.run(run())
                self.assertEqual(events, [('token', {'content': 'Allowed'})])

    def test_shared_tool_denies_removed_member_before_dispatch(self):
        self.revoke()
        with self.assertRaises(ClassAccessError):
            asyncio.run(agent_tools.execute_shared_tool('list_matters', {}, db=self.db, user=self.user, matter_id=None))

    def test_birdie_open_thread_context_excludes_former_class(self):
        self.db.add(ChatThread(id='old-thread', class_id='b', user_id='actor', title='Former team secret'))
        self.db.commit()
        page = birdie_service.resolve_page_context(self.db, self.user, PageContext(view='chat', thread_id='old-thread'))
        self.assertIsNone(page.title)
        self.assertNotIn('Former team secret', page.prompt)

    def test_summary_is_not_saved_if_membership_is_revoked_during_generation(self):
        thread = ChatThread(id='thread', class_id='a', user_id='actor', title='Current')
        self.db.add(thread)
        self.db.add_all([ChatMessage(thread_id='thread', role='user', content=f'Message {i}') for i in range(40)])
        self.db.commit()
        owner = self
        class Provider:
            async def chat(self, messages):
                owner.revoke()
                return 'Must not be saved', {}
        with patch.object(chat_service, 'get_llm', return_value=Provider()):
            with self.assertRaises(ClassAccessError):
                asyncio.run(chat_service._maybe_refresh_summary(self.db, thread, 'actor'))
        self.db.expire_all()
        self.assertIsNone(self.db.get(ChatThread, 'thread').summary)
