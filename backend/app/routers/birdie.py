"""Birdie — the stateless mentor agent. Separate from /chat."""

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.providers.deepseek import DeepSeekError
from app.schemas import PageContext
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
        except DeepSeekError as exc:
            yield event("error", {"detail": str(exc)})
        except Exception as exc:
            print(f"Birdie stream error: {exc!r}")
            yield event("error", {"detail": "An unexpected error occurred"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
