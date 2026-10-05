"""Birdie — the stateless mentor agent. Separate from /chat."""

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.services.birdie_workboard_service import _require_matter
from app.models import User
from app.providers.openrouter import OpenRouterError, OpenRouterKeyMissing
from app.services.error_reporting import unexpected_error_detail
from app.schemas import FeedbackRoundResponse, LessonResponse, LlmTier, PageContext, WebContext
from app.services import lesson_service
from app.services.llm_service import get_llm
from app.services.case_law_service import case_source_payload, find_case_sources, validate_case_citations
from app.services.birdie_service import stream_birdie_response

router = APIRouter(tags=["birdie"])


class BirdieMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)



class BirdieRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    history: list[BirdieMessage] = Field(default_factory=list, max_length=40)
    matter_id: str | None = None
    page_context: PageContext | None = None
    web_context: WebContext | None = None
    tier: LlmTier | None = None
    model: str | None = Field(default=None, max_length=200)


@router.post("/birdie/stream")
async def birdie_stream(
    request: BirdieRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    try:
        _require_matter(db, current_user, request.matter_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    def event(name: str, payload: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    async def stream():
        try:
            case_sources = await find_case_sources(
                db,
                user=current_user,
                provider=get_llm(db, current_user.id, feature="birdie", tier=request.tier, model=request.model),
                user_message=request.message,
                web_text=request.web_context.text if request.web_context else "",
            )
            if case_sources:
                yield event("sources", {"cases": [case_source_payload(s) for s in case_sources]})

            chunks: list[str] = []
            async for event_name, payload in stream_birdie_response(
                db,
                user=current_user,
                user_message=request.message,
                history=[{"role": m.role, "content": m.content} for m in request.history],
                matter_id=request.matter_id,
                page_context=request.page_context,
                web_context=request.web_context,
                case_sources=case_sources,
                tier=request.tier,
                model=request.model,
            ):
                if event_name == 'token':
                    chunks.append(payload['content'])
                yield event(event_name, payload)

            full_response = "".join(chunks).strip()
            if not full_response:
                yield event(
                    "error",
                    {"detail": "Birdie returned no answer. Try again, or switch to a different model."},
                )
                return
            warning = validate_case_citations(full_response, case_sources)
            if warning:
                yield event("token", {"content": warning})
                full_response += warning
            yield event("done", {"content": full_response})
        except OpenRouterError as exc:
            yield event("error", {"detail": str(exc)})
        except Exception as exc:
            yield event("error", {"detail": unexpected_error_detail("Birdie", exc)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/birdie/lessons", response_model=list[FeedbackRoundResponse])
def list_lessons(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[FeedbackRoundResponse]:
    """Reviewer feedback on the current user's own returned/completed review rounds."""
    return [
        FeedbackRoundResponse(
            handoff_id=r.handoff_id,
            document_name=r.document_name,
            reviewer_name=r.reviewer_name,
            status=r.status,
            date=r.date,
            annotations=[
                {
                    "id": a.id,
                    "page_no": a.page_no,
                    "anchor_quote": a.anchor_quote,
                    "suggested_text": a.suggested_text,
                    "note": a.note,
                }
                for a in r.annotations
            ],
            lessons=[LessonResponse.model_validate(l, from_attributes=True) for l in r.lessons],
        )
        for r in lesson_service.list_feedback_rounds(db, user=current_user)
    ]


@router.post("/birdie/lessons/{handoff_id}/distill", response_model=list[LessonResponse])
async def distill_lessons(
    handoff_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[LessonResponse]:
    """Idempotent: returns stored lessons, or distils them once. Submitter only."""
    try:
        lessons = await lesson_service.distill_lessons(db, user=current_user, handoff_id=handoff_id)
    except lesson_service.LessonNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OpenRouterKeyMissing as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (lesson_service.LessonDistillError, OpenRouterError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [LessonResponse.model_validate(l, from_attributes=True) for l in lessons]
