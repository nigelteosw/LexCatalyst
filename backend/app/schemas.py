from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ChatModel = Literal["deepseek-v4-flash", "deepseek-v4-pro"]
DocumentStatus = Literal["uploaded", "processing", "ready", "failed"]
WikiPageStatus = Literal["draft", "published", "archived"]
WikiPageType = Literal[
    "source_summary",
    "issue",
    "timeline",
    "playbook",
    "memory_note",
    "entity",
    "clause",
    "authority",
    "question_answer",
]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    thread_id: str | None = None
    model: ChatModel | None = None


class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    model: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatThreadResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    thread_id: str
    message: ChatMessageResponse
    model: str


class DocumentResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    status: DocumentStatus | str
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    chunk_count: int = 0

    model_config = {"from_attributes": True}


class WikiPageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=80_000)
    page_type: WikiPageType = "source_summary"
    status: WikiPageStatus = "draft"
    excerpt: str | None = Field(default=None, max_length=1000)


class WikiPageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body_markdown: str | None = Field(default=None, min_length=1, max_length=80_000)
    page_type: WikiPageType | None = None
    status: Literal["draft", "published"] | None = None
    excerpt: str | None = Field(default=None, max_length=1000)
    change_summary: str | None = Field(default=None, max_length=1000)


class WikiIngestRequest(BaseModel):
    page_types: list[WikiPageType] = Field(default_factory=lambda: ["source_summary"])
    model: ChatModel | None = None


class WikiUserResponse(BaseModel):
    id: str
    full_name: str | None = None
    email: str | None = None


class WikiPageResponse(BaseModel):
    id: str
    owner_user_id: str
    author_user_id: str
    latest_editor_user_id: str | None = None
    title: str
    slug: str
    body_markdown: str
    excerpt: str | None = None
    page_type: str
    status: str
    created_by: str
    source_document_id: str | None = None
    version: int
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    author: WikiUserResponse | None = None
    latest_editor: WikiUserResponse | None = None


class WikiPageSourceResponse(BaseModel):
    id: str
    page_id: str
    document_id: str | None = None
    chunk_id: str | None = None
    memory_id: str | None = None
    chat_message_id: str | None = None
    citation_label: str
    relevance_note: str | None = None
    snippet: str | None = None
    created_at: datetime


class WikiGraphNode(BaseModel):
    id: str
    label: str
    type: str
    status: str | None = None


class WikiGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    type: str


class WikiGraphResponse(BaseModel):
    nodes: list[WikiGraphNode]
    edges: list[WikiGraphEdge]


class MemoryCreate(BaseModel):
    category: Literal["semantic", "procedural", "episodic"]
    content: str = Field(min_length=1, max_length=5000)
    source_thread_id: str | None = None
    source_message_id: str | None = None


class MemoryUpdate(BaseModel):
    category: Literal["semantic", "procedural", "episodic"] | None = None
    content: str | None = Field(default=None, min_length=1, max_length=5000)


class MemoryResponse(BaseModel):
    id: str
    category: str
    content: str
    confidence: float
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MemoryExtractionCandidate(BaseModel):
    category: Literal["semantic", "procedural", "episodic"]
    content: str
    confidence: float


class MemoryExtractionResult(BaseModel):
    memories: list[MemoryExtractionCandidate]
