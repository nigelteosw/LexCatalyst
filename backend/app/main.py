import json

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_or_create_user, verify_google_token
from app.config import get_settings
from app.database import create_db_tables, get_db
from app.dependencies import get_current_user
from app.models import User
from app.providers.deepseek import DeepSeekError, DeepSeekProvider
from app.schemas import (
    ChatMessageResponse,
    ChatRequest,
    ChatResponse,
    ChatThreadResponse,
    MemoryCreate,
    MemoryResponse,
    MemoryUpdate,
)
from app.services.chat_service import (
    create_chat_request,
    create_chat_response,
    list_thread_messages,
    list_threads,
    save_assistant_response,
)
from app.services.memory_service import (
    create_memory,
    delete_memory,
    list_memories,
    update_memory,
)

app = FastAPI(title="LexCatalyst API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    try:
        create_db_tables()
    except SQLAlchemyError as exc:
        print(f"Database startup skipped: {exc}")


class GoogleAuthRequest(BaseModel):
    credential: str


@app.post("/auth/google")
async def auth_google(request: GoogleAuthRequest, db: Session = Depends(get_db)):
    try:
        # 1. Verify Google Token
        google_info = verify_google_token(request.credential)

        # 2. Get or Create User
        user = get_or_create_user(db, google_info)

        # 3. Create Local JWT
        access_token = create_access_token(data={"sub": user.id})

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
                "full_name": user.full_name,
            },
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/config")
def config() -> dict[str, str]:
    settings = get_settings()
    return {
        "deepseek_model": settings.deepseek_model,
        "deepseek_base_url": settings.deepseek_base_url,
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatResponse:
    try:
        thread, assistant_message = await create_chat_response(
            db,
            user_message=request.message,
            user_id=current_user.id,
            thread_id=request.thread_id,
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc

    return ChatResponse(
        thread_id=thread.id,
        message=ChatMessageResponse.model_validate(assistant_message),
        model=assistant_message.model or get_settings().deepseek_model,
    )


@app.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    def event(name: str, payload: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(payload)}\n\n"

    async def stream():
        try:
            thread, provider_messages = create_chat_request(
                db,
                user_message=request.message,
                user_id=current_user.id,
                thread_id=request.thread_id,
            )
            yield event("thread", {"thread_id": thread.id, "title": thread.title})

            provider = DeepSeekProvider()
            chunks: list[str] = []
            async for chunk in provider.stream_chat(provider_messages):
                chunks.append(chunk)
                yield event("token", {"content": chunk})

            assistant_content = "".join(chunks).strip()
            if not assistant_content:
                yield event("error", {"detail": "DeepSeek returned an empty response"})
                return

            assistant_message = await save_assistant_response(
                db,
                user_id=current_user.id,
                thread=thread,
                content=assistant_content,
                user_message=request.message,
            )
            yield event(
                "done",
                {
                    "thread_id": thread.id,
                    "message": ChatMessageResponse.model_validate(assistant_message).model_dump(
                        mode="json"
                    ),
                    "model": assistant_message.model or get_settings().deepseek_model,
                },
            )
        except DeepSeekError as exc:
            yield event("error", {"detail": str(exc)})
        except SQLAlchemyError:
            yield event("error", {"detail": "Chat database is unavailable"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/chat/threads", response_model=list[ChatThreadResponse])
def chat_threads(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[ChatThreadResponse]:
    try:
        return [
            ChatThreadResponse.model_validate(thread)
            for thread in list_threads(db, current_user.id)
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc


@app.get("/chat/threads/{thread_id}/messages", response_model=list[ChatMessageResponse])
def chat_messages(
    thread_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatMessageResponse]:
    try:
        messages = list_thread_messages(db, thread_id, current_user.id)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Chat database is unavailable") from exc

    if not messages:
        raise HTTPException(status_code=404, detail="Chat thread not found")

    return [ChatMessageResponse.model_validate(message) for message in messages]


# Memory Endpoints


@app.get("/memories", response_model=list[MemoryResponse])
def get_memories(
    category: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MemoryResponse]:
    try:
        memories = list_memories(db, user_id=current_user.id, category=category)
        return [MemoryResponse.model_validate(m) for m in memories]
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.post("/memories", response_model=MemoryResponse)
def post_memory(
    schema: MemoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemoryResponse:
    try:
        memory = create_memory(db, user_id=current_user.id, schema=schema)
        return MemoryResponse.model_validate(memory)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.patch("/memories/{memory_id}", response_model=MemoryResponse)
def patch_memory(
    memory_id: str,
    schema: MemoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemoryResponse:
    try:
        memory = update_memory(db, user_id=current_user.id, memory_id=memory_id, schema=schema)
        if not memory:
            raise HTTPException(status_code=404, detail="Memory not found")
        return MemoryResponse.model_validate(memory)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@app.delete("/memories/{memory_id}")
def delete_memory_endpoint(
    memory_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        success = delete_memory(db, user_id=current_user.id, memory_id=memory_id)
        if not success:
            raise HTTPException(status_code=404, detail="Memory not found")
        return {"status": "ok"}
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")
