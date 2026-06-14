from datetime import datetime, timedelta, timezone
import random

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import SurveyQuestion, SurveyResponse, User
from app.schemas import SurveyQuestionCreate, SurveyQuestionUpdate, SurveyResponseCreate


def current_week_start() -> datetime:
    now = datetime.now(timezone.utc)
    return (now - timedelta(days=now.weekday())).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )


def list_survey_questions(db: Session, *, active_only: bool = True) -> list[SurveyQuestion]:
    stmt = select(SurveyQuestion)
    if active_only:
        stmt = stmt.where(SurveyQuestion.is_active.is_(True))
    return list(db.scalars(stmt.order_by(SurveyQuestion.order_index, SurveyQuestion.created_at)))


def get_survey_question(db: Session, question_id: str) -> SurveyQuestion | None:
    return db.get(SurveyQuestion, question_id)


def create_survey_question(
    db: Session,
    *,
    user: User,
    schema: SurveyQuestionCreate,
) -> SurveyQuestion:
    question = SurveyQuestion(
        text=schema.text,
        category=schema.category,
        order_index=schema.order_index,
        created_by_id=user.id,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def update_survey_question(
    db: Session,
    *,
    question_id: str,
    schema: SurveyQuestionUpdate,
) -> SurveyQuestion | None:
    question = db.get(SurveyQuestion, question_id)
    if not question:
        return None
    for field, value in schema.model_dump(exclude_unset=True).items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


def submit_survey_response(
    db: Session,
    *,
    user: User,
    schema: SurveyResponseCreate,
) -> SurveyResponse:
    week_of = current_week_start()
    response = db.scalar(
        select(SurveyResponse).where(
            SurveyResponse.user_id == user.id,
            SurveyResponse.question_id == schema.question_id,
            SurveyResponse.week_of == week_of,
        )
    )
    if response:
        response.score = schema.score
        response.submitted_at = datetime.now(timezone.utc)
    else:
        response = SurveyResponse(
            user_id=user.id,
            question_id=schema.question_id,
            score=schema.score,
            week_of=week_of,
        )
        db.add(response)
    db.commit()
    db.refresh(response)
    return response


def get_survey_results(db: Session) -> dict:
    week_of = current_week_start()
    questions = list_survey_questions(db, active_only=False)
    active_question_count = sum(question.is_active for question in questions)
    
    # Redact identities to ensure anonymity as requested.
    # We fetch all users but shuffle them so the order doesn't match the firm directory.
    users = list(db.scalars(select(User)))
    random.shuffle(users)
    
    user_rows = db.execute(
        select(
            SurveyResponse.user_id,
            func.avg(SurveyResponse.score).label("average_score"),
            func.count(SurveyResponse.id).label("response_count"),
        )
        .join(SurveyQuestion, SurveyQuestion.id == SurveyResponse.question_id)
        .where(
            SurveyResponse.user_id.is_not(None),
            SurveyResponse.week_of == week_of,
            SurveyQuestion.is_active.is_(True),
        )
        .group_by(SurveyResponse.user_id)
    ).all()
    user_scores = {row.user_id: row for row in user_rows}

    question_results = []
    for question in questions:
        rows = db.execute(
            select(
                SurveyResponse.week_of,
                func.avg(SurveyResponse.score).label("avg_score"),
                func.count(SurveyResponse.id).label("response_count"),
            )
            .where(SurveyResponse.question_id == question.id)
            .group_by(SurveyResponse.week_of)
            .order_by(desc(SurveyResponse.week_of))
        ).all()
        question_results.append(
            {
                "question_id": question.id,
                "question_text": question.text,
                "category": question.category,
                "weeks": [
                    {
                        "week_of": row.week_of,
                        "avg_score": float(row.avg_score),
                        "response_count": row.response_count,
                    }
                    for row in rows
                ],
            }
        )
    return {
        "current_week_of": week_of,
        "users": [
            {
                "user_id": f"anon-{i}",
                "full_name": f"Contributor {i+1}",
                "email": "redacted@lexcatalyst.local",
                "firm_role": user.firm_role,
                "week_of": week_of,
                "average_score": (
                    float(user_scores[user.id].average_score)
                    if user.id in user_scores
                    else None
                ),
                "response_count": (
                    user_scores[user.id].response_count
                    if user.id in user_scores
                    else 0
                ),
                "question_count": active_question_count,
            }
            for i, user in enumerate(users)
        ],
        "questions": question_results,
    }
