export type Message = {
  role: 'assistant' | 'user'
  body: string
  meta?: string
}

export type Memory = {
  title: string
  body: string
  status: 'Personal' | 'Matter' | 'Draft'
}

export type DocumentStatus = 'ready' | 'processing'

export type MatterDocument = {
  name: string
  status: DocumentStatus
  detail: string
}

export type WorkspaceContent = {
  brand: {
    initials: string
    name: string
    title: string
  }
  workspace: {
    label: string
    name: string
  }
  matterLabel: string
  actions: string[]
  newChatLabel: string
  threads: string[]
  suggestions: string[]
  documents: MatterDocument[]
  upload: {
    label: string
    initialState: string
    queuedState: string
    processingState: string
    readyState: string
  }
  chat: {
    inputLabel: string
    placeholder: string
    sendLabel: string
    assistantInitials: string
    userInitials: string
    followUpResponse: Message
    initialMessages: Message[]
  }
  memories: {
    label: string
    addLabel: string
    initialItems: Memory[]
    draftItem: Memory
  }
  insight: {
    label: string
    title: string
    body: string
  }
}
