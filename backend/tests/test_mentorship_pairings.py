import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import ClassAuditEvent, ClassMembership, MentorPairing, MentorshipClass, User
from app.services.mentorship_class_service import ClassAccessError, ClassContext, remove_member, set_member_role
from app.services.mentorship_service import (
    can_read_mentee,
    create_pairing,
    end_pairing,
    is_active_mentor_of,
    list_pairings,
    relationships_for,
)


class MentorshipPairingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__,
            MentorPairing.__table__, ClassAuditEvent.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id="owner", email="o@example.test", google_id="o"),
            User(id="mentor", email="m@example.test", google_id="m"),
            User(id="mentee", email="e@example.test", google_id="e"),
            User(id="member", email="x@example.test", google_id="x"),
            User(id="outsider", email="z@example.test", google_id="z"),
            MentorshipClass(id="class-a", name="A", status="active", created_by="owner"),
            MentorshipClass(id="class-b", name="B", status="active", created_by="outsider"),
            ClassMembership(class_id="class-a", user_id="owner", role="owner", status="active"),
            ClassMembership(class_id="class-a", user_id="mentor", role="mentor", status="active"),
            ClassMembership(class_id="class-a", user_id="mentee", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="member", role="member", status="active"),
            ClassMembership(class_id="class-b", user_id="outsider", role="owner", status="active"),
        ])
        self.db.commit()
        self.owner = ClassContext(user_id="owner", class_id="class-a", role="owner")
        self.mentor = ClassContext(user_id="mentor", class_id="class-a", role="mentor")
        self.member = ClassContext(user_id="member", class_id="class-a", role="member")

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_owner_can_pair_any_mentor_and_mentee(self) -> None:
        pairing = create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        self.assertEqual((pairing.mentor_user_id, pairing.mentee_user_id), ("mentor", "mentee"))

    def test_mentor_can_only_pair_themselves_as_mentor(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_pairing(self.db, context=self.mentor, mentor_user_id="owner", mentee_user_id="mentee")
        self.assertEqual(caught.exception.status_code, 403)

        create_pairing(self.db, context=self.mentor, mentor_user_id="mentor", mentee_user_id="mentee")

    def test_plain_member_cannot_create_pairing(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_pairing(self.db, context=self.member, mentor_user_id="mentor", mentee_user_id="mentee")
        self.assertEqual(caught.exception.status_code, 403)

    def test_ineligible_mentor_role_rejected(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_pairing(self.db, context=self.owner, mentor_user_id="member", mentee_user_id="mentee")
        self.assertEqual(caught.exception.status_code, 422)

    def test_cross_class_or_inactive_user_returns_404(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="outsider")
        self.assertEqual(caught.exception.status_code, 404)

    def test_self_pairing_rejected(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentor")
        self.assertEqual(caught.exception.status_code, 422)

    def test_duplicate_active_pairing_rejected(self) -> None:
        create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        with self.assertRaises(ClassAccessError) as caught:
            create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        self.assertEqual(caught.exception.status_code, 409)

    def test_end_pairing_sets_ended_at_and_revokes_read_access(self) -> None:
        pairing = create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        self.assertTrue(can_read_mentee(self.db, context=self.mentor, mentee_user_id="mentee"))

        end_pairing(self.db, context=self.owner, pairing_id=pairing.id)

        self.db.refresh(pairing)
        self.assertIsNotNone(pairing.ended_at)
        self.assertFalse(can_read_mentee(self.db, context=self.mentor, mentee_user_id="mentee"))
        self.assertEqual(list_pairings(self.db, context=self.owner), [])

    def test_mentee_can_read_self_and_list_relationships(self) -> None:
        create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        mentee = ClassContext(user_id="mentee", class_id="class-a", role="member")
        self.assertTrue(can_read_mentee(self.db, context=mentee, mentee_user_id="mentee"))
        mentors, mentees = relationships_for(self.db, context=mentee)
        self.assertEqual([u.id for u in mentors], ["mentor"])
        self.assertEqual(mentees, [])
        self.assertTrue(is_active_mentor_of(self.db, class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee"))

    def test_remove_member_ends_their_pairings_both_directions(self) -> None:
        create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        remove_member(self.db, context=self.owner, target_user_id="mentee")
        self.assertEqual(list_pairings(self.db, context=self.owner), [])

        create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="member")
        remove_member(self.db, context=self.owner, target_user_id="mentor")
        self.assertEqual(list_pairings(self.db, context=self.owner), [])

    def test_demoting_mentor_ends_only_pairings_where_they_are_mentor(self) -> None:
        create_pairing(self.db, context=self.owner, mentor_user_id="mentor", mentee_user_id="mentee")
        self.db.scalar(select(ClassMembership).where(ClassMembership.user_id == "member")).role = "mentor"
        self.db.commit()
        # 'member' is now a mentor, so they can be the mentor of a pairing.
        create_pairing(self.db, context=self.owner, mentor_user_id="member", mentee_user_id="mentor")

        set_member_role(self.db, context=self.owner, target_user_id="member", role="member")

        remaining = list_pairings(self.db, context=self.owner)
        self.assertEqual([(p.mentor_user_id, p.mentee_user_id) for p in remaining], [("mentor", "mentee")])
        ended = self.db.scalar(select(MentorPairing).where(MentorPairing.mentor_user_id == "member"))
        self.assertIsNotNone(ended.ended_at)


if __name__ == "__main__":
    unittest.main()
