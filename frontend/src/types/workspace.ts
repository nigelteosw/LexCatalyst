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
