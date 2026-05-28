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
