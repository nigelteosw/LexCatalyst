export type ToolStep = {
  id?: string
  tool: string
  args: Record<string, unknown>
  summary: string | null
  status: 'running' | 'done'
}

export type Message = {
  id?: string
  role: 'assistant' | 'user'
  body: string
  meta?: string
  steps?: ToolStep[]
}

export type ChatThread = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type DocumentStatus = 'uploaded' | 'processing' | 'ready' | 'failed'

export type WorkspaceDocument = {
  id: string
  filename: string
  contentType: string
  status: DocumentStatus
  errorMessage?: string | null
  matterId?: string | null
  teamId?: string | null
  createdAt: string
  updatedAt: string
  chunkCount: number
  canManage: boolean
}

export type DocumentComment = {
  id: string
  documentId: string
  userId: string
  content: string
  createdAt: string
  updatedAt: string
  canDelete: boolean
  author: {
    id: string
    fullName?: string | null
    email: string
  }
}

export type ChatModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'

export type MemoryCategory = 'semantic' | 'procedural' | 'episodic'

export type Memory = {
  id: string
  category: MemoryCategory
  content: string
  justification?: string | null
  confidence: number
  createdAt: string
  updatedAt: string
}

export type DreamAddition = {
  category: MemoryCategory
  content: string
  reason: string
}

export type DreamMerge = {
  replaceIds: string[]
  category: MemoryCategory
  content: string
  reason: string
}

export type DreamUpdate = {
  memoryId: string
  content: string
  reason: string
}

export type DreamDrop = {
  memoryId: string
  reason: string
}

export type DreamProposal = {
  additions: DreamAddition[]
  merges: DreamMerge[]
  updates: DreamUpdate[]
  drops: DreamDrop[]
  reviewedMessageCount: number
}

export type DreamJobStatus = {
  jobId: string
  status: 'processing' | 'completed' | 'failed'
  proposal: DreamProposal | null
  memories: Memory[] | null
  errorMessage: string | null
}

export type WikiPageStatus = 'draft' | 'published' | 'archived'

export type WikiPageType =
  | 'source_summary'
  | 'issue'
  | 'timeline'
  | 'playbook'
  | 'memory_note'
  | 'entity'
  | 'clause'
  | 'authority'
  | 'question_answer'

export type WikiUser = {
  id: string
  fullName?: string | null
  email?: string | null
}

export type WikiPage = {
  id: string
  ownerUserId: string
  authorUserId: string
  latestEditorUserId?: string | null
  title: string
  slug: string
  bodyMarkdown: string
  excerpt?: string | null
  pageType: WikiPageType
  status: WikiPageStatus
  createdBy: 'user' | 'llm' | string
  sourceDocumentId?: string | null
  version: number
  publishedAt?: string | null
  createdAt: string
  updatedAt: string
  author?: WikiUser | null
  latestEditor?: WikiUser | null
}

export type WikiPageSource = {
  id: string
  pageId: string
  documentId?: string | null
  chunkId?: string | null
  memoryId?: string | null
  chatMessageId?: string | null
  citationLabel: string
  relevanceNote?: string | null
  snippet?: string | null
  createdAt: string
}

export type WikiGraphNode = {
  id: string
  label: string
  type: string
  status?: WikiPageStatus | string | null
}

export type WikiGraphEdge = {
  id: string
  source: string
  target: string
  label: string
  type: string
}

export type WikiGraph = {
  nodes: WikiGraphNode[]
  edges: WikiGraphEdge[]
}

export type Team = {
  id: string
  name: string
  practiceArea?: string | null
  createdAt: string
}

export type MatterStatus = 'active' | 'closed' | 'archived'

export type Matter = {
  id: string
  teamId: string
  title: string
  caseNumber: string
  clientName?: string | null
  status: MatterStatus
  createdAt: string
  updatedAt: string
  team?: Team | null
}

export type FirmRole = 'partner' | 'senior_associate' | 'associate' | 'admin'

export type CurrentUser = {
  id: string
  email: string
  fullName?: string | null
  firmRole: FirmRole
  isAdmin: boolean
  defaultTeamId?: string | null
  createdAt: string
}

export type SessionUser = Pick<
  CurrentUser,
  'id' | 'email' | 'fullName' | 'firmRole' | 'isAdmin'
>

export type KnowledgeBankScope = 'firm_wide' | 'team' | 'matter' | 'private'
export type KnowledgeBankEntryType = 'knowledge_bank' | 'style_guide' | 'action'
export type PiiStatus = 'clean' | 'flagged' | 'pending_review' | 'redacted'

export type SurveyCategory = 'workload' | 'mental_health' | 'team_dynamics' | 'learning'

export type SurveyQuestion = {
  id: string
  text: string
  category: SurveyCategory
  orderIndex: number
  isActive: boolean
  reverseScored: boolean
  createdAt: string
}

export type SurveyWeekResult = {
  weekOf: string
  avgScore: number
  responseCount: number
}

export type SurveyQuestionResult = {
  questionId: string
  questionText: string
  category: string
  weeks: SurveyWeekResult[]
}

export type SurveyResults = {
  currentWeekOf: string
  minimumCohortSize: number
  currentCohortSize: number | null
  questions: SurveyQuestionResult[]
}

export type ActionStatus = 'pending' | 'in_progress' | 'review' | 'done'
export type ActionPriority = 'low' | 'medium' | 'high'

export type ActionUser = {
  id: string
  fullName?: string | null
  email: string
}

export type ActionItem = {
  id: string
  title: string
  description?: string | null
  assigneeId?: string | null
  assignerId: string
  matterId?: string | null
  dueDate?: string | null
  status: ActionStatus
  priority: ActionPriority
  tags: string[]
  activeHandoffId?: string | null
  createdAt: string
  updatedAt: string
  assignee?: ActionUser | null
  assigner?: ActionUser | null
}

export type ReviewHandoffStatus =
  | 'ready_for_review'
  | 'in_review'
  | 'completed'
  | 'returned'

export type ReviewAnnotationKind = 'highlight' | 'strike' | 'suggestion'

export type ReviewAnnotationStatus = 'open' | 'needs_rework' | 'resolved' | 'rejected'

// Matches HighlightArea from @react-pdf-viewer/highlight (percentages 0–100)
export type ReviewAnnotationRect = {
  pageIndex: number
  left: number
  top: number
  width: number
  height: number
}

export type ReviewAnnotationReply = {
  id: string
  annotationId: string
  authorUserId?: string | null
  bodyMarkdown: string
  createdAt: string
  updatedAt: string
  author?: ActionUser | null
}

export type ReviewAnnotation = {
  id: string
  handoffId: string
  documentId: string
  pageNo: number
  kind: ReviewAnnotationKind
  anchorQuote: string
  anchorRects: ReviewAnnotationRect[]
  suggestedText?: string | null
  note?: string | null
  status: ReviewAnnotationStatus
  authorUserId?: string | null
  promotedKbEntryId?: string | null
  previousAnnotationId?: string | null
  createdAt: string
  updatedAt: string
  author?: ActionUser | null
  replies: ReviewAnnotationReply[]
}

export type ReviewHandoff = {
  id: string
  actionId?: string | null
  matterId?: string | null
  documentId: string
  documentFilename?: string | null
  // Server-computed viewer capabilities (see review_handoff_service.can_review_handoff).
  canReview: boolean
  canRemove: boolean
  submittedBy: string
  submittedAt: string
  status: ReviewHandoffStatus
  reviewerId?: string | null
  completedAt?: string | null
  returnReason?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  submitter?: ActionUser | null
  reviewer?: ActionUser | null
  annotations: ReviewAnnotation[]
}

export type FirmUser = {
  id: string
  fullName?: string | null
  email: string
  firmRole: FirmRole
  isAdmin: boolean
}

export type KbEntryStatus = 'processing' | 'ready' | 'failed'

export type KnowledgeBankEntry = {
  id: string
  teamId?: string | null
  matterId?: string | null
  sourceEntryId?: string | null
  sourceDocumentId?: string | null
  scope: KnowledgeBankScope
  entryType: KnowledgeBankEntryType
  title: string
  bodyMarkdown: string
  tags: string[]
  piiStatus: PiiStatus
  status: KbEntryStatus
  errorMessage?: string | null
  createdBy: string
  createdByRole: string
  version: number
  createdAt: string
  updatedAt: string
  team?: Team | null
  matter?: Matter | null
}

export type RedactionProposal = {
  entry: KnowledgeBankEntry
  redactedFields: Record<string, string>
  originalContent: string
  redactedContent: string
}

// The audit log is edits-only (DB CHECK constraint enforces this).
// Every row implicitly represents an edit, so there's no `action` field.
export type KnowledgeBankAccessLog = {
  id: string
  entryId?: string | null
  userId: string
  contextMatterId?: string | null
  contextThreadId?: string | null
  ipAddress?: string | null
  timestamp: string
}


export type BirdiePageContext = {
  view: string
  threadTitle?: string | null
  documentName?: string | null
  wikiPageTitle?: string | null
  kbEntryTitle?: string | null
  actionTitle?: string | null
}

export type ResourceMetadata = {
  id: string
  resourceType: string
  resourceId: string
  title: string | null
  ownerUserId: string | null
  createdBy: string | null
  teamId: string | null
  matterId: string | null
  scope: string | null
  sourceDocumentId: string | null
  status: string | null
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
