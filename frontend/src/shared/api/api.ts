import type {
  ActionItem,
  ActionPriority,
  ActionStatus,
  ChatModel,
  ChatThread,
  CurrentUser,
  DreamJobStatus,
  DreamProposal,
  DocumentComment,
  FirmRole,
  FirmUser,
  KnowledgeBankAccessLog,
  KnowledgeBankEntry,
  KnowledgeBankEntryType,
  KnowledgeBankScope,
  Matter,
  Memory,
  MemoryCategory,
  Message,
  RedactionProposal,
  ReviewAnnotation,
  ReviewAnnotationKind,
  ReviewAnnotationReply,
  ReviewAnnotationStatus,
  ReviewHandoff,
  ReviewHandoffStatus,
  SessionUser,
  SurveyCategory,
  SurveyQuestion,
  SurveyResults,
  Team,
  WikiGraph,
  WikiPage,
  WikiPageSource,
  WikiPageType,
  WorkspaceDocument,
} from '../types/workspace'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const UNAUTHORIZED_EVENT = 'lexcatalyst:unauthorized'

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
  tool_steps: Array<{ id?: string; tool: string; args: Record<string, unknown>; summary: string | null; status: 'running' | 'done' }> | null
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
  can_manage: boolean
}

type BackendDocumentComment = {
  id: string
  document_id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  can_delete: boolean
  author: {
    id: string
    full_name: string | null
    email: string
  }
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
  onToolCall: (stepId: string, tool: string, args: Record<string, unknown>) => void
  onToolResult: (stepId: string, tool: string, summary: string) => void
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
  status: KnowledgeBankEntry['status']
  error_message: string | null
  created_by: string
  created_by_role: string
  version: number
  created_at: string
  updated_at: string
  team: BackendTeam | null
  matter: BackendMatter | null
}

type BackendKnowledgeBankEntrySummary = Omit<
  BackendKnowledgeBankEntry,
  'body_markdown' | 'team' | 'matter'
> & {
  body_preview: string
}

type BackendKnowledgeBankEntryPage = {
  items: BackendKnowledgeBankEntrySummary[]
  limit: number
  offset: number
  next_offset: number | null
}

type BackendKnowledgeBankEntryStatus = {
  id: string
  status: KnowledgeBankEntry['status']
  error_message: string | null
  version: number
  updated_at: string
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
  context_matter_id: string | null
  context_thread_id: string | null
  ip_address: string | null
  timestamp: string
}

type BackendMemory = {
  id: string
  category: MemoryCategory
  content: string
  justification: string | null
  confidence: number
  created_at: string
  updated_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token')
  const headers = new Headers(init?.headers)
  if (init?.body != null && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  handleUnauthorized(response)

  const responseText = await response.text()
  if (!response.ok) {
    const payload = parseJson(responseText)
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(detail)
  }

  if (!responseText) return undefined as T
  return JSON.parse(responseText) as T
}

function parseJson(value: string): Record<string, unknown> | null {
  if (!value) return null
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return null
  }
}

function handleUnauthorized(response: Response) {
  if (response.status !== 401 || !localStorage.getItem('token')) return
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
}

export function subscribeToUnauthorized(callback: () => void) {
  window.addEventListener(UNAUTHORIZED_EVENT, callback)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, callback)
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
    steps: message.tool_steps ?? undefined,
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
    canManage: document.can_manage,
  }
}

function mapDocumentComment(comment: BackendDocumentComment): DocumentComment {
  return {
    id: comment.id,
    documentId: comment.document_id,
    userId: comment.user_id,
    content: comment.content,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    canDelete: comment.can_delete,
    author: {
      id: comment.author.id,
      fullName: comment.author.full_name,
      email: comment.author.email,
    },
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
    status: entry.status ?? 'ready',
    errorMessage: entry.error_message,
    createdBy: entry.created_by,
    createdByRole: entry.created_by_role,
    version: entry.version,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    team: entry.team ? mapTeam(entry.team) : null,
    matter: entry.matter ? mapMatter(entry.matter) : null,
  }
}

function mapKnowledgeBankEntrySummary(
  entry: BackendKnowledgeBankEntrySummary,
): KnowledgeBankEntry {
  return {
    id: entry.id,
    teamId: entry.team_id,
    matterId: entry.matter_id,
    sourceEntryId: entry.source_entry_id,
    sourceDocumentId: entry.source_document_id,
    scope: entry.scope,
    entryType: entry.entry_type,
    title: entry.title,
    bodyMarkdown: entry.body_preview,
    tags: entry.tags,
    piiStatus: entry.pii_status,
    status: entry.status ?? 'ready',
    errorMessage: entry.error_message,
    createdBy: entry.created_by,
    createdByRole: entry.created_by_role,
    version: entry.version,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    team: null,
    matter: null,
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
    justification: memory.justification,
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

export async function renameChatThread(threadId: string, title: string): Promise<ChatThread> {
  const thread = await request<BackendThread>(`/chat/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
  return mapThread(thread)
}

export async function deleteChatThread(threadId: string): Promise<void> {
  await request(`/chat/threads/${threadId}`, { method: 'DELETE' })
}

export async function deleteChatMessage(messageId: string): Promise<void> {
  await request(`/chat/messages/${messageId}`, { method: 'DELETE' })
}

export async function listDocuments(): Promise<WorkspaceDocument[]> {
  const documents = await request<BackendDocument[]>('/documents')
  return documents.map(mapDocument)
}

export async function uploadDocument(file: File): Promise<WorkspaceDocument> {
  const token = localStorage.getItem('token')
  const body = new FormData()
  body.append('file', file)

  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: 'POST',
    headers,
    body,
  })

  handleUnauthorized(response)
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

export async function renameDocument(id: string, filename: string): Promise<WorkspaceDocument> {
  return mapDocument(
    await request<BackendDocument>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ filename }),
    }),
  )
}

export async function fetchDocumentFile(
  id: string,
  options: { download?: boolean; signal?: AbortSignal } = {},
): Promise<Blob> {
  const token = localStorage.getItem('token')
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const search = options.download ? '?download=true' : ''
  const response = await fetch(
    `${API_BASE_URL}/documents/${encodeURIComponent(id)}/file${search}`,
    { headers, signal: options.signal },
  )
  handleUnauthorized(response)
  if (!response.ok) {
    const responseText = await response.text()
    const payload = parseJson(responseText)
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(detail)
  }
  return response.blob()
}

export async function listDocumentComments(documentId: string): Promise<DocumentComment[]> {
  const comments = await request<BackendDocumentComment[]>(
    `/documents/${documentId}/comments`,
  )
  return comments.map(mapDocumentComment)
}

export async function createDocumentComment(
  documentId: string,
  content: string,
): Promise<DocumentComment> {
  return mapDocumentComment(
    await request<BackendDocumentComment>(`/documents/${documentId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  )
}

export async function deleteDocumentComment(commentId: string): Promise<void> {
  await request(`/documents/comments/${commentId}`, { method: 'DELETE' })
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

  handleUnauthorized(response)
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(detail)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const rawEvent of events) {
      completed =
        handleStreamEvent(rawEvent, { onThread, onToolCall, onToolResult, onToken, onDone }) ===
          'done' || completed
    }
  }

  if (buffer.trim()) {
    completed =
      handleStreamEvent(buffer, { onThread, onToolCall, onToolResult, onToken, onDone }) ===
        'done' || completed
  }
  if (!completed) throw new Error('The response stream ended before completion. Please try again.')
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

export async function listKnowledgeBankEntryPage(params?: {
  scope?: KnowledgeBankScope
  entryType?: KnowledgeBankEntryType
  matterId?: string
  contextMatterId?: string
  teamId?: string
  piiStatus?: KnowledgeBankEntry['piiStatus']
  query?: string
  limit?: number
  offset?: number
}): Promise<{
  items: KnowledgeBankEntry[]
  nextOffset: number | null
}> {
  const search = new URLSearchParams()
  if (params?.scope) search.set('scope', params.scope)
  if (params?.entryType) search.set('entry_type', params.entryType)
  if (params?.matterId) search.set('matter_id', params.matterId)
  if (params?.contextMatterId) search.set('context_matter_id', params.contextMatterId)
  if (params?.teamId) search.set('team_id', params.teamId)
  if (params?.piiStatus) search.set('pii_status', params.piiStatus)
  if (params?.query) search.set('query', params.query)
  search.set('limit', String(params?.limit ?? 30))
  search.set('offset', String(params?.offset ?? 0))
  const suffix = search.toString() ? `?${search}` : ''
  const page = await request<BackendKnowledgeBankEntryPage>(`/kb/entries${suffix}`)
  return {
    items: page.items.map(mapKnowledgeBankEntrySummary),
    nextOffset: page.next_offset,
  }
}

export async function listKnowledgeBankEntries(
  params?: Omit<Parameters<typeof listKnowledgeBankEntryPage>[0], 'limit' | 'offset'>,
): Promise<KnowledgeBankEntry[]> {
  return (await listKnowledgeBankEntryPage({ ...params, limit: 100, offset: 0 })).items
}

export async function getKnowledgeBankEntry(id: string): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/entries/${id}`),
  )
}

export async function getKnowledgeBankEntryStatuses(
  ids: string[],
): Promise<BackendKnowledgeBankEntryStatus[]> {
  const search = new URLSearchParams()
  ids.slice(0, 100).forEach((id) => search.append('ids', id))
  return request<BackendKnowledgeBankEntryStatus[]>(
    `/kb/entries/status?${search.toString()}`,
  )
}

export async function backfillKnowledgeBankEmbeddings(): Promise<{
  embeddedCount: number
  normalizedScopeCount: number
  remainingCount: number
}> {
  const result = await request<{
    embedded_count: number
    normalized_scope_count: number
    remaining_count: number
  }>('/kb/backfill-embeddings', { method: 'POST' })
  return {
    embeddedCount: result.embedded_count,
    normalizedScopeCount: result.normalized_scope_count,
    remainingCount: result.remaining_count,
  }
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
): Promise<KnowledgeBankEntry> {
  // The backend always uses DeepSeek Pro for KB summarisation and runs it
  // as an async background task. The response is a placeholder entry with
  // status="processing"; clients should poll until status="ready".
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/ingest/document/${documentId}`, {
      method: 'POST',
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
    contextMatterId: row.context_matter_id,
    contextThreadId: row.context_thread_id,
    ipAddress: row.ip_address,
    timestamp: row.timestamp,
  }))
}

function handleStreamEvent(
  rawEvent: string,
  callbacks: Pick<StreamChatOptions, 'onThread' | 'onToolCall' | 'onToolResult' | 'onToken' | 'onDone'>,
): string | null {
  const eventName = rawEvent
    .split('\n')
    .find((line) => line.startsWith('event: '))
    ?.replace('event: ', '')
  const data = rawEvent
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.replace('data: ', '')

  if (!eventName || !data) {
    return null
  }

  const payload: unknown = JSON.parse(data)

  if (eventName === 'thread') {
    const thread = payload as StreamThreadPayload
    callbacks.onThread(thread.thread_id, thread.title)
    return eventName
  }

  if (eventName === 'tool_call') {
    const { step_id, tool, args } = payload as {
      step_id: string
      tool: string
      args: Record<string, unknown>
    }
    callbacks.onToolCall(step_id, tool, args)
    return eventName
  }

  if (eventName === 'tool_result') {
    const { step_id, tool, summary } = payload as {
      step_id: string
      tool: string
      summary: string
    }
    callbacks.onToolResult(step_id, tool, summary)
    return eventName
  }

  if (eventName === 'token') {
    const token = payload as StreamTokenPayload
    callbacks.onToken(token.content)
    return eventName
  }

  if (eventName === 'done') {
    const donePayload = payload as StreamDonePayload
    callbacks.onDone({
      threadId: donePayload.thread_id,
      message: mapMessage(donePayload.message),
      model: donePayload.model,
    })
    return eventName
  }

  if (eventName === 'error') {
    const errorPayload = payload as StreamErrorPayload
    throw new Error(errorPayload.detail)
  }
  return eventName
}

export async function loginWithGoogle(credential: string): Promise<{
  accessToken: string
  tokenType: string
  user: SessionUser
}> {
  const response = await request<{
    access_token: string
    token_type: string
    user: { id: string; email: string; full_name: string; firm_role: FirmRole; is_admin: boolean }
  }>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  })
  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    user: {
      id: response.user.id,
      email: response.user.email,
      fullName: response.user.full_name,
      firmRole: response.user.firm_role,
      isAdmin: response.user.is_admin,
    },
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const u = await request<{
    id: string
    email: string
    full_name: string | null
    firm_role: FirmRole
    is_admin: boolean
    default_team_id: string | null
    created_at: string
  }>('/me')
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    firmRole: u.firm_role,
    isAdmin: u.is_admin,
    defaultTeamId: u.default_team_id,
    createdAt: u.created_at,
  }
}

export async function updateCurrentUserRole(firmRole: FirmRole): Promise<CurrentUser> {
  const u = await request<{
    id: string
    email: string
    full_name: string | null
    firm_role: FirmRole
    is_admin: boolean
    default_team_id: string | null
    created_at: string
  }>('/me', {
    method: 'PATCH',
    body: JSON.stringify({ firm_role: firmRole }),
  })
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    firmRole: u.firm_role,
    isAdmin: u.is_admin,
    defaultTeamId: u.default_team_id,
    createdAt: u.created_at,
  }
}

export async function updateOtherUserRole(userId: string, firmRole: FirmRole): Promise<FirmUser> {
  const u = await request<BackendFirmUser>(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ firm_role: firmRole }),
  })
  return {
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    firmRole: u.firm_role,
    isAdmin: u.is_admin,
  }
}

// Survey

type BackendSurveyQuestion = {
  id: string
  text: string
  category: SurveyCategory
  order_index: number
  is_active: boolean
  created_at: string
}

function mapSurveyQuestion(q: BackendSurveyQuestion): SurveyQuestion {
  return {
    id: q.id,
    text: q.text,
    category: q.category,
    orderIndex: q.order_index,
    isActive: q.is_active,
    createdAt: q.created_at,
  }
}

export async function listSurveyQuestions(activeOnly = true): Promise<SurveyQuestion[]> {
  const qs = await request<BackendSurveyQuestion[]>(`/survey/questions?active_only=${activeOnly}`)
  return qs.map(mapSurveyQuestion)
}

export async function createSurveyQuestion(payload: {
  text: string
  category: SurveyCategory
  orderIndex?: number
}): Promise<SurveyQuestion> {
  return mapSurveyQuestion(
    await request<BackendSurveyQuestion>('/survey/questions', {
      method: 'POST',
      body: JSON.stringify({ text: payload.text, category: payload.category, order_index: payload.orderIndex ?? 0 }),
    }),
  )
}

export async function updateSurveyQuestion(
  id: string,
  payload: { text?: string; category?: SurveyCategory; orderIndex?: number; isActive?: boolean },
): Promise<SurveyQuestion> {
  return mapSurveyQuestion(
    await request<BackendSurveyQuestion>(`/survey/questions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        text: payload.text,
        category: payload.category,
        order_index: payload.orderIndex,
        is_active: payload.isActive,
      }),
    }),
  )
}

export async function deleteSurveyQuestion(id: string): Promise<void> {
  await request(`/survey/questions/${id}`, { method: 'DELETE' })
}

export async function submitSurveyResponse(payload: {
  questionId: string
  score: number
  weekOf: string
}): Promise<void> {
  await request('/survey/responses', {
    method: 'POST',
    body: JSON.stringify({ question_id: payload.questionId, score: payload.score, week_of: payload.weekOf }),
  })
}

export async function getSurveyResults(): Promise<SurveyResults> {
  const results = await request<{
    current_week_of: string
    users: Array<{
      user_id: string
      full_name: string | null
      email: string
      firm_role: FirmRole
      week_of: string
      average_score: number | null
      response_count: number
      question_count: number
    }>
    questions: Array<{
      question_id: string
      question_text: string
      category: string
      weeks: Array<{
        week_of: string
        avg_score: number
        response_count: number
      }>
    }>
  }>('/survey/results')

  return {
    currentWeekOf: results.current_week_of,
    users: results.users.map((user) => ({
      userId: user.user_id,
      fullName: user.full_name,
      email: user.email,
      firmRole: user.firm_role,
      weekOf: user.week_of,
      averageScore: user.average_score,
      responseCount: user.response_count,
      questionCount: user.question_count,
    })),
    questions: results.questions.map((question) => ({
      questionId: question.question_id,
      questionText: question.question_text,
      category: question.category,
      weeks: question.weeks.map((week) => ({
        weekOf: week.week_of,
        avgScore: week.avg_score,
        responseCount: week.response_count,
      })),
    })),
  }
}

// Action items

type BackendActionUser = { id: string; full_name: string | null; email: string }
type BackendActionItem = {
  id: string
  title: string
  description: string | null
  assignee_id: string | null
  assigner_id: string
  matter_id: string | null
  due_date: string | null
  status: ActionStatus
  priority: ActionPriority
  tags: string[]
  active_handoff_id: string | null
  created_at: string
  updated_at: string
  assignee: BackendActionUser | null
  assigner: BackendActionUser | null
}

function mapActionItem(item: BackendActionItem): ActionItem {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    assigneeId: item.assignee_id,
    assignerId: item.assigner_id,
    matterId: item.matter_id,
    dueDate: item.due_date,
    status: item.status,
    priority: item.priority,
    tags: item.tags ?? [],
    activeHandoffId: item.active_handoff_id,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    assignee: item.assignee ? { id: item.assignee.id, fullName: item.assignee.full_name, email: item.assignee.email } : null,
    assigner: item.assigner ? { id: item.assigner.id, fullName: item.assigner.full_name, email: item.assigner.email } : null,
  }
}

export async function listActionItems(): Promise<ActionItem[]> {
  // The board is fetched whole (capped at 500 by the backend) and filtered
  // client-side so tag/assignee chips don't trigger a roundtrip.
  const items = await request<BackendActionItem[]>('/actions')
  return items.map(mapActionItem)
}

export async function createActionItem(payload: {
  title: string
  description?: string | null
  assigneeId?: string | null
  matterId?: string | null
  dueDate?: string | null
  priority?: ActionPriority
  tags?: string[]
}): Promise<ActionItem> {
  return mapActionItem(
    await request<BackendActionItem>('/actions', {
      method: 'POST',
      body: JSON.stringify({
        title: payload.title,
        description: payload.description,
        assignee_id: payload.assigneeId,
        matter_id: payload.matterId,
        due_date: payload.dueDate,
        priority: payload.priority ?? 'medium',
        tags: payload.tags ?? [],
      }),
    }),
  )
}

export async function updateActionItem(
  id: string,
  payload: {
    title?: string
    description?: string | null
    assigneeId?: string | null
    matterId?: string | null
    status?: ActionStatus
    priority?: ActionPriority
    dueDate?: string | null
    tags?: string[]
  },
): Promise<ActionItem> {
  return mapActionItem(
    await request<BackendActionItem>(`/actions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: payload.title,
        description: payload.description,
        assignee_id: payload.assigneeId,
        matter_id: payload.matterId,
        status: payload.status,
        priority: payload.priority,
        due_date: payload.dueDate,
        tags: payload.tags,
      }),
    }),
  )
}

export async function deleteActionItem(id: string): Promise<void> {
  await request(`/actions/${id}`, { method: 'DELETE' })
}

// Firm directory

type BackendFirmUser = {
  id: string
  full_name: string | null
  email: string
  firm_role: FirmRole
  is_admin: boolean
}

export async function listFirmUsers(): Promise<FirmUser[]> {
  const users = await request<BackendFirmUser[]>('/users')
  return users.map((u) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    firmRole: u.firm_role,
    isAdmin: u.is_admin,
  }))
}

// Birdie mentor streaming

type BirdieHistoryMessage = { role: 'user' | 'assistant'; content: string }

export async function streamBirdieMessage({
  message,
  history,
  matterId,
  signal,
  onToken,
  onDone,
  onError,
}: {
  message: string
  history: BirdieHistoryMessage[]
  matterId: string | null
  signal?: AbortSignal
  onToken: (content: string) => void
  onDone: (fullContent: string) => void
  onError: (detail: string) => void
}) {
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${API_BASE_URL}/birdie/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, history, matter_id: matterId }),
    signal,
  })

  handleUnauthorized(response)
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    onError(typeof payload?.detail === 'string' ? payload.detail : response.statusText)
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  function processEvent(raw: string) {
    const eventName = raw.split('\n').find((line) => line.startsWith('event: '))?.slice(7)
    const data = raw.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
    if (!eventName || !data) return
    const payload = JSON.parse(data) as Record<string, string>
    if (eventName === 'token') onToken(payload.content)
    else if (eventName === 'done') {
      completed = true
      onDone(payload.content)
    } else if (eventName === 'error') {
      completed = true
      onError(payload.detail)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const raw of events) processEvent(raw)
  }
  if (buffer.trim()) processEvent(buffer)
  if (!completed) onError('Birdie stopped responding before the answer completed.')
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

type BackendDreamAddition = { category: MemoryCategory; content: string; reason: string }
type BackendDreamMerge = {
  replace_ids: string[]
  category: MemoryCategory
  content: string
  reason: string
}
type BackendDreamUpdate = { memory_id: string; content: string; reason: string }
type BackendDreamDrop = { memory_id: string; reason: string }
type BackendDreamProposal = {
  additions: BackendDreamAddition[]
  merges: BackendDreamMerge[]
  updates: BackendDreamUpdate[]
  drops: BackendDreamDrop[]
  reviewed_message_count: number
}
type BackendDreamJobStatus = {
  job_id: string
  status: 'processing' | 'completed' | 'failed'
  proposal: BackendDreamProposal | null
  memories: BackendMemory[] | null
  error_message: string | null
}

function mapDreamProposal(proposal: BackendDreamProposal): DreamProposal {
  return {
    additions: proposal.additions.map((a) => ({
      category: a.category,
      content: a.content,
      reason: a.reason,
    })),
    merges: proposal.merges.map((m) => ({
      replaceIds: m.replace_ids,
      category: m.category,
      content: m.content,
      reason: m.reason,
    })),
    updates: proposal.updates.map((u) => ({
      memoryId: u.memory_id,
      content: u.content,
      reason: u.reason,
    })),
    drops: proposal.drops.map((d) => ({ memoryId: d.memory_id, reason: d.reason })),
    reviewedMessageCount: proposal.reviewed_message_count,
  }
}

function mapDreamJobStatus(status: BackendDreamJobStatus): DreamJobStatus {
  return {
    jobId: status.job_id,
    status: status.status,
    proposal: status.proposal ? mapDreamProposal(status.proposal) : null,
    memories: status.memories?.map(mapMemory) ?? null,
    errorMessage: status.error_message,
  }
}

export async function startDreamJob(): Promise<DreamJobStatus> {
  const status = await request<BackendDreamJobStatus>('/memories/dream', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return mapDreamJobStatus(status)
}

export async function getDreamJob(jobId: string): Promise<DreamJobStatus> {
  const status = await request<BackendDreamJobStatus>(`/memories/dream/${jobId}`)
  return mapDreamJobStatus(status)
}

// Review handoffs + annotations

type BackendAnnotationReply = {
  id: string
  annotation_id: string
  author_user_id: string | null
  body_markdown: string
  created_at: string
  updated_at: string
  author: BackendActionUser | null
}

type BackendReviewAnnotation = {
  id: string
  handoff_id: string
  document_id: string
  page_no: number
  kind: ReviewAnnotationKind
  anchor_quote: string
  anchor_rects: Array<{ pageIndex: number; left: number; top: number; width: number; height: number }>
  suggested_text: string | null
  note: string | null
  status: ReviewAnnotationStatus
  author_user_id: string | null
  promoted_kb_entry_id: string | null
  previous_annotation_id: string | null
  created_at: string
  updated_at: string
  author: BackendActionUser | null
  replies: BackendAnnotationReply[]
}

type BackendReviewHandoff = {
  id: string
  action_id: string | null
  matter_id: string | null
  document_id: string
  document_filename: string | null
  submitted_by: string
  submitted_at: string
  status: ReviewHandoffStatus
  reviewer_id: string | null
  completed_at: string | null
  return_reason: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  submitter: BackendActionUser | null
  reviewer: BackendActionUser | null
  annotations: BackendReviewAnnotation[]
}

function mapUser(u: BackendActionUser | null): ReviewAnnotation['author'] {
  return u ? { id: u.id, fullName: u.full_name, email: u.email } : null
}

function mapReply(r: BackendAnnotationReply): ReviewAnnotationReply {
  return {
    id: r.id,
    annotationId: r.annotation_id,
    authorUserId: r.author_user_id,
    bodyMarkdown: r.body_markdown,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: mapUser(r.author),
  }
}

function mapAnnotation(a: BackendReviewAnnotation): ReviewAnnotation {
  return {
    id: a.id,
    handoffId: a.handoff_id,
    documentId: a.document_id,
    pageNo: a.page_no,
    kind: a.kind,
    anchorQuote: a.anchor_quote,
    anchorRects: a.anchor_rects ?? [],
    suggestedText: a.suggested_text,
    note: a.note,
    status: a.status,
    authorUserId: a.author_user_id,
    promotedKbEntryId: a.promoted_kb_entry_id,
    previousAnnotationId: a.previous_annotation_id,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    author: mapUser(a.author),
    replies: (a.replies ?? []).map(mapReply),
  }
}

function mapHandoff(h: BackendReviewHandoff): ReviewHandoff {
  return {
    id: h.id,
    actionId: h.action_id,
    matterId: h.matter_id,
    documentId: h.document_id,
    documentFilename: h.document_filename,
    submittedBy: h.submitted_by,
    submittedAt: h.submitted_at,
    status: h.status,
    reviewerId: h.reviewer_id,
    completedAt: h.completed_at,
    returnReason: h.return_reason,
    errorMessage: h.error_message,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
    submitter: mapUser(h.submitter),
    reviewer: mapUser(h.reviewer),
    annotations: (h.annotations ?? []).map(mapAnnotation),
  }
}

export async function createReviewHandoff(payload: {
  documentId: string
  actionId?: string | null
  matterId?: string | null
  reviewerId?: string | null
}): Promise<ReviewHandoff> {
  return mapHandoff(
    await request<BackendReviewHandoff>('/handoffs', {
      method: 'POST',
      body: JSON.stringify({
        document_id: payload.documentId,
        action_id: payload.actionId ?? null,
        matter_id: payload.matterId ?? null,
        reviewer_id: payload.reviewerId ?? null,
      }),
    }),
  )
}

export async function getReviewHandoff(handoffId: string): Promise<ReviewHandoff> {
  return mapHandoff(await request<BackendReviewHandoff>(`/handoffs/${handoffId}`))
}

export async function listReviewHandoffsForAction(actionId: string): Promise<ReviewHandoff[]> {
  const items = await request<BackendReviewHandoff[]>(
    `/handoffs?action_id=${encodeURIComponent(actionId)}`,
  )
  return items.map(mapHandoff)
}

export async function updateReviewHandoff(
  handoffId: string,
  payload: { status?: ReviewHandoffStatus; reviewerId?: string | null },
): Promise<ReviewHandoff> {
  return mapHandoff(
    await request<BackendReviewHandoff>(`/handoffs/${handoffId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: payload.status,
        reviewer_id: payload.reviewerId,
      }),
    }),
  )
}

export async function deleteReviewHandoff(handoffId: string): Promise<void> {
  await request(`/handoffs/${handoffId}`, { method: 'DELETE' })
}

export async function listReviewAnnotations(handoffId: string): Promise<ReviewAnnotation[]> {
  const items = await request<BackendReviewAnnotation[]>(
    `/handoffs/${handoffId}/annotations`,
  )
  return items.map(mapAnnotation)
}

export async function createReviewAnnotation(
  handoffId: string,
  payload: {
    documentId: string
    pageNo: number
    kind: ReviewAnnotationKind
    anchorQuote: string
    anchorRects: ReviewAnnotation['anchorRects']
    suggestedText?: string | null
    note?: string | null
  },
): Promise<ReviewAnnotation> {
  return mapAnnotation(
    await request<BackendReviewAnnotation>(`/handoffs/${handoffId}/annotations`, {
      method: 'POST',
      body: JSON.stringify({
        document_id: payload.documentId,
        page_no: payload.pageNo,
        kind: payload.kind,
        anchor_quote: payload.anchorQuote,
        anchor_rects: payload.anchorRects,
        suggested_text: payload.suggestedText ?? null,
        note: payload.note ?? null,
      }),
    }),
  )
}

export async function updateReviewAnnotation(
  handoffId: string,
  annotationId: string,
  payload: {
    status?: ReviewAnnotationStatus
    suggestedText?: string | null
    note?: string | null
  },
): Promise<ReviewAnnotation> {
  return mapAnnotation(
    await request<BackendReviewAnnotation>(
      `/handoffs/${handoffId}/annotations/${annotationId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: payload.status,
          suggested_text: payload.suggestedText,
          note: payload.note,
        }),
      },
    ),
  )
}

export async function deleteReviewAnnotation(
  handoffId: string,
  annotationId: string,
): Promise<void> {
  await request(`/handoffs/${handoffId}/annotations/${annotationId}`, { method: 'DELETE' })
}

export async function listAnnotationReplies(
  handoffId: string,
  annotationId: string,
): Promise<ReviewAnnotationReply[]> {
  const items = await request<BackendAnnotationReply[]>(
    `/handoffs/${handoffId}/annotations/${annotationId}/replies`,
  )
  return items.map(mapReply)
}

export async function postAnnotationReply(
  handoffId: string,
  annotationId: string,
  body: string,
): Promise<ReviewAnnotationReply> {
  return mapReply(
    await request<BackendAnnotationReply>(
      `/handoffs/${handoffId}/annotations/${annotationId}/replies`,
      {
        method: 'POST',
        body: JSON.stringify({ body_markdown: body }),
      },
    ),
  )
}

export async function deleteAnnotationReply(
  handoffId: string,
  annotationId: string,
  replyId: string,
): Promise<void> {
  await request(
    `/handoffs/${handoffId}/annotations/${annotationId}/replies/${replyId}`,
    { method: 'DELETE' },
  )
}

export async function rejectReviewHandoff(
  handoffId: string,
  reason: string,
): Promise<ReviewHandoff> {
  return mapHandoff(
    await request<BackendReviewHandoff>(`/handoffs/${handoffId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  )
}

export async function promoteAnnotationToKb(
  handoffId: string,
  annotationId: string,
  payload: {
    targetScope?: KnowledgeBankScope
    entryType?: KnowledgeBankEntryType
    title?: string | null
    tags?: string[]
  },
): Promise<KnowledgeBankEntry> {
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(
      `/handoffs/${handoffId}/annotations/${annotationId}/promote`,
      {
        method: 'POST',
        body: JSON.stringify({
          target_scope: payload.targetScope ?? 'matter',
          entry_type: payload.entryType ?? 'knowledge_bank',
          title: payload.title ?? null,
          tags: payload.tags ?? [],
        }),
      },
    ),
  )
}

export async function exportAnnotatedPdf(handoffId: string): Promise<Blob> {
  const token = localStorage.getItem('token') ?? ''
  const res = await fetch(`${API_BASE_URL}/handoffs/${handoffId}/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  handleUnauthorized(res)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `Export failed: ${res.status}`)
  }
  return res.blob()
}

export async function getReviewsWaitingCount(): Promise<number> {
  const res = await request<{ count: number }>('/handoffs/reviews/waiting')
  return res.count ?? 0
}

export async function createDummyUsers(count: number = 2): Promise<void> {
  await request(`/system/dummy-users?count=${count}`, {
    method: 'POST',
  })
}

export async function deleteDummyUsers(): Promise<void> {
  await request('/system/dummy-users', { method: 'DELETE' })
}
