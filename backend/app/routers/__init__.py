"""HTTP routers, grouped by domain.

Each module exposes a single `router: APIRouter` that the FastAPI app
mounts. Add new domains as new modules and register them in
`all_routers` so `main.py` stays declarative.
"""

from fastapi import APIRouter

from app.routers import (
    actions,
    auth,
    birdie,
    chat,
    documents,
    knowledge_bank,
    memories,
    organizations,
    review_handoffs,
    resource_metadata,
    surveys,
    system,
    wiki,
)

all_routers: list[APIRouter] = [
    system.router,
    auth.router,
    documents.router,
    wiki.router,
    chat.router,
    birdie.router,
    memories.router,
    organizations.router,
    knowledge_bank.router,
    surveys.router,
    actions.router,
    review_handoffs.router,
    resource_metadata.router,
]
