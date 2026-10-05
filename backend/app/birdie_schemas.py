"""Shared Birdie workspace contracts. Client-supplied history cannot inject system roles."""
from typing import Literal
from pydantic import BaseModel, Field
from app.schemas import WebContext, PageContext, LlmTier


class ContextSelection(BaseModel):
    memories: bool = True
    lessons: bool = True
    workboard: bool = False
    knowledge_bank: bool = True
    cases: bool = True
    document_ids: list[str] = Field(default_factory=list, max_length=5)
    excluded_ids: list[str] = Field(default_factory=list, max_length=100)


class HistoryMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=20_000)


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    request_id: str = Field(min_length=1, max_length=80)
    mode: Literal['ask', 'draft', 'review'] = 'ask'
    instructions: str = Field(default='', max_length=4000)
    selection: ContextSelection = Field(default_factory=ContextSelection)
    web_context: WebContext | None = None
    page_context: PageContext | None = None
    tier: LlmTier | None = None
    model: str | None = Field(default=None, max_length=200)


class TemporaryRunRequest(RunRequest):
    matter_id: str | None = None
    history: list[HistoryMessage] = Field(default_factory=list, max_length=40)


class ConversationCreate(BaseModel):
    matter_id: str | None = None
    title: str = Field(default='New Birdie conversation', min_length=1, max_length=200)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None


class PreferenceUpdate(BaseModel):
    instructions: str = Field(default='', max_length=4000)
    disabled_memory_ids: list[str] = Field(default_factory=list, max_length=200)


class LessonUpdate(BaseModel):
    enabled: bool
    body: str = Field(min_length=1, max_length=4000)
