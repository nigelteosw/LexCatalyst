export type Message = {
  id?: string
  role: 'assistant' | 'user'
  body: string
  meta?: string
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
}

export type ChatModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'

export type MemoryCategory = 'semantic' | 'procedural' | 'episodic'

export type Memory = {
  id: string
  category: MemoryCategory
  content: string
  confidence: number
  createdAt: string
  updatedAt: string
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

export type KnowledgeBankScope = 'firm_wide' | 'team' | 'matter' | 'private'
export type KnowledgeBankEntryType =
  | 'precedent'
  | 'playbook'
  | 'matter_note'
  | 'partner_pref'
  | 'style_guide'
  | 'entity'
  | 'clause'
export type PiiStatus = 'clean' | 'flagged' | 'pending_review' | 'redacted'

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

export type KnowledgeBankAccessLog = {
  id: string
  entryId?: string | null
  userId: string
  action: 'read' | 'write' | 'share' | 'redact_applied' | string
  contextMatterId?: string | null
  contextThreadId?: string | null
  ipAddress?: string | null
  timestamp: string
}
