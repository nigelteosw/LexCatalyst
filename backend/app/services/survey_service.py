from datetime import datetime, timezone

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import SurveyQuestion, SurveyResponse, User
from app.schemas import SurveyQuestionCreate, SurveyQuestionUpdate, SurveyResponseCreate


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
    schema: SurveyResponseCreate,
) -> SurveyResponse:
    week_of = schema.week_of.replace(tzinfo=timezone.utc) if schema.week_of.tzinfo is None else schema.week_of
    response = SurveyResponse(
        question_id=schema.question_id,
        score=schema.score,
        week_of=week_of,
    )
    db.add(response)
    db.commit()
    db.refresh(response)
    return response


def get_survey_results(db: Session) -> list[dict]:
    questions = list_survey_questions(db, active_only=False)
    results = []
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
        results.append(
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
    return results
