"""Personal memory store."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import (
    AcceptedDreamProposal,
    DreamApplyResult,
    DreamJobStatus,
    MemoryCreate,
    MemoryResponse,
    MemoryUpdate,
)
from app.services.dream_service import (
    apply_dream_proposal,
    get_dream_job,
    start_dream_job,
)
from app.services.memory_service import (
    create_memory,
    delete_memory,
    list_memories,
    update_memory,
)

router = APIRouter(tags=["memories"])


@router.get("/memories", response_model=list[MemoryResponse])
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


@router.post("/memories", response_model=MemoryResponse)
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


@router.patch("/memories/{memory_id}", response_model=MemoryResponse)
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


@router.post("/memories/dream", response_model=DreamJobStatus)
async def dream_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DreamJobStatus:
    return start_dream_job(db, user=current_user)


@router.get("/memories/dream/{job_id}", response_model=DreamJobStatus)
def get_dream_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DreamJobStatus:
    return get_dream_job(db, user=current_user, job_id=job_id)


@router.post("/memories/dream/apply", response_model=DreamApplyResult)
def apply_dream(
    accepted: AcceptedDreamProposal,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DreamApplyResult:
    try:
        return apply_dream_proposal(db, user=current_user, accepted=accepted)
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database is unavailable")


@router.delete("/memories/{memory_id}")
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
