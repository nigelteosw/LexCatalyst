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
