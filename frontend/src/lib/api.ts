import type {
  ChatModel,
  ChatThread,
  KnowledgeBankAccessLog,
  KnowledgeBankEntry,
  KnowledgeBankEntryType,
  KnowledgeBankScope,
  Matter,
  Memory,
  MemoryCategory,
  Message,
  RedactionProposal,
  Team,
  WikiGraph,
  WikiPage,
  WikiPageSource,
  WikiPageType,
  WorkspaceDocument,
} from '../types/workspace'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type BackendThread = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

type BackendMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
  model: string | null
  created_at: string
}

type BackendChatResponse = {
  thread_id: string
  message: BackendMessage
  model: string
}

type BackendDocument = {
  id: string
  filename: string
  content_type: string
  status: WorkspaceDocument['status']
  error_message: string | null
  matter_id: string | null
  team_id: string | null
  created_at: string
  updated_at: string
  chunk_count: number
}

type BackendWikiUser = {
  id: string
  full_name: string | null
  email: string | null
}

type BackendWikiPage = {
  id: string
  owner_user_id: string
  author_user_id: string
  latest_editor_user_id: string | null
  title: string
  slug: string
  body_markdown: string
  excerpt: string | null
  page_type: WikiPage['pageType']
  status: WikiPage['status']
  created_by: string
  source_document_id: string | null
  version: number
  published_at: string | null
  created_at: string
  updated_at: string
  author: BackendWikiUser | null
  latest_editor: BackendWikiUser | null
}

type BackendWikiPageSource = {
  id: string
  page_id: string
  document_id: string | null
  chunk_id: string | null
  memory_id: string | null
  chat_message_id: string | null
  citation_label: string
  relevance_note: string | null
  snippet: string | null
  created_at: string
}

type StreamThreadPayload = {
  thread_id: string
  title: string
}

type StreamTokenPayload = {
  content: string
}

type StreamDonePayload = BackendChatResponse

type StreamErrorPayload = {
  detail: string
}

type StreamChatOptions = {
  message: string
  model: ChatModel
  threadId: string | null
  matterId?: string | null
  signal?: AbortSignal
  onThread: (threadId: string, title: string) => void
  onToolCall: (tool: string, args: Record<string, unknown>) => void
  onToolResult: (tool: string, summary: string) => void
  onToken: (content: string) => void
  onDone: (payload: { threadId: string; message: Message; model: string }) => void
}

type BackendTeam = {
  id: string
  name: string
  practice_area: string | null
  created_at: string
}

type BackendMatter = {
  id: string
  team_id: string
  title: string
  case_number: string
  client_name: string | null
  status: Matter['status']
  created_at: string
  updated_at: string
  team: BackendTeam | null
}

type BackendKnowledgeBankEntry = {
  id: string
  team_id: string | null
  matter_id: string | null
  source_entry_id: string | null
  source_document_id: string | null
  scope: KnowledgeBankEntry['scope']
  entry_type: KnowledgeBankEntry['entryType']
  title: string
  body_markdown: string
  tags: string[]
  pii_status: KnowledgeBankEntry['piiStatus']
  created_by: string
  created_by_role: string
  version: number
  created_at: string
  updated_at: string
  team: BackendTeam | null
  matter: BackendMatter | null
}

type BackendRedactionProposal = {
  entry: BackendKnowledgeBankEntry
  redacted_fields: Record<string, string>
  original_content: string
  redacted_content: string
}

type BackendKnowledgeBankAccessLog = {
  id: string
  kb_entry_id: string | null
  user_id: string
  action: string
  context_matter_id: string | null
  context_thread_id: string | null
  ip_address: string | null
  timestamp: string
}

type BackendMemory = {
  id: string
  category: MemoryCategory
  content: string
  confidence: number
  created_at: string
  updated_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token')
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(detail)
  }

  return response.json() as Promise<T>
}

function mapThread(thread: BackendThread): ChatThread {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  }
}

function mapMessage(message: BackendMessage): Message {
  return {
    id: message.id,
    role: message.role,
    body: message.content,
    meta: message.model ? `Model: ${message.model}` : undefined,
  }
}

function mapDocument(document: BackendDocument): WorkspaceDocument {
  return {
    id: document.id,
    filename: document.filename,
    contentType: document.content_type,
    status: document.status,
    errorMessage: document.error_message,
    matterId: document.matter_id,
    teamId: document.team_id,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    chunkCount: document.chunk_count,
  }
}

function mapTeam(team: BackendTeam): Team {
  return {
    id: team.id,
    name: team.name,
    practiceArea: team.practice_area,
    createdAt: team.created_at,
  }
}

function mapMatter(matter: BackendMatter): Matter {
  return {
    id: matter.id,
    teamId: matter.team_id,
    title: matter.title,
    caseNumber: matter.case_number,
    clientName: matter.client_name,
    status: matter.status,
    createdAt: matter.created_at,
    updatedAt: matter.updated_at,
    team: matter.team ? mapTeam(matter.team) : null,
  }
}

function mapKnowledgeBankEntry(entry: BackendKnowledgeBankEntry): KnowledgeBankEntry {
  return {
    id: entry.id,
    teamId: entry.team_id,
    matterId: entry.matter_id,
    sourceEntryId: entry.source_entry_id,
    sourceDocumentId: entry.source_document_id,
    scope: entry.scope,
    entryType: entry.entry_type,
    title: entry.title,
    bodyMarkdown: entry.body_markdown,
    tags: entry.tags,
    piiStatus: entry.pii_status,
    createdBy: entry.created_by,
    createdByRole: entry.created_by_role,
    version: entry.version,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    team: entry.team ? mapTeam(entry.team) : null,
    matter: entry.matter ? mapMatter(entry.matter) : null,
  }
}

function mapRedactionProposal(proposal: BackendRedactionProposal): RedactionProposal {
  return {
    entry: mapKnowledgeBankEntry(proposal.entry),
    redactedFields: proposal.redacted_fields,
    originalContent: proposal.original_content,
    redactedContent: proposal.redacted_content,
  }
}

function mapMemory(memory: BackendMemory): Memory {
  return {
    id: memory.id,
    category: memory.category,
    content: memory.content,
    confidence: memory.confidence,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
  }
}

function mapWikiUser(user: BackendWikiUser | null) {
  if (!user) return null
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
  }
}

function mapWikiPage(page: BackendWikiPage): WikiPage {
  return {
    id: page.id,
    ownerUserId: page.owner_user_id,
    authorUserId: page.author_user_id,
    latestEditorUserId: page.latest_editor_user_id,
    title: page.title,
    slug: page.slug,
    bodyMarkdown: page.body_markdown,
    excerpt: page.excerpt,
    pageType: page.page_type,
    status: page.status,
    createdBy: page.created_by,
    sourceDocumentId: page.source_document_id,
    version: page.version,
    publishedAt: page.published_at,
    createdAt: page.created_at,
    updatedAt: page.updated_at,
    author: mapWikiUser(page.author),
    latestEditor: mapWikiUser(page.latest_editor),
  }
}

function mapWikiPageSource(source: BackendWikiPageSource): WikiPageSource {
  return {
    id: source.id,
    pageId: source.page_id,
    documentId: source.document_id,
    chunkId: source.chunk_id,
    memoryId: source.memory_id,
    chatMessageId: source.chat_message_id,
    citationLabel: source.citation_label,
    relevanceNote: source.relevance_note,
    snippet: source.snippet,
    createdAt: source.created_at,
  }
}

export async function listChatThreads(): Promise<ChatThread[]> {
  const threads = await request<BackendThread[]>('/chat/threads')
  return threads.map(mapThread)
}

export async function listThreadMessages(threadId: string): Promise<Message[]> {
  const messages = await request<BackendMessage[]>(`/chat/threads/${threadId}/messages`)
  return messages.map(mapMessage)
}

export async function listDocuments(): Promise<WorkspaceDocument[]> {
  const documents = await request<BackendDocument[]>('/documents')
  return documents.map(mapDocument)
}

export async function uploadDocument(
  file: File,
  matterId?: string | null,
): Promise<WorkspaceDocument> {
  const token = localStorage.getItem('token')
  const body = new FormData()
  body.append('file', file)

  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const matterQuery = matterId ? `?matter_id=${encodeURIComponent(matterId)}` : ''
  const response = await fetch(`${API_BASE_URL}/documents/upload${matterQuery}`, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(detail)
  }

  return mapDocument(await response.json() as BackendDocument)
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/documents/${id}`, {
    method: 'DELETE',
  })
}

export async function listWikiPages(params?: {
  status?: WikiPage['status']
  pageType?: WikiPageType
}): Promise<WikiPage[]> {
  const search = new URLSearchParams()
  if (params?.status) search.set('status', params.status)
  if (params?.pageType) search.set('page_type', params.pageType)
  const suffix = search.toString() ? `?${search}` : ''
  const pages = await request<BackendWikiPage[]>(`/wiki/pages${suffix}`)
  return pages.map(mapWikiPage)
}

export async function getWikiPage(id: string): Promise<WikiPage> {
  return mapWikiPage(await request<BackendWikiPage>(`/wiki/pages/${id}`))
}

export async function createWikiPage(payload: {
  title: string
  bodyMarkdown: string
  pageType: WikiPageType
  status?: WikiPage['status']
}): Promise<WikiPage> {
  return mapWikiPage(await request<BackendWikiPage>('/wiki/pages', {
    method: 'POST',
    body: JSON.stringify({
      title: payload.title,
      body_markdown: payload.bodyMarkdown,
      page_type: payload.pageType,
      status: payload.status ?? 'draft',
    }),
  }))
}

export async function updateWikiPage(
  id: string,
  payload: {
    title?: string
    bodyMarkdown?: string
    pageType?: WikiPageType
    status?: WikiPage['status']
    changeSummary?: string
  },
): Promise<WikiPage> {
  return mapWikiPage(await request<BackendWikiPage>(`/wiki/pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: payload.title,
      body_markdown: payload.bodyMarkdown,
      page_type: payload.pageType,
      status: payload.status,
      change_summary: payload.changeSummary,
    }),
  }))
}

export async function deleteWikiPage(id: string): Promise<void> {
  await request(`/wiki/pages/${id}`, { method: 'DELETE' })
}

export async function publishWikiPage(id: string): Promise<WikiPage> {
  return mapWikiPage(await request<BackendWikiPage>(`/wiki/pages/${id}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  }))
}

export async function ingestDocumentToWiki(
  documentId: string,
  model: ChatModel,
): Promise<WikiPage> {
  return mapWikiPage(await request<BackendWikiPage>(`/wiki/ingest/document/${documentId}`, {
    method: 'POST',
    body: JSON.stringify({
      page_types: ['source_summary'],
      model,
    }),
  }))
}

export async function listWikiPageSources(pageId: string): Promise<WikiPageSource[]> {
  const sources = await request<BackendWikiPageSource[]>(`/wiki/pages/${pageId}/sources`)
  return sources.map(mapWikiPageSource)
}

export async function getWikiGraph(): Promise<WikiGraph> {
  return request<WikiGraph>('/wiki/graph')
}

export async function getKbGraph(): Promise<WikiGraph> {
  return request<WikiGraph>('/kb/graph')
}

export async function sendChatMessage(message: string, threadId: string | null, model: ChatModel) {
  const response = await request<BackendChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      thread_id: threadId,
      model,
    }),
  })

  return {
    threadId: response.thread_id,
    message: mapMessage(response.message),
    model: response.model,
  }
}

export async function streamChatMessage({
  message,
  model,
  signal,
  threadId,
  matterId,
  onThread,
  onToolCall,
  onToolResult,
  onToken,
  onDone,
}: StreamChatOptions) {
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      thread_id: threadId,
      matter_id: matterId,
      model,
    }),
    signal,
  })

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(detail)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const rawEvent of events) {
      handleStreamEvent(rawEvent, { onThread, onToolCall, onToolResult, onToken, onDone })
    }
  }

  if (buffer.trim()) {
    handleStreamEvent(buffer, { onThread, onToolCall, onToolResult, onToken, onDone })
  }
}

export async function listTeams(): Promise<Team[]> {
  const teams = await request<BackendTeam[]>('/teams')
  return teams.map(mapTeam)
}

export async function listMatters(status?: Matter['status']): Promise<Matter[]> {
  const query = status ? `?matter_status=${status}` : ''
  const matters = await request<BackendMatter[]>(`/matters${query}`)
  return matters.map(mapMatter)
}

export async function createMatter(payload: {
  title: string
  caseNumber: string
  clientName?: string
  teamId?: string
}): Promise<Matter> {
  const matter = await request<BackendMatter>('/matters', {
    method: 'POST',
    body: JSON.stringify({
      title: payload.title,
      case_number: payload.caseNumber,
      client_name: payload.clientName,
      team_id: payload.teamId,
    }),
  })
  return mapMatter(matter)
}

export async function listKnowledgeBankEntries(params?: {
  scope?: KnowledgeBankScope
  entryType?: KnowledgeBankEntryType
  matterId?: string
  teamId?: string
  piiStatus?: KnowledgeBankEntry['piiStatus']
  query?: string
}): Promise<KnowledgeBankEntry[]> {
  const search = new URLSearchParams()
  if (params?.scope) search.set('scope', params.scope)
  if (params?.entryType) search.set('entry_type', params.entryType)
  if (params?.matterId) search.set('matter_id', params.matterId)
  if (params?.teamId) search.set('team_id', params.teamId)
  if (params?.piiStatus) search.set('pii_status', params.piiStatus)
  if (params?.query) search.set('query', params.query)
  const suffix = search.toString() ? `?${search}` : ''
  const entries = await request<BackendKnowledgeBankEntry[]>(`/kb/entries${suffix}`)
  return entries.map(mapKnowledgeBankEntry)
}

export async function getKnowledgeBankEntry(id: string): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/entries/${id}`),
  )
}

export async function createKnowledgeBankEntry(payload: {
  title: string
  bodyMarkdown: string
  scope: KnowledgeBankScope
  entryType: KnowledgeBankEntryType
  tags: string[]
  matterId?: string | null
  teamId?: string | null
}): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>('/kb/entries', {
      method: 'POST',
      body: JSON.stringify({
        title: payload.title,
        body_markdown: payload.bodyMarkdown,
        scope: payload.scope,
        entry_type: payload.entryType,
        tags: payload.tags,
        matter_id: payload.matterId,
        team_id: payload.teamId,
      }),
    }),
  )
}

export async function ingestDocumentToKnowledgeBank(
  documentId: string,
  model: ChatModel,
): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/ingest/document/${documentId}`, {
      method: 'POST',
      body: JSON.stringify({
        page_types: ['source_summary'],
        model,
      }),
    }),
  )
}

export async function listKnowledgeBankEntrySources(
  entryId: string,
): Promise<WikiPageSource[]> {
  const sources = await request<BackendWikiPageSource[]>(
    `/kb/entries/${entryId}/sources`,
  )
  return sources.map(mapWikiPageSource)
}

export async function updateKnowledgeBankEntry(
  id: string,
  payload: Partial<{
    title: string
    bodyMarkdown: string
    scope: KnowledgeBankScope
    entryType: KnowledgeBankEntryType
    tags: string[]
    matterId: string | null
    teamId: string | null
  }>,
): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: payload.title,
        body_markdown: payload.bodyMarkdown,
        scope: payload.scope,
        entry_type: payload.entryType,
        tags: payload.tags,
        matter_id: payload.matterId,
        team_id: payload.teamId,
      }),
    }),
  )
}

export async function deleteKnowledgeBankEntry(id: string): Promise<void> {
  await request(`/kb/entries/${id}`, { method: 'DELETE' })
}

export async function promoteKnowledgeBankEntry(
  id: string,
  targetScope: 'team' | 'firm_wide',
): Promise<RedactionProposal> {
  return mapRedactionProposal(
    await request<BackendRedactionProposal>(`/kb/entries/${id}/promote`, {
      method: 'POST',
      body: JSON.stringify({ target_scope: targetScope }),
    }),
  )
}

export async function getRedactionProposal(id: string): Promise<RedactionProposal> {
  return mapRedactionProposal(
    await request<BackendRedactionProposal>(`/kb/entries/${id}/redaction`),
  )
}

export async function approveKnowledgeBankRedaction(
  id: string,
  payload: {
    redactedContent: string
    redactedFields?: Record<string, string>
  },
): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/entries/${id}/approve-redaction`, {
      method: 'POST',
      body: JSON.stringify({
        redacted_content: payload.redactedContent,
        redacted_fields: payload.redactedFields,
      }),
    }),
  )
}

export async function listKnowledgeBankAuditLog(): Promise<KnowledgeBankAccessLog[]> {
  const rows = await request<BackendKnowledgeBankAccessLog[]>('/audit-log')
  return rows.map((row) => ({
    id: row.id,
    entryId: row.kb_entry_id,
    userId: row.user_id,
    action: row.action,
    contextMatterId: row.context_matter_id,
    contextThreadId: row.context_thread_id,
    ipAddress: row.ip_address,
    timestamp: row.timestamp,
  }))
}

function handleStreamEvent(
  rawEvent: string,
  callbacks: Pick<StreamChatOptions, 'onThread' | 'onToolCall' | 'onToolResult' | 'onToken' | 'onDone'>,
) {
  const eventName = rawEvent
    .split('\n')
    .find((line) => line.startsWith('event: '))
    ?.replace('event: ', '')
  const data = rawEvent
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.replace('data: ', '')

  if (!eventName || !data) {
    return
  }

  const payload: unknown = JSON.parse(data)

  if (eventName === 'thread') {
    const thread = payload as StreamThreadPayload
    callbacks.onThread(thread.thread_id, thread.title)
    return
  }

  if (eventName === 'tool_call') {
    const { tool, args } = payload as { tool: string; args: Record<string, unknown> }
    callbacks.onToolCall(tool, args)
    return
  }

  if (eventName === 'tool_result') {
    const { tool, summary } = payload as { tool: string; summary: string }
    callbacks.onToolResult(tool, summary)
    return
  }

  if (eventName === 'token') {
    const token = payload as StreamTokenPayload
    callbacks.onToken(token.content)
    return
  }

  if (eventName === 'done') {
    const donePayload = payload as StreamDonePayload
    callbacks.onDone({
      threadId: donePayload.thread_id,
      message: mapMessage(donePayload.message),
      model: donePayload.model,
    })
    return
  }

  if (eventName === 'error') {
    const errorPayload = payload as StreamErrorPayload
    throw new Error(errorPayload.detail)
  }
}

export async function loginWithGoogle(credential: string) {
  return request<{
    access_token: string
    token_type: string
    user: { id: string; email: string; full_name: string }
  }>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  })
}

export async function listMemories(category?: MemoryCategory): Promise<Memory[]> {
  const params = category ? `?category=${category}` : ''
  const response = await request<BackendMemory[]>(`/memories${params}`)
  return response.map(mapMemory)
}

export async function createMemory(payload: {
  category: MemoryCategory
  content: string
  sourceThreadId?: string
  sourceMessageId?: string
}): Promise<Memory> {
  const memory = await request<BackendMemory>('/memories', {
    method: 'POST',
    body: JSON.stringify({
      category: payload.category,
      content: payload.content,
      source_thread_id: payload.sourceThreadId,
      source_message_id: payload.sourceMessageId,
    }),
  })
  return mapMemory(memory)
}

export async function updateMemory(
  id: string,
  payload: { category?: MemoryCategory; content?: string },
): Promise<Memory> {
  const memory = await request<BackendMemory>(`/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return mapMemory(memory)
}

export async function deleteMemory(id: string): Promise<void> {
  await request(`/memories/${id}`, {
    method: 'DELETE',
  })
}
