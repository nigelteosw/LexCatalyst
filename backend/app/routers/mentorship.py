"""Mentorship pairings, mentor feedback, lessons and themes. Every route needs an active class."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import MentorPairing, User
from app.providers.openrouter import OpenRouterError, OpenRouterKeyMissing
from app.schemas import (
    DistillRequest,
    FeedbackUpdate,
    GuidanceCreate,
    MentorFeedbackResponse,
    MentorLessonResponse,
    MentorshipMeResponse,
    PairingCreate,
    PairingResponse,
    PersonResponse,
    ThemeResponse,
)
from app.services import feedback_service, lesson_service, mentorship_service
from app.services.mentorship_class_service import ClassAccessError, require_class_context

router = APIRouter(prefix="/mentorship", tags=["mentorship"])


def _name(user: User | None) -> str:
    if user is None:
        return "Unknown member"
    return user.full_name or user.email


def _person(user: User) -> PersonResponse:
    return PersonResponse(user_id=user.id, name=_name(user))


def _access_error(exc: ClassAccessError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _pairing_response(db: Session, pairing: MentorPairing) -> PairingResponse:
    return PairingResponse(
        id=pairing.id,
        mentor_user_id=pairing.mentor_user_id,
        mentor_name=_name(db.get(User, pairing.mentor_user_id)),
        mentee_user_id=pairing.mentee_user_id,
        mentee_name=_name(db.get(User, pairing.mentee_user_id)),
        created_at=pairing.created_at,
    )


def _feedback_response(row) -> MentorFeedbackResponse:
    return MentorFeedbackResponse(
        id=row.id,
        audience=row.audience,
        mentee_user_id=row.mentee_user_id,
        author_user_id=row.author_user_id,
        author_name=row.author_name,
        source=row.source,
        handoff_id=row.handoff_id,
        source_url=row.source_url,
        source_title=row.source_title,
        anchor_quote=row.anchor_quote,
        suggested_text=row.suggested_text,
        note=row.note,
        created_at=row.created_at,
    )


def _lesson_response(row) -> MentorLessonResponse:
    return MentorLessonResponse(
        id=row.id,
        title=row.title,
        body=row.body,
        theme=row.theme,
        mentee_user_id=row.mentee_user_id,
        handoff_id=row.handoff_id,
        source_feedback_ids=list(row.source_feedback_ids or []),
        created_at=row.created_at,
    )


@router.get("/pairings", response_model=list[PairingResponse])
def list_pairings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        context = require_class_context(db, current_user)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return [_pairing_response(db, p) for p in mentorship_service.list_pairings(db, context=context)]


@router.post("/pairings", response_model=PairingResponse, status_code=201)
def create_pairing(
    body: PairingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        context = require_class_context(db, current_user)
        pairing = mentorship_service.create_pairing(
            db, context=context, mentor_user_id=body.mentor_user_id, mentee_user_id=body.mentee_user_id
        )
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return _pairing_response(db, pairing)


@router.delete("/pairings/{pairing_id}", status_code=204)
def end_pairing(pairing_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        context = require_class_context(db, current_user)
        mentorship_service.end_pairing(db, context=context, pairing_id=pairing_id)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return Response(status_code=204)


@router.get("/me", response_model=MentorshipMeResponse)
def my_relationships(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        context = require_class_context(db, current_user)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    mentors, mentees = mentorship_service.relationships_for(db, context=context)
    return MentorshipMeResponse(mentors=[_person(u) for u in mentors], mentees=[_person(u) for u in mentees])


@router.get("/feedback", response_model=list[MentorFeedbackResponse])
def list_feedback(
    mentee_id: str | None = Query(default=None),
    source: str | None = Query(default=None),
    audience: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        context = require_class_context(db, current_user)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    rows = feedback_service.list_feedback(
        db, context=context, mentee_user_id=mentee_id, source=source, audience=audience
    )
    return [_feedback_response(r) for r in rows]


@router.post("/feedback", response_model=MentorFeedbackResponse, status_code=201)
def create_guidance(
    body: GuidanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        context = require_class_context(db, current_user)
        row = feedback_service.create_guidance(
            db,
            context=context,
            audience=body.audience,
            mentee_user_id=body.mentee_user_id,
            note=body.note,
            anchor_quote=body.anchor_quote,
            suggested_text=body.suggested_text,
        )
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return _feedback_response(row)


@router.patch("/feedback/{feedback_id}", response_model=MentorFeedbackResponse)
def update_feedback(
    feedback_id: str,
    body: FeedbackUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        context = require_class_context(db, current_user)
        row = feedback_service.update_feedback(
            db,
            context=context,
            feedback_id=feedback_id,
            note=body.note,
            anchor_quote=body.anchor_quote,
            suggested_text=body.suggested_text,
        )
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return _feedback_response(row)


@router.delete("/feedback/{feedback_id}", status_code=204)
def delete_feedback(feedback_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        context = require_class_context(db, current_user)
        feedback_service.delete_feedback(db, context=context, feedback_id=feedback_id)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return Response(status_code=204)


@router.get("/lessons", response_model=list[MentorLessonResponse])
def list_lessons(
    mentee_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        context = require_class_context(db, current_user)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return [_lesson_response(l) for l in lesson_service.list_lessons(db, context=context, mentee_user_id=mentee_id)]


@router.post("/lessons/distill", response_model=list[MentorLessonResponse])
async def distill_lessons(
    body: DistillRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        lessons = await lesson_service.distill_lessons(
            db,
            user=current_user,
            mentee_user_id=body.mentee_user_id,
            feedback_ids=body.feedback_ids,
        )
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    except lesson_service.LessonNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except lesson_service.NothingToDistill as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OpenRouterKeyMissing as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (lesson_service.LessonDistillError, OpenRouterError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [_lesson_response(l) for l in lessons]


@router.get("/mentees/{mentee_id}/themes", response_model=list[ThemeResponse])
def mentee_themes(
    mentee_id: str,
    days: int = Query(default=90, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        context = require_class_context(db, current_user)
    except ClassAccessError as exc:
        raise _access_error(exc) from exc
    return [
        ThemeResponse(theme=t.theme, count=t.count, latest=t.latest, titles=t.titles)
        for t in lesson_service.themes_for_mentee(db, context=context, mentee_user_id=mentee_id, days=days)
    ]
