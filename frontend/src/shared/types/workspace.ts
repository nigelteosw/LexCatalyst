export type ToolStep = {
  id?: string
  tool: string
  args: Record<string, unknown>
  summary: string | null
  status: 'running' | 'done'
}

/** A numbered footnote source behind a LexChat answer; the answer cites it as [n]. */
export type MessageSource = {
  n: number
  kind: 'document' | 'kb_entry' | 'elitigation'
  id: string
  title: string
  locator: string | null
  matterId: string | null
  /** firm_wide | team | matter | private */
  scope: string | null
  /** The passage the answer relied on. */
  excerpt: string | null
  /** Public eLitigation judgment URL, absent for internal sources. */
  url?: string | null
}

export type Message = {
  id?: string
  role: 'assistant' | 'user'
  body: string
  meta?: string
  steps?: ToolStep[]
  sources?: MessageSource[]
}

export type ChatThread = {
  id: string
  title: string
  matterId: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentFolder = {
  id: string
  matterId: string | null
  name: string
  createdBy: string
  canManage: boolean
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
  folderId?: string | null
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

export type LlmTier = 'high' | 'mid'
// Per-prompt model choice: a tier (resolved server-side from the user's settings) or an explicit OpenRouter model id.
export type ModelChoice = { tier: LlmTier; model?: undefined } | { model: string; tier?: undefined }

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
export type KnowledgeBankEntryType = 'knowledge_bank' | 'style_guide' | 'action' | 'document'
export type PiiStatus = 'clean' | 'flagged' | 'pending_review' | 'redacted'

export type ActionStatus = 'pending' | 'in_progress' | 'review' | 'with_client' | 'done'
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
  /** canReview and the round is still open (annotation edits allowed). */
  canAnnotate: boolean
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
  // Catalogue fields, set on document entries once extraction has run.
  documentType?: string | null
  documentStatus?: string | null
  executionDate?: string | null
  catalogueFields?: Record<string, unknown> | null
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
  kbEntryTitle?: string | null
  actionTitle?: string | null
  // IDs of the open resource; the backend resolves titles and text with access checks.
  threadId?: string | null
  documentId?: string | null
  kbEntryId?: string | null
  actionId?: string | null
}

export type LlmFeature = {
  key: string
  label: string
  defaultTier: LlmTier
}

export type LlmSettings = {
  hasKey: boolean
  keyLast4: string | null
  keySource: 'user' | 'demo' | null
  customModels: { high: string | null; mid: string | null }
  models: { high: string; mid: string }
  featureTiers: Record<string, LlmTier>
  features: LlmFeature[]
}

export type LessonAnnotation = {
  id: string
  pageNo: number
  anchorQuote: string
  suggestedText: string | null
  note: string | null
}

export type BirdieLesson = {
  id: string
  title: string
  body: string
  sourceAnnotationIds: string[]
}

export type FeedbackRound = {
  handoffId: string
  documentName: string
  reviewerName: string | null
  status: string
  date: string
  annotations: LessonAnnotation[]
  lessons: BirdieLesson[]
}

export type DemoUser = {
  id: string
  fullName: string | null
  email: string
  firmRole: FirmRole
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
