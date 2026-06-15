from datetime import datetime, timedelta, timezone
import random

from sqlalchemy import desc, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import SurveyQuestion, SurveyResponse, User
from app.schemas import (
    SurveyQuestionCreate,
    SurveyQuestionUpdate,
    SurveyResponseCreate,
    SurveyResponseItem,
)


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


def delete_survey_question(db: Session, question_id: str) -> bool:
    question = db.get(SurveyQuestion, question_id)
    if not question:
        return False
    db.delete(question)
    db.commit()
    return True


def seed_survey_questions(db: Session) -> None:
    """Populate the survey questions with a baseline if the table is empty.

    This baseline focuses on workload pressure, burnout risk, team frictions,
    and barriers to learning/growth.
    """
    count = db.scalar(select(func.count(SurveyQuestion.id)))
    if count > 0:
        return

    baseline = [
        # 1. Workload
        ("workload", "I had more work than I could reasonably complete within normal working hours."),
        ("workload", "I frequently had to work late nights, weekends, or during rest time to keep up."),
        ("workload", "I received urgent or last-minute requests without enough clarity on priority, deadline, or expected output."),
        ("workload", "My workload felt unpredictable or difficult to plan around."),

        # 2. Mental Health
        ("mental_health", "I felt emotionally or mentally drained by work."),
        ("mental_health", "I found it difficult to switch off from work during non-working time."),
        ("mental_health", "I noticed myself becoming more detached, cynical, or less motivated about work."),
        ("mental_health", "Work pressure affected my focus, judgement, sleep, or ability to recover."),

        # 3. Team Dynamics
        ("team_dynamics", "I felt comfortable telling a supervisor or team member when my workload was becoming unmanageable."),
        ("team_dynamics", "I received useful support when I asked for help, clarification, or prioritisation."),
        ("team_dynamics", "Work was allocated in a way that felt fair and transparent."),
        ("team_dynamics", "I could raise concerns, mistakes, or capacity issues without fear that it would affect how I am viewed."),

        # 4. Learning & Growth
        ("learning", "My current workload left enough time for learning, feedback, and reflection."),
        ("learning", "I received clear guidance or feedback that helped me improve."),
        ("learning", "I had opportunities to do meaningful work, not just urgent execution."),
        ("learning", "I can see a sustainable path for my professional growth in this team."),
    ]

    for idx, (cat, text) in enumerate(baseline):
        db.add(SurveyQuestion(
            category=cat,
            text=text,
            order_index=idx,
        ))
    db.commit()


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


def submit_survey_responses(
    db: Session,
    *,
    user: User,
    responses: list[SurveyResponseItem],
) -> int:
    response_by_question = {response.question_id: response.score for response in responses}
    if len(response_by_question) != len(responses):
        raise ValueError("Each survey question may only be submitted once")

    question_ids = set(response_by_question)
    active_question_ids = set(
        db.scalars(
            select(SurveyQuestion.id).where(
                SurveyQuestion.id.in_(question_ids),
                SurveyQuestion.is_active.is_(True),
            )
        )
    )
    if active_question_ids != question_ids:
        raise ValueError("One or more survey questions are missing or inactive")

    week_of = current_week_start()
    submitted_at = datetime.now(timezone.utc)
    rows = [
        {
            "user_id": user.id,
            "question_id": question_id,
            "score": score,
            "week_of": week_of,
            "submitted_at": submitted_at,
        }
        for question_id, score in response_by_question.items()
    ]
    statement = insert(SurveyResponse).values(rows)
    statement = statement.on_conflict_do_update(
        constraint="uq_survey_response_user_question_week",
        set_={
            "score": statement.excluded.score,
            "submitted_at": statement.excluded.submitted_at,
        },
    )
    db.execute(statement)
    db.commit()
    return len(rows)


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

    trend_rows = db.execute(
        select(
            SurveyResponse.question_id,
            SurveyResponse.week_of,
            func.avg(SurveyResponse.score).label("avg_score"),
            func.count(SurveyResponse.id).label("response_count"),
        )
        .group_by(SurveyResponse.question_id, SurveyResponse.week_of)
        .order_by(SurveyResponse.question_id, desc(SurveyResponse.week_of))
    ).all()
    trends_by_question: dict[str, list[dict]] = {}
    for row in trend_rows:
        trends_by_question.setdefault(row.question_id, []).append(
            {
                "week_of": row.week_of,
                "avg_score": float(row.avg_score),
                "response_count": row.response_count,
            }
        )

    question_results = [
        {
            "question_id": question.id,
            "question_text": question.text,
            "category": question.category,
            "weeks": trends_by_question.get(question.id, []),
        }
        for question in questions
    ]
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
