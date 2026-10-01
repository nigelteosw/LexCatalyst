"""Birdie — the stateless mentor agent. Separate from /chat."""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.providers.deepseek import DeepSeekError
from app.providers.openrouter import OpenRouterError
from app.schemas import FeedbackRoundResponse, LessonResponse, PageContext
from app.services import lesson_service
from app.services.birdie_service import stream_birdie_response

router = APIRouter(tags=["birdie"])


class BirdieMessage(BaseModel):
    role: str
    content: str



class BirdieRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    history: list[BirdieMessage] = Field(default_factory=list, max_length=40)
    matter_id: str | None = None
    page_context: PageContext | None = None


@router.post("/birdie/stream")
async def birdie_stream(
    request: BirdieRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    def event(name: str, payload: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    async def stream():
        try:
            chunks: list[str] = []
            async for token in stream_birdie_response(
                db,
                user=current_user,
                user_message=request.message,
                history=[{"role": m.role, "content": m.content} for m in request.history],
                matter_id=request.matter_id,
                page_context=request.page_context,
            ):
                chunks.append(token)
                yield event("token", {"content": token})

            full_response = "".join(chunks).strip()
            if not full_response:
                yield event("error", {"detail": "Birdie returned an empty response"})
                return
            yield event("done", {"content": full_response})
        except (DeepSeekError, OpenRouterError) as exc:
            yield event("error", {"detail": str(exc)})
        except Exception as exc:
            print(f"Birdie stream error: {exc!r}")
            yield event("error", {"detail": "An unexpected error occurred"})

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
    except (lesson_service.LessonDistillError, DeepSeekError, OpenRouterError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [LessonResponse.model_validate(l, from_attributes=True) for l in lessons]
