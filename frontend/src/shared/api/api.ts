import type {
  ActionItem,
  ActionPriority,
  ActionStatus,
  MessageSource,
  ModelChoice,
  ChatThread,
  CurrentUser,
  DocumentFolder,
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
  Team,
  WorkspaceDocument,
  BirdiePageContext,
  LlmSettings,
  LlmTier,
  BirdieLesson,
  DemoUser,
  FeedbackRound,
  ResourceMetadata,
} from '../types/workspace'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const UNAUTHORIZED_EVENT = 'lexcatalyst:unauthorized'

type BackendThread = {
  id: string
  title: string
  matter_id: string | null
  created_at: string
  updated_at: string
}

type BackendMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
  model: string | null
  tool_steps: Array<{ id?: string; tool: string; args: Record<string, unknown>; summary: string | null; status: 'running' | 'done' }> | null
  sources?: BackendMessageSource[] | null
  created_at: string
}

type BackendMessageSource = {
  n: number
  kind: 'document' | 'kb_entry' | 'elitigation'
  id: string
  title: string
  locator: string | null
  matter_id: string | null
  scope?: string | null
  excerpt?: string | null
  url?: string | null
}

function mapMessageSources(sources: BackendMessageSource[] | null | undefined): MessageSource[] | undefined {
  if (!sources?.length) return undefined
  return sources.map((source) => ({
    n: source.n,
    kind: source.kind,
    id: source.id,
    title: source.title,
    locator: source.locator,
    matterId: source.matter_id,
    scope: source.scope ?? null,
    excerpt: source.excerpt ?? null,
    url: source.url ?? null,
  }))
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
  folder_id: string | null
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
  model: ModelChoice
  threadId: string | null
  matterId?: string | null
  signal?: AbortSignal
  onThread: (threadId: string, title: string) => void
  onToolCall: (stepId: string, tool: string, args: Record<string, unknown>) => void
  onToolResult: (stepId: string, tool: string, summary: string) => void
  onSources?: (sources: MessageSource[]) => void
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
  document_type: string | null
  document_status: string | null
  execution_date: string | null
  catalogue_fields: Record<string, unknown> | null
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
  if (token && !headers.has('Authorization')) {
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
  if (restorePresenterSession()) {
    window.location.reload()
    return
  }
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
    matterId: thread.matter_id ?? null,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  }
}

function mapMessage(message: BackendMessage): Message {
  return {
    id: message.id,
    role: message.role,
    body: message.content,
    // Messages from before the OpenRouter switch carry a retired provider's model id.
    meta: message.model ? `Model: ${message.model.startsWith('deepseek') ? 'DeepSeek (retired)' : message.model}` : undefined,
    steps: message.tool_steps ?? undefined,
    sources: mapMessageSources(message.sources),
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
    folderId: document.folder_id ?? null,
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
    documentType: entry.document_type,
    documentStatus: entry.document_status,
    executionDate: entry.execution_date,
    catalogueFields: entry.catalogue_fields,
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
    documentType: entry.document_type,
    documentStatus: entry.document_status,
    executionDate: entry.execution_date,
    catalogueFields: entry.catalogue_fields,
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

/** 'all' = every thread, 'general' = no matter, otherwise a matter id. */
export type ThreadScope = string

export async function listChatThreads(scope: ThreadScope = 'all'): Promise<ChatThread[]> {
  const query = scope === 'all' ? '' : `?matter_id=${encodeURIComponent(scope)}`
  const threads = await request<BackendThread[]>(`/chat/threads${query}`)
  return threads.map(mapThread)
}

export async function moveChatThread(threadId: string, matterId: string | null): Promise<ChatThread> {
  const thread = await request<BackendThread>(`/chat/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ matter_id: matterId }),
  })
  return mapThread(thread)
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

export async function uploadDocument(
  file: File,
  target?: { matterId?: string | null; folderId?: string | null },
): Promise<WorkspaceDocument> {
  const token = localStorage.getItem('token')
  const body = new FormData()
  body.append('file', file)
  if (target?.matterId) body.append('matter_id', target.matterId)
  if (target?.folderId) body.append('folder_id', target.folderId)

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

type BackendDocumentFolder = {
  id: string
  matter_id: string | null
  name: string
  created_by: string
  can_manage: boolean
  created_at: string
  updated_at: string
}

function mapDocumentFolder(folder: BackendDocumentFolder): DocumentFolder {
  return {
    id: folder.id,
    matterId: folder.matter_id,
    name: folder.name,
    createdBy: folder.created_by,
    canManage: folder.can_manage,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  }
}

/** matterId null = the caller's General folders. */
export async function listDocumentFolders(matterId: string | null): Promise<DocumentFolder[]> {
  const folders = await request<BackendDocumentFolder[]>(
    `/document-folders?matter_id=${encodeURIComponent(matterId ?? 'general')}`,
  )
  return folders.map(mapDocumentFolder)
}

export async function createDocumentFolder(name: string, matterId: string | null): Promise<DocumentFolder> {
  return mapDocumentFolder(
    await request<BackendDocumentFolder>('/document-folders', {
      method: 'POST',
      body: JSON.stringify({ name, matter_id: matterId }),
    }),
  )
}

export async function renameDocumentFolder(id: string, name: string): Promise<DocumentFolder> {
  return mapDocumentFolder(
    await request<BackendDocumentFolder>(`/document-folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  )
}

export async function deleteDocumentFolder(id: string): Promise<void> {
  await request<void>(`/document-folders/${id}`, { method: 'DELETE' })
}

/** folderId null = back to the matter root. */
export async function moveDocumentToFolder(id: string, folderId: string | null): Promise<WorkspaceDocument> {
  return mapDocument(
    await request<BackendDocument>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ folder_id: folderId }),
    }),
  )
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

export async function moveDocument(id: string, matterId: string | null): Promise<WorkspaceDocument> {
  return mapDocument(
    await request<BackendDocument>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ matter_id: matterId }),
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

export async function sendChatMessage(message: string, threadId: string | null, model: ModelChoice) {
  const response = await request<BackendChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      thread_id: threadId,
      ...model,
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
  onSources,
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
      ...model,
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
        handleStreamEvent(rawEvent, { onThread, onToolCall, onToolResult, onSources, onToken, onDone }) ===
          'done' || completed
    }
  }

  if (buffer.trim()) {
    completed =
      handleStreamEvent(buffer, { onThread, onToolCall, onToolResult, onSources, onToken, onDone }) ===
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

export async function updateMatter(
  id: string,
  patch: { title?: string; caseNumber?: string; clientName?: string | null; status?: Matter['status'] },
): Promise<Matter> {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.caseNumber !== undefined) body.case_number = patch.caseNumber
  if (patch.clientName !== undefined) body.client_name = patch.clientName
  if (patch.status !== undefined) body.status = patch.status
  return mapMatter(
    await request<BackendMatter>(`/matters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  )
}

export async function deleteMatter(id: string): Promise<void> {
  await request<void>(`/matters/${id}`, { method: 'DELETE' })
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
  // The backend uses the user's kb_summary tier for KB summarisation and runs it
  // as an async background task. The response is a placeholder entry with
  // status="processing"; clients should poll until status="ready".
  return mapKnowledgeBankEntry(
    await request<BackendKnowledgeBankEntry>(`/kb/ingest/document/${documentId}`, {
      method: 'POST',
    }),
  )
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
  callbacks: Pick<StreamChatOptions, 'onThread' | 'onToolCall' | 'onToolResult' | 'onSources' | 'onToken' | 'onDone'>,
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

  if (eventName === 'sources') {
    callbacks.onSources?.(mapMessageSources((payload as { sources: BackendMessageSource[] }).sources) ?? [])
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

type BackendResourceMetadata = {
  id: string
  resource_type: string
  resource_id: string
  title: string | null
  owner_user_id: string | null
  created_by: string | null
  team_id: string | null
  matter_id: string | null
  scope: string | null
  source_document_id: string | null
  status: string | null
  metadata_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export async function listResourceMetadata(params?: {
  resourceType?: string
  matterId?: string
  teamId?: string
  scope?: string
  limit?: number
  offset?: number
}): Promise<ResourceMetadata[]> {
  const qs = new URLSearchParams()
  if (params?.resourceType) qs.set('resource_type', params.resourceType)
  if (params?.matterId) qs.set('matter_id', params.matterId)
  if (params?.teamId) qs.set('team_id', params.teamId)
  if (params?.scope) qs.set('scope', params.scope)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  if (params?.offset != null) qs.set('offset', String(params.offset))
  const suffix = qs.size ? `?${qs}` : ''
  const rows = await request<BackendResourceMetadata[]>(`/resources/metadata${suffix}`)
  return rows.map((r) => ({
    id: r.id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    title: r.title,
    ownerUserId: r.owner_user_id,
    createdBy: r.created_by,
    teamId: r.team_id,
    matterId: r.matter_id,
    scope: r.scope,
    sourceDocumentId: r.source_document_id,
    status: r.status,
    metadataJson: r.metadata_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

// Birdie mentor streaming

type BirdieHistoryMessage = { role: 'user' | 'assistant'; content: string }

function toBackendPageContext(ctx: BirdiePageContext) {
  return {
    view: ctx.view,
    thread_id: ctx.threadId,
    document_id: ctx.documentId,
    kb_entry_id: ctx.kbEntryId,
    action_id: ctx.actionId,
  }
}

export async function streamBirdieMessage({
  message,
  history,
  matterId,
  pageContext,
  model,
  signal,
  onToken,
  onWorkboardChange,
  onDone,
  onError,
}: {
  model?: ModelChoice
  message: string
  history: BirdieHistoryMessage[]
  matterId: string | null
  pageContext?: BirdiePageContext
  signal?: AbortSignal
  onWorkboardChange?: () => void
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
    body: JSON.stringify({ message, history, matter_id: matterId, page_context: pageContext && toBackendPageContext(pageContext), ...model }),
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
    if (eventName === 'workboard_changed') onWorkboardChange?.()
    else if (eventName === 'token') onToken(payload.content)
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
  can_review?: boolean
  can_annotate?: boolean
  can_remove?: boolean
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
    canReview: h.can_review ?? false,
    canAnnotate: h.can_annotate ?? false,
    canRemove: h.can_remove ?? false,
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

/** Earlier rounds of a carried-forward annotation (with replies), newest first. */
export async function getReviewAnnotationHistory(
  handoffId: string,
  annotationId: string,
): Promise<ReviewAnnotation[]> {
  const items = await request<BackendReviewAnnotation[]>(
    `/handoffs/${handoffId}/annotations/${annotationId}/history`,
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


// LLM settings (personal OpenRouter key, High/Mid tier models, per-feature tiers)

type BackendLlmSettings = {
  has_key: boolean
  key_last4: string | null
  key_source: 'user' | 'demo' | null
  custom_models: { high: string | null; mid: string | null }
  models: { high: string; mid: string }
  feature_tiers: Record<string, LlmTier>
  features: { key: string; label: string; default_tier: LlmTier }[]
}

function mapLlmSettings(s: BackendLlmSettings): LlmSettings {
  return {
    hasKey: s.has_key,
    keyLast4: s.key_last4,
    keySource: s.key_source,
    customModels: s.custom_models,
    models: s.models,
    featureTiers: s.feature_tiers,
    features: s.features.map((f) => ({ key: f.key, label: f.label, defaultTier: f.default_tier })),
  }
}

export async function getLlmSettings(): Promise<LlmSettings> {
  return mapLlmSettings(await request<BackendLlmSettings>('/settings/llm'))
}

export async function updateLlmSettings(payload: {
  openrouterApiKey?: string
  modelHigh?: string | null
  modelMid?: string | null
  featureTiers?: Record<string, LlmTier>
}): Promise<LlmSettings> {
  const body: Record<string, unknown> = {}
  if (payload.openrouterApiKey) body.openrouter_api_key = payload.openrouterApiKey
  if (payload.modelHigh !== undefined) body.model_high = payload.modelHigh
  if (payload.modelMid !== undefined) body.model_mid = payload.modelMid
  if (payload.featureTiers !== undefined) body.feature_tiers = payload.featureTiers
  return mapLlmSettings(
    await request<BackendLlmSettings>('/settings/llm', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  )
}

export type OpenrouterModel = {
  id: string
  name: string
  contextLength: number | null
  promptPricePerMillion: number | null
}

export async function listOpenrouterModels(): Promise<OpenrouterModel[]> {
  const models = await request<
    { id: string; name: string; context_length: number | null; prompt_price_per_million: number | null }[]
  >('/settings/llm/models')
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    promptPricePerMillion: m.prompt_price_per_million,
  }))
}

export async function clearOpenrouterKey(): Promise<LlmSettings> {
  return mapLlmSettings(
    await request<BackendLlmSettings>('/settings/llm/openrouter-key', { method: 'DELETE' }),
  )
}

// Birdie lessons (reviewer feedback on the user's own review rounds)

type BackendLesson = {
  id: string
  title: string
  body: string
  source_annotation_ids: string[]
}

type BackendFeedbackRound = {
  handoff_id: string
  document_name: string
  reviewer_name: string | null
  status: string
  date: string
  annotations: {
    id: string
    page_no: number
    anchor_quote: string
    suggested_text: string | null
    note: string | null
  }[]
  lessons: BackendLesson[]
}

function mapLesson(l: BackendLesson): BirdieLesson {
  return { id: l.id, title: l.title, body: l.body, sourceAnnotationIds: l.source_annotation_ids }
}

export async function listBirdieLessons(): Promise<FeedbackRound[]> {
  const rounds = await request<BackendFeedbackRound[]>('/birdie/lessons')
  return rounds.map((r) => ({
    handoffId: r.handoff_id,
    documentName: r.document_name,
    reviewerName: r.reviewer_name,
    status: r.status,
    date: r.date,
    annotations: r.annotations.map((a) => ({
      id: a.id,
      pageNo: a.page_no,
      anchorQuote: a.anchor_quote,
      suggestedText: a.suggested_text,
      note: a.note,
    })),
    lessons: r.lessons.map(mapLesson),
  }))
}

export async function distillBirdieLessons(handoffId: string): Promise<BirdieLesson[]> {
  const lessons = await request<BackendLesson[]>(`/birdie/lessons/${handoffId}/distill`, {
    method: 'POST',
  })
  return lessons.map(mapLesson)
}

// Demo mode (admin only; the backend returns 404 unless DEMO_MODE is on)

const PRESENTER_TOKEN_KEY = 'demoPresenterToken'
const PRESENTER_USER_KEY = 'demoPresenterUser'

export async function getAppConfig(): Promise<{ demoMode: boolean }> {
  const config = await request<{ demo_mode?: boolean }>('/config')
  return { demoMode: Boolean(config.demo_mode) }
}

export function isImpersonating(): boolean {
  return localStorage.getItem(PRESENTER_TOKEN_KEY) !== null
}

/** The real (admin) token: the stashed presenter token while impersonating, else the session's. */
function presenterAuthHeader(): Record<string, string> {
  const token = localStorage.getItem(PRESENTER_TOKEN_KEY) ?? localStorage.getItem('token') ?? ''
  return { Authorization: `Bearer ${token}` }
}

export async function listDemoUsers(): Promise<DemoUser[]> {
  const users = await request<BackendFirmUser[]>('/demo/users', { headers: presenterAuthHeader() })
  return users.map((u) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    firmRole: u.firm_role,
  }))
}

export async function switchToDemoUser(userId: string): Promise<SessionUser> {
  const response = await request<{
    access_token: string
    user: BackendFirmUser
  }>('/demo/switch', {
    method: 'POST',
    headers: presenterAuthHeader(),
    body: JSON.stringify({ user_id: userId }),
  })
  if (!isImpersonating()) {
    localStorage.setItem(PRESENTER_TOKEN_KEY, localStorage.getItem('token') ?? '')
    localStorage.setItem(PRESENTER_USER_KEY, localStorage.getItem('user') ?? '')
  }
  const user: SessionUser = {
    id: response.user.id,
    email: response.user.email,
    fullName: response.user.full_name,
    firmRole: response.user.firm_role,
    isAdmin: response.user.is_admin,
  }
  localStorage.setItem('token', response.access_token)
  localStorage.setItem('user', JSON.stringify(user))
  return user
}

/** Put the presenter's own session back. Returns false when not impersonating. */
export function restorePresenterSession(): boolean {
  const token = localStorage.getItem(PRESENTER_TOKEN_KEY)
  if (token === null) return false
  localStorage.setItem('token', token)
  const savedUser = localStorage.getItem(PRESENTER_USER_KEY)
  if (savedUser) localStorage.setItem('user', savedUser)
  else localStorage.removeItem('user')
  localStorage.removeItem(PRESENTER_TOKEN_KEY)
  localStorage.removeItem(PRESENTER_USER_KEY)
  return true
}

export function clearPresenterSession() {
  localStorage.removeItem(PRESENTER_TOKEN_KEY)
  localStorage.removeItem(PRESENTER_USER_KEY)
}

export type DemoSeedSummary = Record<string, number | boolean>

export async function seedDemoData(): Promise<DemoSeedSummary> {
  return request<DemoSeedSummary>('/demo/seed', { method: 'POST', headers: presenterAuthHeader() })
}

export async function seedPropertyWorkboard(): Promise<{ ticketsCreated: number; matters: number; chatsCreated: number; documentsFailed: number; documentsProcessing: number }> {
  const result = await request<{ tickets_created: number; matters: number; chats_created: number; documents_failed?: number; documents_processing?: number }>('/demo/workboard/property', {
    method: 'POST', headers: presenterAuthHeader(),
  })
  return { ticketsCreated: result.tickets_created, matters: result.matters, chatsCreated: result.chats_created, documentsFailed: result.documents_failed ?? 0, documentsProcessing: result.documents_processing ?? 0 }
}

// DEMO_MODE only: mimic a role (including 'admin') on the signed-in account.
export async function setDemoRole(firmRole: FirmRole): Promise<void> {
  await request<unknown>('/demo/role', { method: 'PUT', body: JSON.stringify({ firm_role: firmRole }) })
}
