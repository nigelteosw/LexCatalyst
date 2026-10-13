import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import (
    ActionItem, ClassAuditEvent, ClassMembership, Document, MentorFeedback, MentorPairing,
    MentorshipClass, Matter, MatterMember, ReviewAnnotation, ReviewAnnotationReply, ReviewHandoff, User,
)
from app.services.feedback_service import (
    create_guidance, delete_feedback, list_feedback, snapshot_round_feedback, update_feedback,
)
from app.services.mentorship_class_service import ClassAccessError, ClassContext
from app.services.mentorship_service import end_pairing
from app.services.review_handoff_service import return_handoff_for_rework


class MentorshipFeedbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            User.__table__, MentorshipClass.__table__, ClassMembership.__table__, ClassAuditEvent.__table__,
            MentorPairing.__table__, MentorFeedback.__table__, Matter.__table__, MatterMember.__table__,
            Document.__table__, ActionItem.__table__, ReviewHandoff.__table__, ReviewAnnotation.__table__,
            ReviewAnnotationReply.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            User(id="owner", email="o@example.test", google_id="o", full_name="Olive Owner"),
            User(id="mentor", email="m@example.test", google_id="m", full_name="Mo Mentor"),
            User(id="mentee", email="e@example.test", google_id="e", full_name="Mel Mentee"),
            User(id="other", email="x@example.test", google_id="x", full_name="Oz Other"),
            User(id="member", email="p@example.test", google_id="p"),
            User(id="partner", email="pa@example.test", google_id="pa", firm_role="partner"),
            User(id="outsider", email="z@example.test", google_id="z"),
            MentorshipClass(id="class-a", name="A", status="active", created_by="owner"),
            MentorshipClass(id="class-b", name="B", status="active", created_by="outsider"),
            ClassMembership(class_id="class-a", user_id="owner", role="owner", status="active"),
            ClassMembership(class_id="class-a", user_id="mentor", role="mentor", status="active"),
            ClassMembership(class_id="class-a", user_id="mentee", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="other", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="member", role="member", status="active"),
            ClassMembership(class_id="class-a", user_id="partner", role="member", status="active"),
            ClassMembership(class_id="class-b", user_id="outsider", role="owner", status="active"),
            MentorPairing(class_id="class-a", mentor_user_id="mentor", mentee_user_id="mentee", created_by="owner"),
        ])
        self.db.commit()
        self.owner = ClassContext(user_id="owner", class_id="class-a", role="owner")
        self.mentor = ClassContext(user_id="mentor", class_id="class-a", role="mentor")
        self.mentee = ClassContext(user_id="mentee", class_id="class-a", role="member")
        self.other = ClassContext(user_id="other", class_id="class-a", role="member")
        self.member = ClassContext(user_id="member", class_id="class-a", role="member")
        self.partner = ClassContext(user_id="partner", class_id="class-a", role="member")
        self.outsider = ClassContext(user_id="outsider", class_id="class-b", role="owner")

        self.db.add_all([
            Document(id="doc", class_id="class-a", user_id="mentee", filename="draft.docx",
                     content_type="application/docx", storage_key="k"),
            ReviewHandoff(id="round-1", class_id="class-a", document_id="doc",
                          submitted_by="mentee", reviewer_id="mentor", status="in_review"),
            ReviewAnnotation(id="ann-own", handoff_id="round-1", document_id="doc", page_no=1, kind="comment",
                             anchor_quote="own", author_user_id="mentee", note="my own note"),
            ReviewAnnotation(id="ann-mentor", handoff_id="round-1", document_id="doc", page_no=1, kind="comment",
                             anchor_quote="cap it", author_user_id="mentor", note="Cap at fees"),
            ReviewAnnotation(id="ann-blank", handoff_id="round-1", document_id="doc", page_no=2, kind="comment",
                             anchor_quote="blank", author_user_id="mentor", note="  "),
            ReviewAnnotation(id="ann-carried", handoff_id="round-1", document_id="doc", page_no=2, kind="comment",
                             anchor_quote="old", author_user_id="mentor", note="old", previous_annotation_id="ann-mentor"),
        ])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _feedback(self, **overrides) -> MentorFeedback:
        values = dict(class_id="class-a", audience="mentee", mentee_user_id="mentee", author_user_id="mentor",
                      author_name="Mo Mentor", source="guidance", note="Define your terms", created_by="mentor")
        values.update(overrides)
        row = MentorFeedback(**values)
        self.db.add(row)
        self.db.commit()
        return row

    def _visible_ids(self, context: ClassContext, **filters) -> set[str]:
        return {row.id for row in list_feedback(self.db, context=context, **filters)}

    # Snapshot of review-round feedback
    def test_snapshot_copies_only_feedback_annotations(self) -> None:
        handoff = self.db.get(ReviewHandoff, "round-1")
        created = snapshot_round_feedback(self.db, handoff)
        self.db.commit()
        self.assertEqual(created, 1)
        rows = self.db.scalars(select(MentorFeedback).where(MentorFeedback.source == "review_round")).all()
        self.assertEqual([r.annotation_id for r in rows], ["ann-mentor"])
        self.assertEqual(rows[0].author_name, "Mo Mentor")
        self.assertEqual(rows[0].mentee_user_id, "mentee")

    def test_returning_a_round_for_rework_snapshots_its_feedback(self) -> None:
        return_handoff_for_rework(self.db, "round-1")
        rows = self.db.scalars(select(MentorFeedback).where(MentorFeedback.handoff_id == "round-1")).all()
        self.assertEqual([r.annotation_id for r in rows], ["ann-mentor"])

    def test_snapshot_is_idempotent(self) -> None:
        handoff = self.db.get(ReviewHandoff, "round-1")
        snapshot_round_feedback(self.db, handoff)
        self.db.commit()
        self.assertEqual(snapshot_round_feedback(self.db, handoff), 0)
        self.db.commit()
        self.assertEqual(self.db.query(MentorFeedback).count(), 1)

    def test_snapshot_ignores_later_annotation_edits(self) -> None:
        handoff = self.db.get(ReviewHandoff, "round-1")
        snapshot_round_feedback(self.db, handoff)
        self.db.commit()
        self.db.get(ReviewAnnotation, "ann-mentor").note = "Edited later"
        self.db.commit()
        snapshot_round_feedback(self.db, handoff)
        self.db.commit()
        row = self.db.scalar(select(MentorFeedback).where(MentorFeedback.annotation_id == "ann-mentor"))
        self.assertEqual(row.note, "Cap at fees")

    def test_snapshot_author_name_falls_back_when_author_deleted(self) -> None:
        self.db.get(ReviewAnnotation, "ann-mentor").author_user_id = None
        self.db.commit()
        snapshot_round_feedback(self.db, self.db.get(ReviewHandoff, "round-1"))
        self.db.commit()
        row = self.db.scalar(select(MentorFeedback).where(MentorFeedback.annotation_id == "ann-mentor"))
        self.assertEqual(row.author_name, "a reviewer")
        self.assertIsNone(row.author_user_id)

    # Access matrix
    def test_mentee_sees_own_mentee_feedback_and_mentor_sees_it_through_pairing(self) -> None:
        row = self._feedback()
        self.assertIn(row.id, self._visible_ids(self.mentee))
        self.assertIn(row.id, self._visible_ids(self.mentor))

    def test_mentor_paired_to_one_mentee_cannot_read_another_mentees_feedback(self) -> None:
        row = self._feedback(mentee_user_id="other", author_user_id="owner", author_name="Olive Owner", created_by="owner")
        self.assertNotIn(row.id, self._visible_ids(self.mentor))
        self.assertEqual(self._visible_ids(self.mentor, mentee_user_id="other"), set())

    def test_ended_pairing_removes_access_but_keeps_authored_rows(self) -> None:
        kept = self._feedback(author_user_id="mentor", created_by="mentor")
        dropped = self._feedback(author_user_id="owner", created_by="owner", author_name="Olive Owner")
        end_pairing(self.db, context=self.owner, pairing_id=self.db.scalar(select(MentorPairing.id)))
        visible = self._visible_ids(self.mentor)
        self.assertIn(kept.id, visible)
        self.assertNotIn(dropped.id, visible)

    def test_plain_member_and_other_class_see_no_mentee_feedback(self) -> None:
        row = self._feedback()
        self.assertNotIn(row.id, self._visible_ids(self.member))
        self.assertNotIn(row.id, self._visible_ids(self.outsider))

    def test_admin_partner_without_pairing_sees_no_mentee_feedback(self) -> None:
        row = self._feedback()
        self.assertNotIn(row.id, self._visible_ids(self.partner))

    def test_team_guidance_visible_to_every_active_member_of_the_class(self) -> None:
        row = self._feedback(audience="team", mentee_user_id=None, author_user_id="owner", author_name="Olive Owner", created_by="owner")
        for context in (self.member, self.mentee, self.partner):
            self.assertIn(row.id, self._visible_ids(context))
        self.assertNotIn(row.id, self._visible_ids(self.outsider))

    def test_team_guidance_requires_owner_or_mentor(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_guidance(self.db, context=self.member, audience="team", mentee_user_id=None, note="Hi")
        self.assertEqual(caught.exception.status_code, 403)
        row = create_guidance(self.db, context=self.mentor, audience="team", mentee_user_id=None, note="Hi")
        self.assertEqual(row.audience, "team")

    def test_mentee_guidance_requires_owner_or_active_pairing(self) -> None:
        with self.assertRaises(ClassAccessError) as caught:
            create_guidance(self.db, context=self.member, audience="mentee", mentee_user_id="mentee", note="Hi")
        self.assertEqual(caught.exception.status_code, 403)
        with self.assertRaises(ClassAccessError):
            create_guidance(self.db, context=self.mentor, audience="mentee", mentee_user_id="other", note="Hi")
        row = create_guidance(self.db, context=self.mentor, audience="mentee", mentee_user_id="mentee", note="Hi")
        self.assertEqual(row.mentee_user_id, "mentee")

    def test_feedback_with_deleted_author_still_lists_with_author_name(self) -> None:
        row = self._feedback(author_user_id=None, author_name="A reviewer", created_by=None)
        listed = [r for r in list_feedback(self.db, context=self.mentee) if r.id == row.id]
        self.assertEqual(listed[0].author_name, "A reviewer")

    # Edit and delete
    def test_mentee_cannot_edit_or_delete_mentor_feedback(self) -> None:
        row = self._feedback()
        with self.assertRaises(ClassAccessError) as caught:
            update_feedback(self.db, context=self.mentee, feedback_id=row.id, note="Changed")
        self.assertEqual(caught.exception.status_code, 403)
        with self.assertRaises(ClassAccessError) as caught:
            delete_feedback(self.db, context=self.mentee, feedback_id=row.id)
        self.assertEqual(caught.exception.status_code, 403)

    def test_author_can_edit_and_soft_delete(self) -> None:
        row = self._feedback()
        update_feedback(self.db, context=self.mentor, feedback_id=row.id, note="Revised")
        self.assertEqual(self.db.get(MentorFeedback, row.id).note, "Revised")
        delete_feedback(self.db, context=self.mentor, feedback_id=row.id)
        self.assertNotIn(row.id, self._visible_ids(self.mentee))
        self.assertIsNotNone(self.db.get(MentorFeedback, row.id).deleted_at)

    def test_owner_can_delete_team_guidance(self) -> None:
        row = self._feedback(audience="team", mentee_user_id=None, author_user_id="mentor", created_by="mentor")
        delete_feedback(self.db, context=self.owner, feedback_id=row.id)
        self.assertNotIn(row.id, self._visible_ids(self.member))


if __name__ == "__main__":
    unittest.main()
