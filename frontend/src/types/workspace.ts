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

export type MemoryCategory = 'semantic' | 'procedural' | 'episodic'

export type Memory = {
  id: string
  category: MemoryCategory
  content: string
  confidence: number
  createdAt: string
  updatedAt: string
}
