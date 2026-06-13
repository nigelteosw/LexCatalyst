"""Wellbeing surveys — structurally anonymous responses + partner aggregates."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_partner_or_admin
from app.models import User
from app.schemas import (
    SurveyQuestionCreate,
    SurveyQuestionResponse,
    SurveyQuestionUpdate,
    SurveyResponseCreate,
    SurveyResultsResponse,
)
from app.services.survey_service import (
    create_survey_question,
    get_survey_results,
    list_survey_questions,
    submit_survey_response,
    update_survey_question,
)

router = APIRouter(tags=["surveys"])


@router.get("/survey/questions", response_model=list[SurveyQuestionResponse])
def get_survey_questions(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[SurveyQuestionResponse]:
    return [
        SurveyQuestionResponse.model_validate(q)
        for q in list_survey_questions(db, active_only=active_only)
    ]


@router.post(
    "/survey/questions",
    response_model=SurveyQuestionResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_survey_question(
    schema: SurveyQuestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyQuestionResponse:
    require_partner_or_admin(current_user)
    q = create_survey_question(db, user=current_user, schema=schema)
    return SurveyQuestionResponse.model_validate(q)


@router.patch("/survey/questions/{question_id}", response_model=SurveyQuestionResponse)
def patch_survey_question(
    question_id: str,
    schema: SurveyQuestionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyQuestionResponse:
    require_partner_or_admin(current_user)
    q = update_survey_question(db, question_id=question_id, schema=schema)
    if not q:
        raise HTTPException(status_code=404, detail="Survey question not found")
    return SurveyQuestionResponse.model_validate(q)


@router.post("/survey/responses", status_code=status.HTTP_201_CREATED)
def post_survey_response(
    schema: SurveyResponseCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    submit_survey_response(db, schema=schema)
    return {"status": "ok"}


@router.get("/survey/results", response_model=SurveyResultsResponse)
def survey_results(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SurveyResultsResponse:
    require_partner_or_admin(current_user)
    return SurveyResultsResponse(questions=get_survey_results(db))
