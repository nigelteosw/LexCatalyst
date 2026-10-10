import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ClassAuditEvent,
    ClassInvite,
    ClassJoinAttempt,
    ClassMembership,
    MentorshipClass,
    Team,
    TeamMember,
    User,
)
from app.services.mentorship_class_service import (
    ClassAccessError,
    approve_member,
    create_class,
    archive_class,
    disable_invite,
    reject_member,
    request_join,
    require_class_context,
    rotate_invite,
    set_member_role,
    remove_member,
    transfer_ownership,
)
from app.services.organization_service import ensure_default_team
from app.services.user_service import list_firm_users


class ClassMembershipTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            ClassInvite.__table__, ClassJoinAttempt.__table__, ClassAuditEvent.__table__,
            Team.__table__, TeamMember.__table__,
        ])
        self.db = Session(self.engine)
        self.owner = User(id="owner", email="owner@example.test", google_id="google-owner")
        self.student = User(id="student", email="student@example.test", google_id="google-student")
        self.db.add_all([self.owner, self.student])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_code_creates_pending_request_and_approval_grants_class(self) -> None:
        cohort = create_class(self.db, user=self.owner, name="Autumn intake")
        code = rotate_invite(self.db, context=require_class_context(self.db, self.owner), secret="x" * 32)
        self.assertRegex(code, r"^\d{3}-\d{3}$")
        request_join(self.db, user=self.student, code=code, source_ip="127.0.0.1", secret="x" * 32)
        with self.assertRaises(ClassAccessError):
            require_class_context(self.db, self.student)
        approve_member(self.db, context=require_class_context(self.db, self.owner), target_user_id=self.student.id)
        self.assertEqual(require_class_context(self.db, self.student).class_id, cohort.id)
        membership = self.db.scalar(select(ClassMembership).where(ClassMembership.user_id == self.student.id))
        self.assertEqual(membership.status, "active")

    def test_join_code_rotation_revokes_old_code(self) -> None:
        create_class(self.db, user=self.owner, name="Autumn intake")
        context = require_class_context(self.db, self.owner)
        old_code = rotate_invite(self.db, context=context, secret="x" * 32)
        rotate_invite(self.db, context=context, secret="x" * 32)
        with self.assertRaises(ClassAccessError):
            request_join(self.db, user=self.student, code=old_code, source_ip="127.0.0.1", secret="x" * 32)

    def test_existing_member_cannot_join_second_class(self) -> None:
        create_class(self.db, user=self.owner, name="Autumn intake")
        with self.assertRaises(ClassAccessError):
            create_class(self.db, user=self.owner, name="Second intake")

    def test_owner_cannot_leave_until_ownership_transfers(self) -> None:
        create_class(self.db, user=self.owner, name="Autumn intake")
        context = require_class_context(self.db, self.owner)
        with self.assertRaises(ClassAccessError):
            remove_member(self.db, context=context, target_user_id=self.owner.id)
        code = rotate_invite(self.db, context=context, secret="x" * 32)
        request_join(self.db, user=self.student, code=code, source_ip="127.0.0.1", secret="x" * 32)
        approve_member(self.db, context=context, target_user_id=self.student.id)
        transfer_ownership(self.db, context=context, target_user_id=self.student.id)
        remove_member(self.db, context=require_class_context(self.db, self.owner), target_user_id=self.owner.id)
        with self.assertRaises(ClassAccessError):
            require_class_context(self.db, self.owner)
        self.assertEqual(require_class_context(self.db, self.student).role, "owner")

    def test_default_teams_are_local_to_each_approved_class(self) -> None:
        first = create_class(self.db, user=self.owner, name="Autumn intake")
        second = create_class(self.db, user=self.student, name="Winter intake")
        first_team = ensure_default_team(self.db, self.owner)
        second_team = ensure_default_team(self.db, self.student)
        self.assertEqual(first_team.class_id, first.id)
        self.assertEqual(second_team.class_id, second.id)
        self.assertNotEqual(first_team.id, second_team.id)

    def test_roster_only_contains_current_team_members(self) -> None:
        create_class(self.db, user=self.owner, name="Autumn intake")
        create_class(self.db, user=self.student, name="Winter intake")
        self.assertEqual([user.id for user in list_firm_users(self.db, user=self.owner)], ["owner"])

    def test_owner_can_reject_promote_disable_and_archive(self) -> None:
        cohort = create_class(self.db, user=self.owner, name="Autumn intake")
        context = require_class_context(self.db, self.owner)
        code = rotate_invite(self.db, context=context, secret="x" * 32)
        request_join(self.db, user=self.student, code=code, source_ip="127.0.0.1", secret="x" * 32)
        reject_member(self.db, context=context, target_user_id=self.student.id)
        with self.assertRaises(ClassAccessError):
            approve_member(self.db, context=context, target_user_id=self.student.id)
        request_join(self.db, user=self.student, code=code, source_ip="127.0.0.1", secret="x" * 32)
        approve_member(self.db, context=context, target_user_id=self.student.id)
        set_member_role(self.db, context=context, target_user_id=self.student.id, role="mentor")
        self.assertEqual(require_class_context(self.db, self.student).role, "mentor")
        disable_invite(self.db, context=context)
        self.assertIsNone(self.db.scalar(select(ClassInvite.id).where(ClassInvite.class_id == cohort.id, ClassInvite.revoked_at.is_(None))))
        archive_class(self.db, context=context)
        with self.assertRaises(ClassAccessError):
            require_class_context(self.db, self.student)
