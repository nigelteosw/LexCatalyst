"""Mentor lessons: general principles distilled from a mentee's mentor feedback.

Feedback reaches the mentee from three sources: review rounds on uploaded drafts, comments captured
from Google Docs or Word, and guidance written directly by a mentor. Lessons are distilled from that
feedback by the acting user's Birdie model (Mid tier, feature "lessons"). The caller must be the
mentee or an active mentor of the mentee; access is checked again after the provider call, so a
pairing that ends mid-request stores nothing.

Round-level distillation (the "distil this round" button on a returned draft) stays limited to the
submitter, as before.

External LLM note: distilling sends the mentor's comments and quoted document text to the user's
Birdie provider (their OpenRouter key, or the demo key in DEMO_MODE).
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import MentorFeedback, ReviewAnnotation, ReviewHandoff, ReviewLesson, User
from app.services.feedback_service import is_feedback, list_feedback
from app.services.llm_service import get_llm
from app.services.mentorship_class_service import (
    ClassAccessError,
    ClassContext,
    require_active_class_id,
    require_class_context,
)
from app.services.mentorship_service import can_read_mentee
from app.services.review_handoff_service import lock_handoff

FEEDBACK_STATUSES = ("returned", "completed")
MAX_LESSONS = 4
MAX_FEEDBACK_PER_DISTIL = 40
CONTEXT_COMMENT_LIMIT = 10
THEME_LIMIT = 40
DEFAULT_THEME = "General"
THEME_WINDOW_DAYS = 90
_FIELD_LIMIT = 400

DISTIL_PROMPT = """You turn a senior lawyer's feedback on a junior's work into general lessons the \
junior can reuse.

Return ONLY a JSON array of 1 to 4 objects: \
{"title": "<short headline>", "body": "<1-3 sentences>", "theme": "<2-4 word topic, e.g. Defined terms>", \
"source_feedback_ids": ["<id>", ...]}.

Rules:
- Each lesson is a transferable principle, not a restatement of one edit.
- Only state reasons the mentor actually gave or that follow directly from their wording. Do not \
invent firm policy.
- Cite the ids of the feedback items each lesson came from. Use only ids from the list.
- Reuse an existing theme name where one fits.
- No text outside the JSON array."""


class LessonNotFound(RuntimeError):
    pass


class LessonDistillError(RuntimeError):
    pass


class NothingToDistill(RuntimeError):
    pass

class FeedbackRound:
    handoff_id: str
    document_name: str
    reviewer_name: str | None
    status: str
    date: datetime
    annotations: list[ReviewAnnotation]
    lessons: list[ReviewLesson]


def _handoff_date(handoff: ReviewHandoff) -> datetime:
    return handoff.completed_at or handoff.updated_at


def _active_class_id(db: Session, user: User) -> str | None:
    # Feedback is scoped to the user's active team: rounds from a former team stay invisible.
    try:
        return require_active_class_id(db, user.id)
    except ClassAccessError:
        return None


def _rounds_query(user: User, class_id: str):
    return (
        select(ReviewHandoff)
        .options(
            joinedload(ReviewHandoff.document),
            joinedload(ReviewHandoff.reviewer),
            joinedload(ReviewHandoff.annotations),
        )
        .where(
            ReviewHandoff.submitted_by == user.id,
            ReviewHandoff.class_id == class_id,
            ReviewHandoff.status.in_(FEEDBACK_STATUSES),
        )
    )


def list_feedback_rounds(db: Session, *, user: User, limit: int = 10) -> list[FeedbackRound]:
    class_id = _active_class_id(db, user)
    if class_id is None:
        return []
    handoffs = list(db.scalars(_rounds_query(user, class_id)).unique())
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



def _normalise_theme(raw: object) -> str:
    text = " ".join(str(raw or "").split())[:THEME_LIMIT]
    return text.title() if text else DEFAULT_THEME


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
            s for s in (item.get("source_feedback_ids") or []) if isinstance(s, str) and s in valid_ids
        ]
        lessons.append({
            "title": title,
            "body": body,
            "theme": _normalise_theme(item.get("theme")),
            "source_feedback_ids": sources,
        })
        if len(lessons) >= MAX_LESSONS:
            break
    if not lessons:
        raise LessonDistillError("Birdie could not turn this feedback into lessons")
    return lessons


def _feedback_lines(rows: list[MentorFeedback]) -> list[str]:
    lines: list[str] = []
    for row in rows:
        parts = [f"- id={row.id} (source: {row.source}, from {row.author_name or 'a mentor'})"]
        if row.anchor_quote:
            parts.append(f'quoted: "{_clip(row.anchor_quote)}"')
        if row.suggested_text:
            parts.append(f'suggested: "{_clip(row.suggested_text)}"')
        if row.note:
            parts.append(f'note: "{_clip(row.note)}"')
        lines.append(" | ".join(parts))
    return lines


def _mentee_messages(rows: list[MentorFeedback]) -> list[dict]:
    return [
        {"role": "system", "content": DISTIL_PROMPT},
        {"role": "user", "content": "Mentor feedback:\n" + "\n".join(_feedback_lines(rows))},
    ]


def _round_messages(document_name: str, annotations: list[ReviewAnnotation]) -> list[dict]:
    lines = [f'Document: "{document_name}"', "Review comments:"]
    for a in annotations:
        lines.append(
            f"- id={a.id} (page {a.page_no}) quoted: \"{_clip(a.anchor_quote)}\""
            + (f" | suggested: \"{_clip(a.suggested_text)}\"" if a.suggested_text else "")
            + (f" | note: \"{_clip(a.note)}\"" if a.note else "")
        )
    return [
        {"role": "system", "content": DISTIL_PROMPT},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _cited_feedback_ids(db: Session, class_id: str, mentee_user_id: str) -> set[str]:
    cited: set[str] = set()
    lessons = db.scalars(select(ReviewLesson).where(
        ReviewLesson.class_id == class_id,
        ReviewLesson.mentee_user_id == mentee_user_id,
    )).all()
    for lesson in lessons:
        cited.update(lesson.source_feedback_ids or [])
    return cited


def _undistilled_feedback(
    db: Session, context: ClassContext, mentee_user_id: str, feedback_ids: list[str] | None
) -> list[MentorFeedback]:
    rows = list_feedback(
        db, context=context, mentee_user_id=mentee_user_id, audience="mentee", limit=MAX_FEEDBACK_PER_DISTIL * 5
    )
    if feedback_ids is not None:
        wanted = set(feedback_ids)
        if not wanted <= {r.id for r in rows}:
            raise LessonNotFound("No feedback found for this mentee")
        return [r for r in rows if r.id in wanted][:MAX_FEEDBACK_PER_DISTIL]
    cited = _cited_feedback_ids(db, context.class_id, mentee_user_id)
    return [r for r in rows if r.id not in cited][:MAX_FEEDBACK_PER_DISTIL]


async def distill_lessons(
    db: Session,
    *,
    user: User,
    mentee_user_id: str | None = None,
    feedback_ids: list[str] | None = None,
) -> list[ReviewLesson]:
    context = require_class_context(db, user)
    mentee_id = mentee_user_id or user.id
    if not can_read_mentee(db, context=context, mentee_user_id=mentee_id):
        raise LessonNotFound("No feedback found for this mentee")

    candidates = _undistilled_feedback(db, context, mentee_id, feedback_ids)
    if not candidates:
        raise NothingToDistill("Nothing new to distil")

    messages = _mentee_messages(candidates)
    valid_ids = {r.id for r in candidates}
    provider = get_llm(db, user.id, feature="lessons")
    db.rollback()  # release the read transaction before the slow provider call

    raw = await provider.complete(messages)
    parsed = parse_lessons(raw, valid_ids)

    # Re-check live access: a pairing or membership that ended during the call stores nothing.
    context = require_class_context(db, user)
    if not can_read_mentee(db, context=context, mentee_user_id=mentee_id):
        db.rollback()
        raise LessonNotFound("No feedback found for this mentee")

    created = [
        ReviewLesson(
            class_id=context.class_id,
            mentee_user_id=mentee_id,
            handoff_id=None,
            title=item["title"],
            body=item["body"],
            theme=item["theme"],
            source_annotation_ids=[],
            source_feedback_ids=item["source_feedback_ids"],
        )
        for item in parsed
    ]
    db.add_all(created)
    db.commit()
    return created


async def distill_round_lessons(db: Session, *, user: User, handoff_id: str) -> list[ReviewLesson]:
    class_id = _active_class_id(db, user)
    handoff = None
    if class_id is not None:
        handoff = db.scalar(_rounds_query(user, class_id).where(ReviewHandoff.id == handoff_id))
    if handoff is None:
        raise LessonNotFound("No feedback found for this review round")
    annotations = [a for a in handoff.annotations if is_feedback(a, handoff)]
    if not annotations:
        raise LessonNotFound("No feedback found for this review round")

    existing = _stored_lessons(db, handoff_id)
    if existing:
        return existing

    messages = _round_messages(handoff.document.filename, annotations)
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

    feedback_by_annotation = _feedback_ids_by_annotation(db, handoff_id)
    created = [
        ReviewLesson(
            class_id=class_id,
            mentee_user_id=user.id,
            handoff_id=handoff_id,
            title=item["title"],
            body=item["body"],
            theme=item["theme"],
            source_annotation_ids=[],
            source_feedback_ids=[
                feedback_by_annotation[a] for a in item["source_feedback_ids"] if a in feedback_by_annotation
            ],
        )
        for item in parsed
    ]
    db.add_all(created)
    db.commit()
    return _stored_lessons(db, handoff_id)


def _feedback_ids_by_annotation(db: Session, handoff_id: str) -> dict[str, str]:
    rows = db.scalars(select(MentorFeedback).where(
        MentorFeedback.handoff_id == handoff_id,
        MentorFeedback.annotation_id.is_not(None),
    )).all()
    return {row.annotation_id: row.id for row in rows}


def list_lessons(db: Session, *, context: ClassContext, mentee_user_id: str | None = None) -> list[ReviewLesson]:
    mentee_id = mentee_user_id or context.user_id
    if not can_read_mentee(db, context=context, mentee_user_id=mentee_id):
        return []
    return list(db.scalars(select(ReviewLesson).where(
        ReviewLesson.class_id == context.class_id,
        ReviewLesson.mentee_user_id == mentee_id,
    ).order_by(ReviewLesson.created_at.desc())))


@dataclass
class ThemeSummary:
    theme: str
    count: int
    latest: datetime
    titles: list[str]


def themes_for_mentee(
    db: Session, *, context: ClassContext, mentee_user_id: str, days: int = THEME_WINDOW_DAYS
) -> list[ThemeSummary]:
    if not can_read_mentee(db, context=context, mentee_user_id=mentee_user_id):
        return []
    since = datetime.now(UTC) - timedelta(days=days)
    lessons = db.scalars(select(ReviewLesson).where(
        ReviewLesson.class_id == context.class_id,
        ReviewLesson.mentee_user_id == mentee_user_id,
        ReviewLesson.created_at >= since,
    ).order_by(ReviewLesson.created_at.desc())).all()
    groups: dict[str, ThemeSummary] = {}
    for lesson in lessons:
        group = groups.get(lesson.theme)
        if group is None:
            group = groups[lesson.theme] = ThemeSummary(theme=lesson.theme, count=0, latest=lesson.created_at, titles=[])
        group.count += 1
        if len(group.titles) < 3:
            group.titles.append(lesson.title)
    return sorted(groups.values(), key=lambda g: (-g.count, g.theme))


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
