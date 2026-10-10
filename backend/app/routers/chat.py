"""Chat — agentic streaming, threads, and messages."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_matter_member
from app.models import ChatThread, User
from app.providers.openrouter import OpenRouterError, OpenRouterKeyMissing
from app.providers.embedding_provider import EmbeddingError
from app.schemas import (
    ChatMessageResponse,
    ChatRequest,
    ChatResponse,
    ChatThreadResponse,
    ChatThreadUpdate,
)
from app.services.agent_service import run_agent_loop
from app.services.error_reporting import unexpected_error_detail
from app.services.mentorship_class_service import ClassAccessError, require_active_class_id, revalidate_class_access
from app.services.chat_service import (
    create_chat_response,
    delete_message,
    delete_thread,
    list_thread_messages,
    GENERAL,
    list_threads,
    persist_assistant_message,
    prepare_agent_context,
    update_thread,
    run_post_save_tasks,
    save_assistant_response,
)

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatResponse:
    if request.matter_id:
        require_matter_member(db, current_user, request.matter_id)
    try:
        thread, assistant_message = await create_chat_response(
            db,
            user_message=request.message,
            user_id=current_user.id,
            thread_id=request.thread_id,
            model=request.model,
            tier=request.tier,
            matter_id=request.matter_id,
        )
    except OpenRouterKeyMissing as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OpenRouterError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except EmbeddingError as exc:
        raise HTTPException(status_code=502, detail=f"Document search is unavailable: {exc}") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc
    except ClassAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return ChatResponse(
        thread_id=thread.id,
        message=ChatMessageResponse.model_validate(assistant_message),
        model=assistant_message.model or "",
    )


@router.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    if request.matter_id:
        require_matter_member(db, current_user, request.matter_id)
    class_id = require_active_class_id(db, current_user.id)

    def event(name: str, payload: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    async def stream():
        try:
            thread, initial_messages, selected_model = await prepare_agent_context(
                db,
                user_message=request.message,
                user_id=current_user.id,
                thread_id=request.thread_id,
                model=request.model,
                tier=request.tier,
                matter_id=request.matter_id,
            )
            revalidate_class_access(db, user_id=current_user.id, class_id=class_id)
            yield event("thread", {"thread_id": thread.id, "title": thread.title})

            chunks: list[str] = []
            tool_steps: list[dict] = []
            sources: list[dict] = []
            active_matter_id = request.matter_id or thread.matter_id

            async for event_type, event_data in run_agent_loop(
                initial_messages,
                db,
                user=current_user,
                matter_id=active_matter_id,
                model=selected_model,
            ):
                revalidate_class_access(db, user_id=current_user.id, class_id=class_id)
                if event_type == "token":
                    chunks.append(event_data["content"])
                elif event_type == "tool_call":
                    tool_steps.append({
                        "id": event_data["step_id"],
                        "tool": event_data["tool"],
                        "args": event_data["args"],
                        "summary": None,
                        "status": "running",
                    })
                elif event_type == "sources":
                    sources = event_data["sources"]
                elif event_type == "tool_result":
                    for step in reversed(tool_steps):
                        if step["id"] == event_data["step_id"]:
                            step["summary"] = event_data["summary"]
                            step["status"] = "done"
                            break
                yield event(event_type, event_data)

            assistant_content = "".join(chunks).strip()
            if not assistant_content:
                yield event(
                    "error",
                    {"detail": "The model returned no answer. Try again, or switch to a different model."},
                )
                return

            assistant_message = await persist_assistant_message(
                db,
                thread=thread,
                content=assistant_content,
                model=selected_model,
                tool_steps=tool_steps if tool_steps else None,
                sources=sources or None,
            )
            revalidate_class_access(db, user_id=current_user.id, class_id=class_id)
            yield event(
                "done",
                {
                    "thread_id": thread.id,
                    "message": ChatMessageResponse.model_validate(assistant_message).model_dump(mode="json"),
                    "model": assistant_message.model or selected_model,
                },
            )
            await run_post_save_tasks(
                db,
                user_id=current_user.id,
                thread=thread,
                assistant_message=assistant_message,
                user_message=request.message,
            )
        except ClassAccessError as exc:
            db.rollback()
            yield event("error", {"detail": str(exc)})
        except OpenRouterError as exc:
            yield event("error", {"detail": str(exc)})
        except EmbeddingError as exc:
            yield event("error", {"detail": f"Document search is unavailable: {exc}"})
        except SQLAlchemyError:
            yield event("error", {"detail": "Chat database is unavailable"})
        except Exception as exc:
            yield event("error", {"detail": unexpected_error_detail("LexChat", exc)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/chat/threads", response_model=list[ChatThreadResponse])
def chat_threads(
    matter_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatThreadResponse]:
    if matter_id and matter_id != GENERAL:
        require_matter_member(db, current_user, matter_id)
    try:
        return [
            ChatThreadResponse.model_validate(thread)
            for thread in list_threads(
                db, current_user.id, matter_filter=matter_id, limit=limit, offset=offset,
            )
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc


@router.get("/chat/threads/{thread_id}/messages", response_model=list[ChatMessageResponse])
def chat_messages(
    thread_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    before_message_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessageResponse]:
    try:
        # Verify ownership separately so empty paginated responses don't 404.
        thread_exists = db.scalar(
            select(ChatThread.id).where(
                ChatThread.id == thread_id,
                ChatThread.user_id == current_user.id,
            )
        )
        if not thread_exists:
            raise HTTPException(status_code=404, detail="Chat thread not found")

        messages = list_thread_messages(
            db,
            thread_id,
            current_user.id,
            limit=limit,
            before_message_id=before_message_id,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc

    return [ChatMessageResponse.model_validate(message) for message in messages]


@router.patch("/chat/threads/{thread_id}", response_model=ChatThreadResponse)
def update_chat_thread(
    thread_id: str,
    schema: ChatThreadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatThreadResponse:
    set_matter = "matter_id" in schema.model_fields_set
    if set_matter and schema.matter_id:
        require_matter_member(db, current_user, schema.matter_id)
    try:
        thread = update_thread(
            db,
            user_id=current_user.id,
            thread_id=thread_id,
            title=schema.title,
            matter_id=schema.matter_id,
            set_matter=set_matter,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc
    if not thread:
        raise HTTPException(status_code=404, detail="Chat thread not found")
    return ChatThreadResponse.model_validate(thread)


@router.delete("/chat/threads/{thread_id}")
def delete_chat_thread(
    thread_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        ok = delete_thread(db, user_id=current_user.id, thread_id=thread_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Chat thread not found")
    return {"status": "ok"}


@router.delete("/chat/messages/{message_id}")
def delete_chat_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        ok = delete_message(db, user_id=current_user.id, message_id=message_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Chat message not found")
    return {"status": "ok"}
