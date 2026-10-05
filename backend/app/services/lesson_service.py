"""Mentor lessons: a senior's review comments, surfaced to the junior who submitted the draft.

A comment is feedback for a user when it sits on a returned/completed round the user submitted,
was written by someone else, carries a note or suggested wording, and is not a carried-forward
copy of an earlier comment. Only the submitter ever sees their round's feedback, which keeps
Birdie personal to the junior and respects the existing review access boundary.

Raw comments are shown as written. Distilled lessons (general principles rewritten by the user's
Birdie model) are generated once per round, on demand, and stored.

External LLM note: distilling sends the reviewer's comments and quoted document text to the
user's Birdie provider (their OpenRouter key, or the demo key in DEMO_MODE).
"""

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import ReviewAnnotation, ReviewHandoff, ReviewLesson, User
from app.services.llm_service import get_llm
from app.services.review_handoff_service import lock_handoff

FEEDBACK_STATUSES = ("returned", "completed")
MAX_LESSONS = 4
CONTEXT_COMMENT_LIMIT = 10
_FIELD_LIMIT = 400

DISTILL_PROMPT = """You turn a senior lawyer's review comments on a junior's draft into general \
lessons the junior can reuse.

Return ONLY a JSON array of 1 to 4 objects: \
{"title": "<short headline>", "body": "<1-3 sentences>", "source_annotation_ids": ["<id>", ...]}.

Rules:
- Each lesson is a transferable principle, not a restatement of one edit.
- Only state reasons the reviewer actually gave or that follow directly from their wording. Do not \
invent firm policy.
- Cite the ids of the comments each lesson came from.
- No text outside the JSON array."""


class LessonNotFound(RuntimeError):
    pass


class LessonDistillError(RuntimeError):
    pass


@dataclass
class FeedbackRound:
    handoff_id: str
    document_name: str
    reviewer_name: str | None
    status: str
    date: datetime
    annotations: list[ReviewAnnotation]
    lessons: list[ReviewLesson]


def is_feedback(annotation: ReviewAnnotation, handoff: ReviewHandoff) -> bool:
    if annotation.author_user_id == handoff.submitted_by:
        return False
    if annotation.previous_annotation_id:
        return False
    return bool((annotation.note or "").strip() or (annotation.suggested_text or "").strip())


def _handoff_date(handoff: ReviewHandoff) -> datetime:
    return handoff.completed_at or handoff.updated_at


def _rounds_query(user: User):
    return (
        select(ReviewHandoff)
        .options(
            joinedload(ReviewHandoff.document),
            joinedload(ReviewHandoff.reviewer),
            joinedload(ReviewHandoff.annotations),
        )
        .where(
            ReviewHandoff.submitted_by == user.id,
            ReviewHandoff.status.in_(FEEDBACK_STATUSES),
        )
    )


def list_feedback_rounds(db: Session, *, user: User, limit: int = 10) -> list[FeedbackRound]:
    handoffs = list(db.scalars(_rounds_query(user)).unique())
    handoffs.sort(key=_handoff_date, reverse=True)

    rounds: list[FeedbackRound] = []
    for handoff in handoffs:
        annotations = [a for a in handoff.annotations if is_feedback(a, handoff)]
        if not annotations:
            continue
        rounds.append(
            FeedbackRound(
                handoff_id=handoff.id,
                document_name=handoff.document.filename if handoff.document else "Document",
                reviewer_name=(handoff.reviewer.full_name or handoff.reviewer.email)
                if handoff.reviewer
                else None,
                status=handoff.status,
                date=_handoff_date(handoff),
                annotations=annotations,
                lessons=[],
            )
        )
        if len(rounds) >= limit:
            break

    if rounds:
        lessons = db.scalars(
            select(ReviewLesson)
            .where(ReviewLesson.handoff_id.in_([r.handoff_id for r in rounds]))
            .order_by(ReviewLesson.created_at)
        ).all()
        by_handoff: dict[str, list[ReviewLesson]] = {}
        for lesson in lessons:
            by_handoff.setdefault(lesson.handoff_id, []).append(lesson)
        for r in rounds:
            r.lessons = by_handoff.get(r.handoff_id, [])
    return rounds


def _clip(value: str | None) -> str:
    text = (value or "").strip().replace("\n", " ")
    return text if len(text) <= _FIELD_LIMIT else text[: _FIELD_LIMIT - 1] + "…"


def parse_lessons(raw: str, valid_ids: set[str]) -> list[dict]:
    """Parse the model's JSON, dropping unknown source ids. Raises LessonDistillError if unusable."""
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        raise LessonDistillError("Birdie could not turn this feedback into lessons")
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError as exc:
        raise LessonDistillError("Birdie could not turn this feedback into lessons") from exc
    lessons: list[dict] = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:200]
        body = str(item.get("body") or "").strip()
        if not title or not body:
            continue
        sources = [
            s for s in (item.get("source_annotation_ids") or []) if isinstance(s, str) and s in valid_ids
        ]
        lessons.append({"title": title, "body": body, "source_annotation_ids": sources})
        if len(lessons) >= MAX_LESSONS:
            break
    if not lessons:
        raise LessonDistillError("Birdie could not turn this feedback into lessons")
    return lessons


def _distill_messages(document_name: str, annotations: list[ReviewAnnotation]) -> list[dict]:
    lines = [f'Document: "{document_name}"', "Review comments:"]
    for a in annotations:
        lines.append(
            f"- id={a.id} (page {a.page_no}) quoted: \"{_clip(a.anchor_quote)}\""
            + (f" | suggested: \"{_clip(a.suggested_text)}\"" if a.suggested_text else "")
            + (f" | note: \"{_clip(a.note)}\"" if a.note else "")
        )
    return [
        {"role": "system", "content": DISTILL_PROMPT},
        {"role": "user", "content": "\n".join(lines)},
    ]


async def distill_lessons(db: Session, *, user: User, handoff_id: str) -> list[ReviewLesson]:
    handoff = db.scalar(_rounds_query(user).where(ReviewHandoff.id == handoff_id))
    if handoff is None:
        raise LessonNotFound("No feedback found for this review round")
    annotations = [a for a in handoff.annotations if is_feedback(a, handoff)]
    if not annotations:
        raise LessonNotFound("No feedback found for this review round")

    existing = _stored_lessons(db, handoff_id)
    if existing:
        return existing

    messages = _distill_messages(handoff.document.filename, annotations)
    valid_ids = {a.id for a in annotations}
    provider = get_llm(db, user.id, feature="lessons")
    db.rollback()  # release the read transaction before the slow provider call

    raw = await provider.complete(messages)
    parsed = parse_lessons(raw, valid_ids)

    # Serialise with other writers on this round; the first commit wins.
    if lock_handoff(db, handoff_id) is None:
        raise LessonNotFound("No feedback found for this review round")
    existing = _stored_lessons(db, handoff_id)
    if existing:
        db.rollback()
        return existing
    created = [ReviewLesson(handoff_id=handoff_id, **item) for item in parsed]
    db.add_all(created)
    db.commit()
    return _stored_lessons(db, handoff_id)


def _stored_lessons(db: Session, handoff_id: str) -> list[ReviewLesson]:
    return list(
        db.scalars(
            select(ReviewLesson)
            .where(ReviewLesson.handoff_id == handoff_id)
            .order_by(ReviewLesson.created_at)
        )
    )


def format_feedback_context(db: Session, *, user: User) -> str:
    """Recent reviewer comments for Birdie's system prompt ('why did my reviewer change this?')."""
    rounds = list_feedback_rounds(db, user=user, limit=5)
    lines: list[str] = []
    for r in rounds:
        for a in r.annotations:
            if len(lines) >= CONTEXT_COMMENT_LIMIT:
                break
            who = r.reviewer_name or "a reviewer"
            parts = [f'On "{r.document_name}", {who} commented on "{_clip(a.anchor_quote)}"']
            if a.suggested_text:
                parts.append(f'suggested "{_clip(a.suggested_text)}"')
            if a.note:
                parts.append(f'because: {_clip(a.note)}')
            lines.append("- " + "; ".join(parts))
    if not lines:
        return ""
    return "\n\nRecent feedback from the user's reviewers on their drafts:\n" + "\n".join(lines)
