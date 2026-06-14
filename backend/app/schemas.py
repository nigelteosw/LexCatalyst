from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ChatModel = Literal["deepseek-v4-flash", "deepseek-v4-pro"]
DocumentStatus = Literal["uploaded", "processing", "ready", "failed"]
FirmRole = Literal["partner", "senior_associate", "associate", "admin"]
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


class ChatThreadUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=160)


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
    can_manage: bool = False

    model_config = {"from_attributes": True}


class DocumentUpdate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class DocumentCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=3000)


class DocumentCommentAuthorResponse(BaseModel):
    id: str
    full_name: str | None = None
    email: str

    model_config = {"from_attributes": True}


class DocumentCommentResponse(BaseModel):
    id: str
    document_id: str
    user_id: str
    content: str
    created_at: datetime
    updated_at: datetime
    author: DocumentCommentAuthorResponse
    can_delete: bool = False

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
    justification: str | None = None
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


class DreamAddition(BaseModel):
    category: Literal["semantic", "procedural", "episodic"]
    content: str = Field(min_length=1, max_length=5000)
    reason: str = Field(min_length=1, max_length=1000)


class DreamMerge(BaseModel):
    replace_ids: list[str] = Field(min_length=2)
    category: Literal["semantic", "procedural", "episodic"]
    content: str = Field(min_length=1, max_length=5000)
    reason: str = Field(min_length=1, max_length=1000)


class DreamUpdate(BaseModel):
    memory_id: str
    content: str = Field(min_length=1, max_length=5000)
    reason: str = Field(min_length=1, max_length=1000)


class DreamDrop(BaseModel):
    memory_id: str
    reason: str = Field(min_length=1, max_length=1000)


class DreamProposal(BaseModel):
    additions: list[DreamAddition] = Field(default_factory=list)
    merges: list[DreamMerge] = Field(default_factory=list)
    updates: list[DreamUpdate] = Field(default_factory=list)
    drops: list[DreamDrop] = Field(default_factory=list)
    reviewed_message_count: int = 0


class DreamJobStatus(BaseModel):
    job_id: str
    status: Literal["processing", "completed", "failed"]
    proposal: DreamProposal | None = None
    memories: list[MemoryResponse] | None = None
    error_message: str | None = None


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


class KnowledgeBankEntrySummaryResponse(BaseModel):
    id: str
    team_id: str | None = None
    matter_id: str | None = None
    source_entry_id: str | None = None
    source_document_id: str | None = None
    scope: str
    entry_type: str
    title: str
    body_preview: str
    tags: list[str]
    pii_status: str
    status: str = "ready"
    error_message: str | None = None
    created_by: str
    created_by_role: str
    version: int
    created_at: datetime
    updated_at: datetime


class KnowledgeBankEntryPageResponse(BaseModel):
    items: list[KnowledgeBankEntrySummaryResponse]
    limit: int
    offset: int
    next_offset: int | None = None


class KnowledgeBankEntryStatusResponse(BaseModel):
    id: str
    status: str
    error_message: str | None = None
    version: int
    updated_at: datetime


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
    """Audit log entry. Only edit events are recorded (CHECK-constrained
    at the DB level), so there's no `action` field — every row is an edit
    by definition."""
    id: str
    kb_entry_id: str | None = None
    user_id: str
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


class SurveyUserResult(BaseModel):
    user_id: str
    full_name: str | None = None
    email: str
    firm_role: str
    week_of: datetime
    average_score: float | None = None
    response_count: int
    question_count: int


class SurveyResultsResponse(BaseModel):
    current_week_of: datetime
    users: list[SurveyUserResult]
    questions: list[SurveyQuestionResult]


class ActionItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assignee_id: str | None = None
    matter_id: str | None = None
    due_date: datetime | None = None
    priority: ActionPriority = "medium"
    tags: list[str] = Field(default_factory=list, max_length=20)


class ActionItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assignee_id: str | None = None
    matter_id: str | None = None
    status: ActionStatus | None = None
    priority: ActionPriority | None = None
    due_date: datetime | None = None
    tags: list[str] | None = Field(default=None, max_length=20)


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
    tags: list[str] = Field(default_factory=list)
    active_handoff_id: str | None = None
    created_at: datetime
    updated_at: datetime
    assignee: ActionUserResponse | None = None
    assigner: ActionUserResponse | None = None

    model_config = {"from_attributes": True}


ReviewHandoffStatus = Literal[
    "extracting",
    "ready_for_review",
    "in_review",
    "completed",
    "returned",
    "extraction_failed",
]
ReviewFindingStatus = Literal[
    "pending",
    "approved",
    "edited",
    "rejected",
    "needs_rework",
]


class ReviewCitation(BaseModel):
    kind: Literal["kb_entry", "playbook", "doc", "external"] = "external"
    ref: str | None = None
    label: str


class ReviewFindingCreate(BaseModel):
    original_clause: str = Field(min_length=1, max_length=20_000)
    proposed_revision: str | None = Field(default=None, max_length=20_000)
    reasoning: str = Field(min_length=1, max_length=20_000)
    citations: list[ReviewCitation] = Field(default_factory=list)


class ReviewFindingUpdate(BaseModel):
    status: ReviewFindingStatus | None = None
    reviewer_edit: str | None = Field(default=None, max_length=20_000)
    reviewer_comment: str | None = Field(default=None, max_length=10_000)


class ReviewFindingResponse(BaseModel):
    id: str
    handoff_id: str
    sequence: int
    original_clause: str
    proposed_revision: str | None = None
    reasoning: str
    citations: list[dict] = Field(default_factory=list)
    status: str
    reviewer_edit: str | None = None
    reviewer_comment: str | None = None
    promoted_kb_entry_id: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReviewHandoffCreate(BaseModel):
    document_id: str
    action_id: str | None = None
    matter_id: str | None = None
    reviewer_id: str | None = None


class ReviewHandoffUpdate(BaseModel):
    status: ReviewHandoffStatus | None = None
    reviewer_id: str | None = None


class ReviewHandoffResponse(BaseModel):
    id: str
    action_id: str | None = None
    matter_id: str | None = None
    document_id: str
    submitted_by: str
    submitted_at: datetime
    status: str
    reviewer_id: str | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    submitter: ActionUserResponse | None = None
    reviewer: ActionUserResponse | None = None
    findings: list[ReviewFindingResponse] = Field(default_factory=list)
    document_filename: str | None = None

    model_config = {"from_attributes": True}


class ReviewHandoffPromoteRequest(BaseModel):
    target_scope: KnowledgeBankScope = "matter"
    entry_type: KnowledgeBankEntryType = "knowledge_bank"
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=30)


class ReviewWaitingCountResponse(BaseModel):
    count: int


class FirmUserResponse(BaseModel):
    """Minimal user info for assignee pickers across the firm."""
    id: str
    full_name: str | None = None
    email: str
    firm_role: str
    is_admin: bool

    model_config = {"from_attributes": True}
