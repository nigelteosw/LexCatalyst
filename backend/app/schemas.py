from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LlmTier = Literal["high", "mid"]
DocumentStatus = Literal["uploaded", "processing", "ready", "failed"]
FirmRole = Literal["partner", "senior_associate", "associate", "admin"]
MatterStatus = Literal["active", "closed", "archived"]
KnowledgeBankScope = Literal["firm_wide", "team", "matter", "private"]
ResourceMetadataType = Literal[
    "document",
    "knowledge_bank_entry",
    "wiki_page",
    "action_item",
    "review_handoff",
]
KnowledgeBankEntryType = Literal["knowledge_bank", "style_guide", "action"]
PiiStatus = Literal["clean", "flagged", "pending_review", "redacted"]
KbEntryStatus = Literal["processing", "ready", "failed"]
SurveyCategory = Literal["workload", "mental_health", "team_dynamics", "learning"]
ActionStatus = Literal["pending", "in_progress", "review", "with_client", "done"]
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
    tier: LlmTier | None = None
    model: str | None = Field(default=None, max_length=200)


class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    model: str | None = None
    tool_steps: list | None = None
    sources: list | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatThreadResponse(BaseModel):
    id: str
    title: str
    matter_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    thread_id: str
    message: ChatMessageResponse
    model: str


class ChatThreadUpdate(BaseModel):
    """Omitted fields are unchanged. matter_id=null moves the thread to General."""

    title: str | None = Field(default=None, min_length=1, max_length=160)
    matter_id: str | None = None


class DocumentResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    status: DocumentStatus | str
    error_message: str | None = None
    matter_id: str | None = None
    folder_id: str | None = None
    team_id: str | None = None
    created_at: datetime
    updated_at: datetime
    chunk_count: int = 0
    can_manage: bool = False

    model_config = {"from_attributes": True}


class DocumentFolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    matter_id: str | None = None


class DocumentFolderUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DocumentFolderResponse(BaseModel):
    id: str
    matter_id: str | None = None
    name: str
    created_by: str
    can_manage: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentUpdate(BaseModel):
    """Omitted fields are unchanged. matter_id=null moves the document to General."""

    filename: str | None = Field(default=None, min_length=1, max_length=255)
    matter_id: str | None = None
    folder_id: str | None = None


class ResourceMetadataResponse(BaseModel):
    id: str
    resource_type: str
    resource_id: str
    title: str | None = None
    owner_user_id: str | None = None
    created_by: str | None = None
    team_id: str | None = None
    matter_id: str | None = None
    scope: str | None = None
    source_document_id: str | None = None
    status: str | None = None
    metadata_json: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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


class PageContext(BaseModel):
    view: str | None = None
    thread_title: str | None = None
    document_name: str | None = None
    wiki_page_title: str | None = None
    kb_entry_title: str | None = None
    action_title: str | None = None


class WebContext(BaseModel):
    """Text from an external webpage the user explicitly shared via the Chrome extension."""

    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=500)
    text: str = Field(min_length=1, max_length=120_000)  # keep in sync with extension MAX_WEB_CONTEXT_CHARS
    source: Literal["selection", "page"]
    truncated: bool = False


class WikiPageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=80_000)
    page_type: WikiPageType = "source_summary"
    status: WikiPageStatus = "draft"
    excerpt: str | None = Field(default=None, max_length=1000)
    matter_id: str | None = None


class WikiPageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body_markdown: str | None = Field(default=None, min_length=1, max_length=80_000)
    page_type: WikiPageType | None = None
    status: Literal["draft", "published"] | None = None
    excerpt: str | None = Field(default=None, max_length=1000)
    change_summary: str | None = Field(default=None, max_length=1000)


class WikiIngestRequest(BaseModel):
    page_types: list[WikiPageType] = Field(default_factory=lambda: ["source_summary"])
    tier: LlmTier | None = None
    model: str | None = Field(default=None, max_length=200)


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


class KnowledgeBankEntryUpdate(BaseModel):
    team_id: str | None = None
    matter_id: str | None = None
    scope: KnowledgeBankScope | None = None
    entry_type: KnowledgeBankEntryType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body_markdown: str | None = Field(default=None, min_length=1, max_length=80_000)
    tags: list[str] | None = Field(default=None, max_length=30)


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
    reverse_scored: bool = False


class SurveyQuestionUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    category: SurveyCategory | None = None
    order_index: int | None = None
    is_active: bool | None = None
    reverse_scored: bool | None = None


class SurveyQuestionResponse(BaseModel):
    id: str
    text: str
    category: str
    order_index: int
    is_active: bool
    reverse_scored: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SurveyResponseCreate(BaseModel):
    question_id: str
    score: int = Field(ge=1, le=5)
    week_of: datetime


class SurveyResponseItem(BaseModel):
    question_id: str
    score: int = Field(ge=1, le=5)


class SurveyResponseBatchCreate(BaseModel):
    responses: list[SurveyResponseItem] = Field(min_length=1, max_length=100)


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
    current_week_of: datetime
    minimum_cohort_size: int
    current_cohort_size: int | None
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
    "ready_for_review",
    "in_review",
    "completed",
    "returned",
]
ReviewAnnotationKind = Literal["highlight", "strike", "suggestion"]
ReviewAnnotationStatus = Literal["open", "needs_rework", "resolved", "rejected"]


class AnchorRect(BaseModel):
    """One rectangle of a text selection, as @react-pdf-viewer's HighlightArea.

    Values are percentages of the rendered page; ``pageIndex`` is 0-based.
    Stored as-is (camelCase) so the viewer and the exporter share one format.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    page_index: int = Field(alias="pageIndex", ge=0)
    left: float = Field(ge=0, le=100, allow_inf_nan=False)
    top: float = Field(ge=0, le=100, allow_inf_nan=False)
    width: float = Field(gt=0, le=100, allow_inf_nan=False)
    height: float = Field(gt=0, le=100, allow_inf_nan=False)

    @model_validator(mode="after")
    def _within_page(self) -> "AnchorRect":
        if self.left + self.width > 100.0001 or self.top + self.height > 100.0001:
            raise ValueError("Rectangle extends beyond the page")
        return self


def _rects_as_stored(rects: list[AnchorRect]) -> list[dict]:
    return [r.model_dump(by_alias=True) for r in rects]


class ReviewAnnotationCreate(BaseModel):
    document_id: str
    page_no: int = Field(ge=1)
    kind: ReviewAnnotationKind
    anchor_quote: str = Field(min_length=1, max_length=20_000)
    anchor_rects: list[AnchorRect] = Field(min_length=1)
    suggested_text: str | None = Field(default=None, max_length=20_000)
    note: str | None = Field(default=None, max_length=10_000)

    def stored_rects(self) -> list[dict]:
        return _rects_as_stored(self.anchor_rects)


class ReviewAnnotationUpdate(BaseModel):
    status: ReviewAnnotationStatus | None = None
    suggested_text: str | None = Field(default=None, max_length=20_000)
    note: str | None = Field(default=None, max_length=10_000)
    # Explicit re-anchoring of a carried-forward annotation onto the revised PDF.
    page_no: int | None = Field(default=None, ge=1)
    anchor_rects: list[AnchorRect] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _no_explicit_nulls(self) -> "ReviewAnnotationUpdate":
        # These columns are NOT NULL; an explicit null must be a 422, not a 500.
        for field in ("status", "page_no", "anchor_rects"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self

    def changes(self) -> dict:
        payload = self.model_dump(exclude_unset=True)
        if self.anchor_rects is not None:
            payload["anchor_rects"] = _rects_as_stored(self.anchor_rects)
        return payload


class ReviewAnnotationReplyCreate(BaseModel):
    body_markdown: str = Field(min_length=1, max_length=10_000)


class ReviewAnnotationReplyResponse(BaseModel):
    id: str
    annotation_id: str
    author_user_id: str | None = None
    body_markdown: str
    created_at: datetime
    updated_at: datetime
    author: ActionUserResponse | None = None

    model_config = {"from_attributes": True}


class ReviewAnnotationResponse(BaseModel):
    id: str
    handoff_id: str
    document_id: str
    page_no: int
    kind: str
    anchor_quote: str
    anchor_rects: list[dict] = Field(default_factory=list)
    suggested_text: str | None = None
    note: str | None = None
    status: str
    author_user_id: str | None = None
    promoted_kb_entry_id: str | None = None
    previous_annotation_id: str | None = None
    created_at: datetime
    updated_at: datetime
    author: ActionUserResponse | None = None
    replies: list[ReviewAnnotationReplyResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ReviewAnnotationPromoteRequest(BaseModel):
    target_scope: KnowledgeBankScope = "matter"
    entry_type: KnowledgeBankEntryType = "knowledge_bank"
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list)


class ReviewHandoffCreate(BaseModel):
    document_id: str
    action_id: str | None = None
    matter_id: str | None = None
    reviewer_id: str | None = None


class ReviewHandoffUpdate(BaseModel):
    status: ReviewHandoffStatus | None = None
    reviewer_id: str | None = None


class ReviewHandoffRejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=5_000)


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
    return_reason: str | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    submitter: ActionUserResponse | None = None
    reviewer: ActionUserResponse | None = None
    annotations: list[ReviewAnnotationResponse] = Field(default_factory=list)
    document_filename: str | None = None
    # Viewer capabilities, computed server-side so the UI never guesses at policy.
    can_review: bool = False
    can_annotate: bool = False  # can_review and the round is still active
    can_remove: bool = False

    model_config = {"from_attributes": True}


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


class LlmSettingsUpdate(BaseModel):
    openrouter_api_key: str | None = Field(default=None, min_length=10, max_length=500)
    model_high: str | None = Field(default=None, max_length=200)
    model_mid: str | None = Field(default=None, max_length=200)
    feature_tiers: dict[str, str] | None = None


class LlmFeatureResponse(BaseModel):
    key: str
    label: str
    default_tier: LlmTier


class LlmSettingsResponse(BaseModel):
    has_key: bool
    key_last4: str | None = None
    key_source: Literal["user", "demo"] | None = None
    custom_models: dict[str, str | None]
    models: dict[str, str]
    feature_tiers: dict[str, str]
    features: list[LlmFeatureResponse]


class LessonAnnotationResponse(BaseModel):
    id: str
    page_no: int
    anchor_quote: str
    suggested_text: str | None = None
    note: str | None = None


class LessonResponse(BaseModel):
    id: str
    title: str
    body: str
    source_annotation_ids: list[str]


class FeedbackRoundResponse(BaseModel):
    handoff_id: str
    document_name: str
    reviewer_name: str | None = None
    status: str
    date: datetime
    annotations: list[LessonAnnotationResponse]
    lessons: list[LessonResponse]


class OpenRouterModelResponse(BaseModel):
    id: str
    name: str
    context_length: int | None = None
    prompt_price_per_million: float | None = None


class PrecedentSearchRequest(BaseModel):
    text: str = Field(min_length=3, max_length=5000)
    url: str | None = Field(default=None, max_length=2048)


class PrecedentTermResponse(BaseModel):
    kind: str
    value: str
    label: str


class PrecedentTermCount(BaseModel):
    label: str
    count: int


class PrecedentResultResponse(BaseModel):
    id: str
    source_type: Literal["document", "knowledge_bank"]
    excerpt: str
    document_title: str
    matter_ref: str | None = None
    date: str | None = None
    author: str | None = None
    status: str | None = None
    document_id: str | None = None
    term: PrecedentTermResponse | None = None


class PrecedentSearchResponse(BaseModel):
    clause_type: str
    terms_summary: list[PrecedentTermCount]
    results: list[PrecedentResultResponse]


class BirdieReviewCreate(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=500)
    text: str = Field(min_length=1, max_length=60_000)
    matter_id: str | None = None
    tier: LlmTier | None = None
    model: str | None = Field(default=None, max_length=200)


class BirdieSuggestionReplyResponse(BaseModel):
    id: str
    author_user_id: str | None = None
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}


class BirdieSuggestionResponse(BaseModel):
    id: str
    clause_ref: str | None = None
    anchor_text: str
    anchor_start: int
    anchor_end: int
    type: Literal["replace", "insert", "comment"]
    suggested_text: str | None = None
    reason: str
    category: Literal["style", "substance", "question"]
    source: dict | None = None
    status: Literal["pending", "accepted", "rejected"]
    decided_at: datetime | None = None
    replies: list[BirdieSuggestionReplyResponse] = []

    model_config = {"from_attributes": True}


class BirdieReviewResponse(BaseModel):
    id: str
    source_url: str
    title: str | None = None
    status: Literal["processing", "ready", "failed"]
    error: str | None = None
    model: str | None = None
    stats: dict = {}
    source_text: str
    current_text: str
    created_at: datetime
    suggestions: list[BirdieSuggestionResponse] = []


class BirdieSuggestionDecision(BaseModel):
    status: Literal["pending", "accepted", "rejected"]


class BirdieSuggestionReplyCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
