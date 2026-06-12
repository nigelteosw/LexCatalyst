from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ChatModel = Literal["deepseek-v4-flash", "deepseek-v4-pro"]
DocumentStatus = Literal["uploaded", "processing", "ready", "failed"]
FirmRole = Literal["partner", "senior_associate", "associate"]
MatterStatus = Literal["active", "closed", "archived"]
KnowledgeBankScope = Literal["firm_wide", "team", "matter", "private"]
KnowledgeBankEntryType = Literal["knowledge_bank", "style_guide", "action"]
PiiStatus = Literal["clean", "flagged", "pending_review", "redacted"]
KbEntryStatus = Literal["processing", "ready", "failed"]
SurveyCategory = Literal["workload", "mental_health", "team_dynamics", "learning"]
ActionStatus = Literal["pending", "in_progress", "review", "done"]
ActionPriority = Literal["low", "medium", "high"]
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
    matter_id: str | None = None
    model: ChatModel | None = None


class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    model: str | None = None
    tool_steps: list | None = None
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
    matter_id: str | None = None
    team_id: str | None = None
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
    scope: str = "personal"
    matter_id: str | None = None
    team_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MemoryExtractionCandidate(BaseModel):
    category: Literal["semantic", "procedural", "episodic"]
    content: str
    confidence: float


class MemoryExtractionResult(BaseModel):
    memories: list[MemoryExtractionCandidate]


class TeamResponse(BaseModel):
    id: str
    name: str
    practice_area: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MatterCreate(BaseModel):
    team_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    case_number: str = Field(min_length=1, max_length=120)
    client_name: str | None = Field(default=None, max_length=255)


class MatterUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    case_number: str | None = Field(default=None, min_length=1, max_length=120)
    client_name: str | None = Field(default=None, max_length=255)
    status: MatterStatus | None = None


class MatterResponse(BaseModel):
    id: str
    team_id: str
    title: str
    case_number: str
    client_name: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    team: TeamResponse | None = None

    model_config = {"from_attributes": True}


class MatterMemberCreate(BaseModel):
    user_id: str
    role: FirmRole = "associate"


class MatterMemberResponse(BaseModel):
    id: str
    matter_id: str
    user_id: str
    role: str
    granted_by: str | None = None
    granted_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeBankEntryCreate(BaseModel):
    team_id: str | None = None
    matter_id: str | None = None
    scope: KnowledgeBankScope
    entry_type: KnowledgeBankEntryType
    title: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=80_000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    pii_status: PiiStatus = "clean"


class KnowledgeBankEntryUpdate(BaseModel):
    team_id: str | None = None
    matter_id: str | None = None
    scope: KnowledgeBankScope | None = None
    entry_type: KnowledgeBankEntryType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body_markdown: str | None = Field(default=None, min_length=1, max_length=80_000)
    tags: list[str] | None = Field(default=None, max_length=30)
    pii_status: PiiStatus | None = None


class KnowledgeBankEntryResponse(BaseModel):
    id: str
    team_id: str | None = None
    matter_id: str | None = None
    source_entry_id: str | None = None
    source_document_id: str | None = None
    scope: str
    entry_type: str
    title: str
    body_markdown: str
    tags: list[str]
    pii_status: str
    status: str = "ready"
    error_message: str | None = None
    created_by: str
    created_by_role: str
    version: int
    created_at: datetime
    updated_at: datetime
    team: TeamResponse | None = None
    matter: MatterResponse | None = None

    model_config = {"from_attributes": True}


class KnowledgeBankBackfillResponse(BaseModel):
    embedded_count: int
    normalized_scope_count: int
    remaining_count: int


class KnowledgeBankPromoteRequest(BaseModel):
    target_scope: Literal["team", "firm_wide"]


class RedactionApprovalRequest(BaseModel):
    redacted_content: str | None = Field(default=None, min_length=1, max_length=80_000)
    redacted_fields: dict[str, str] | None = None


class RedactionProposalResponse(BaseModel):
    entry: KnowledgeBankEntryResponse
    redacted_fields: dict[str, str]
    original_content: str
    redacted_content: str


class KnowledgeBankAccessLogResponse(BaseModel):
    id: str
    kb_entry_id: str | None = None
    user_id: str
    action: str
    context_matter_id: str | None = None
    context_thread_id: str | None = None
    ip_address: str | None = None
    timestamp: datetime

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    firm_role: str
    is_admin: bool
    default_team_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserSettingsUpdate(BaseModel):
    firm_role: FirmRole


class SurveyQuestionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    category: SurveyCategory
    order_index: int = 0


class SurveyQuestionUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    category: SurveyCategory | None = None
    order_index: int | None = None
    is_active: bool | None = None


class SurveyQuestionResponse(BaseModel):
    id: str
    text: str
    category: str
    order_index: int
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SurveyResponseCreate(BaseModel):
    question_id: str
    score: int = Field(ge=1, le=5)
    week_of: datetime


class SurveyWeekResult(BaseModel):
    week_of: datetime
    avg_score: float
    response_count: int


class SurveyQuestionResult(BaseModel):
    question_id: str
    question_text: str
    category: str
    weeks: list[SurveyWeekResult]


class SurveyResultsResponse(BaseModel):
    questions: list[SurveyQuestionResult]


class ActionItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assignee_id: str | None = None
    matter_id: str | None = None
    due_date: datetime | None = None
    priority: ActionPriority = "medium"


class ActionItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assignee_id: str | None = None
    status: ActionStatus | None = None
    priority: ActionPriority | None = None
    due_date: datetime | None = None


class ActionUserResponse(BaseModel):
    id: str
    full_name: str | None = None
    email: str

    model_config = {"from_attributes": True}


class ActionItemResponse(BaseModel):
    id: str
    title: str
    description: str | None = None
    assignee_id: str | None = None
    assigner_id: str
    matter_id: str | None = None
    due_date: datetime | None = None
    status: str
    priority: str
    created_at: datetime
    updated_at: datetime
    assignee: ActionUserResponse | None = None
    assigner: ActionUserResponse | None = None

    model_config = {"from_attributes": True}
