import { clearToken, getGoogleIdToken, getToken, setToken } from './auth'
import { API_URL } from './config'
import { splitSseBuffer } from './sse'
import type { WebContext } from './webContext'

export type ExtensionUser = { id: string; email: string; fullName: string | null }
export type CaseLink = { citation: string; title: string; decisionDate: string | null; url: string }
export type BirdieTurn = { role: 'user' | 'assistant'; content: string; cases?: CaseLink[] }

export type LlmTier = 'high' | 'mid'
export type ModelChoice = { tier: LlmTier; model?: undefined } | { model: string; tier?: undefined }

export class UnauthorizedError extends Error {}

type ApiUser = { id: string; email: string; full_name: string | null }

function toUser(user: ApiUser): ExtensionUser {
  return { id: user.id, email: user.email, fullName: user.full_name }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  if (!token) throw new UnauthorizedError('Not signed in')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function checkAuth(response: Response): Promise<void> {
  if (response.status === 401) {
    await clearToken()
    throw new UnauthorizedError('Your session expired. Sign in again.')
  }
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: await authHeaders() })
  await checkAuth(response)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : `Request failed (${response.status})`)
  }
  return payload as T
}

export async function signIn(): Promise<ExtensionUser> {
  const credential = await getGoogleIdToken()
  const response = await fetch(`${API_URL}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'Sign-in failed')
  await setToken(payload.access_token as string)
  return toUser(payload.user as ApiUser)
}

export async function fetchMe(): Promise<ExtensionUser> {
  return toUser(await apiJson<ApiUser>('/me'))
}

export async function streamBirdie(opts: {
  model?: ModelChoice
  message: string
  history: BirdieTurn[]
  webContext: WebContext | null
  signal?: AbortSignal
  onSources?: (cases: CaseLink[]) => void
  onWorkboardChange?: () => void
  onToken: (token: string) => void
}): Promise<string> {
  const webContext = opts.webContext && {
    url: opts.webContext.url,
    title: opts.webContext.title,
    text: opts.webContext.text,
    source: opts.webContext.source,
  }
  const response = await fetch(`${API_URL}/birdie/stream`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ message: opts.message, history: opts.history.slice(-40).map(({ role, content }) => ({ role, content })), web_context: webContext, ...opts.model }),
    signal: opts.signal,
  })
  await checkAuth(response)
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : response.statusText)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = splitSseBuffer(buffer)
    buffer = rest
    for (const { event, data } of events) {
      if (event === 'sources') opts.onSources?.(toCaseLinks(data.cases))
      else if (event === 'workboard_changed') opts.onWorkboardChange?.()
      else if (event === 'token') opts.onToken(String(data.content ?? ''))
      else if (event === 'done') return String(data.content ?? '')
      else if (event === 'error') throw new Error(String(data.detail ?? 'Birdie failed'))
    }
  }
  throw new Error('Birdie stopped responding')
}

const ELITIGATION_PREFIX = 'https://www.elitigation.sg/gd/s/'

export function toCaseLinks(raw: unknown): CaseLink[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const c = item as Record<string, unknown>
    if (typeof c.citation !== 'string' || typeof c.title !== 'string' || typeof c.url !== 'string') return []
    if (!c.url.startsWith(ELITIGATION_PREFIX)) return []
    const decisionDate = typeof c.decision_date === 'string' ? c.decision_date : null
    return [{ citation: c.citation, title: c.title, decisionDate, url: c.url }]
  })
}

export type LlmSettings = {
  hasKey: boolean
  keySource: 'user' | 'demo' | null
  models: { high: string; mid: string }
  featureTiers: Record<string, LlmTier>
}
export type OpenrouterModel = { id: string; name: string; promptPricePerMillion: number | null }

export async function fetchLlmSettings(): Promise<LlmSettings> {
  const s = await apiJson<{
    has_key: boolean
    key_source: 'user' | 'demo' | null
    models: { high: string; mid: string }
    feature_tiers: Record<string, LlmTier>
  }>('/settings/llm')
  return { hasKey: s.has_key, keySource: s.key_source, models: s.models, featureTiers: s.feature_tiers }
}

export async function fetchOpenrouterModels(): Promise<OpenrouterModel[]> {
  const models = await apiJson<{ id: string; name: string; prompt_price_per_million: number | null }[]>(
    '/settings/llm/models',
  )
  return models.map((m) => ({ id: m.id, name: m.name, promptPricePerMillion: m.prompt_price_per_million }))
}

export type PrecedentResult = {
  id: string
  sourceType: 'document' | 'knowledge_bank'
  excerpt: string
  documentTitle: string
  matterRef: string | null
  date: string | null
  author: string | null
  status: string | null
  documentId: string | null
  termLabel: string | null
}
export type PrecedentResponse = {
  clauseType: string
  termsSummary: { label: string; count: number }[]
  results: PrecedentResult[]
}

type ApiPrecedentResult = {
  id: string
  source_type: 'document' | 'knowledge_bank'
  excerpt: string
  document_title: string
  matter_ref: string | null
  date: string | null
  author: string | null
  status: string | null
  document_id: string | null
  term: { kind: string; value: string; label: string } | null
}
type ApiPrecedentResponse = {
  clause_type: string
  terms_summary: { label: string; count: number }[]
  results: ApiPrecedentResult[]
}

export function toPrecedentResponse(raw: ApiPrecedentResponse): PrecedentResponse {
  return {
    clauseType: raw.clause_type,
    termsSummary: raw.terms_summary,
    results: raw.results.map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      excerpt: r.excerpt,
      documentTitle: r.document_title,
      matterRef: r.matter_ref,
      date: r.date,
      author: r.author,
      status: r.status,
      documentId: r.document_id,
      termLabel: r.term?.label ?? null,
    })),
  }
}

export async function searchPrecedent(text: string, url?: string): Promise<PrecedentResponse> {
  const raw = await apiJson<ApiPrecedentResponse>('/precedent/search', {
    method: 'POST',
    body: JSON.stringify({ text: text.slice(0, 5000), url: url ?? null }),
  })
  return toPrecedentResponse(raw)
}

export type SuggestionType = 'replace' | 'insert' | 'comment'
export type SuggestionCategory = 'style' | 'substance' | 'question'
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'
export type SuggestionSource = {
  kind: 'kb' | 'document' | 'style_guide' | 'elitigation'
  title: string
  id: string | null
  path: string | null
  url: string | null
  status: string | null
  side: string | null
  date: string | null
  matterRef: string | null
}
export type SuggestionReply = { id: string; body: string; createdAt: string; authorUserId: string | null }
export type Suggestion = {
  id: string
  clauseRef: string | null
  anchorText: string
  anchorStart: number
  anchorEnd: number
  type: SuggestionType
  suggestedText: string | null
  reason: string
  category: SuggestionCategory
  source: SuggestionSource | null
  status: SuggestionStatus
  decidedAt: string | null
  replies: SuggestionReply[]
}
export type BirdieReview = {
  id: string
  sourceUrl: string
  title: string | null
  status: 'processing' | 'ready' | 'failed'
  error: string | null
  model: string | null
  sourceText: string
  currentText: string
  createdAt: string
  suggestions: Suggestion[]
}

type ApiSuggestionSource = Partial<{
  kind: SuggestionSource['kind']
  title: string
  id: string
  path: string
  url: string
  status: string
  side: string
  date: string
  matter_ref: string
}>
type ApiSuggestionReply = { id: string; body: string; created_at: string; author_user_id: string | null }
type ApiSuggestion = {
  id: string
  clause_ref: string | null
  anchor_text: string
  anchor_start: number
  anchor_end: number
  type: SuggestionType
  suggested_text: string | null
  reason: string
  category: SuggestionCategory
  source: ApiSuggestionSource | null
  status: SuggestionStatus
  decided_at: string | null
  replies?: ApiSuggestionReply[]
}
export type ApiBirdieReview = {
  id: string
  source_url: string
  title: string | null
  status: BirdieReview['status']
  error: string | null
  model: string | null
  source_text: string
  current_text: string
  created_at: string
  suggestions?: ApiSuggestion[]
}

function toReply(raw: ApiSuggestionReply): SuggestionReply {
  return { id: raw.id, body: raw.body, createdAt: raw.created_at, authorUserId: raw.author_user_id ?? null }
}

export function toBirdieReview(raw: ApiBirdieReview): BirdieReview {
  return {
    id: raw.id,
    sourceUrl: raw.source_url,
    title: raw.title ?? null,
    status: raw.status,
    error: raw.error ?? null,
    model: raw.model ?? null,
    sourceText: raw.source_text,
    currentText: raw.current_text,
    createdAt: raw.created_at,
    suggestions: (raw.suggestions ?? []).map((s) => ({
      id: s.id,
      clauseRef: s.clause_ref ?? null,
      anchorText: s.anchor_text,
      anchorStart: s.anchor_start,
      anchorEnd: s.anchor_end,
      type: s.type,
      suggestedText: s.suggested_text ?? null,
      reason: s.reason,
      category: s.category,
      source: s.source
        ? {
            kind: s.source.kind ?? 'kb',
            title: s.source.title ?? '',
            id: s.source.id ?? null,
            path: s.source.path ?? null,
            url: s.source.url ?? null,
            status: s.source.status ?? null,
            side: s.source.side ?? null,
            date: s.source.date ?? null,
            matterRef: s.source.matter_ref ?? null,
          }
        : null,
      status: s.status,
      decidedAt: s.decided_at ?? null,
      replies: (s.replies ?? []).map(toReply),
    })),
  }
}

export const MAX_REVIEW_CHARS = 60_000

export async function startBirdieReview(opts: {
  url: string
  title: string
  text: string
  model?: ModelChoice
}): Promise<BirdieReview> {
  const raw = await apiJson<ApiBirdieReview>('/birdie/reviews', {
    method: 'POST',
    body: JSON.stringify({
      url: opts.url,
      title: opts.title || null,
      text: opts.text.slice(0, MAX_REVIEW_CHARS),
      ...opts.model,
    }),
  })
  return toBirdieReview(raw)
}

export async function fetchLatestReview(url: string): Promise<BirdieReview | null> {
  const raw = await apiJson<ApiBirdieReview | null>(`/birdie/reviews?url=${encodeURIComponent(url)}`)
  return raw ? toBirdieReview(raw) : null
}

export async function fetchBirdieReview(id: string): Promise<BirdieReview> {
  return toBirdieReview(await apiJson<ApiBirdieReview>(`/birdie/reviews/${id}`))
}

export async function decideSuggestion(id: string, status: SuggestionStatus): Promise<BirdieReview> {
  return toBirdieReview(
    await apiJson<ApiBirdieReview>(`/birdie/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  )
}

export async function acceptStyleFixes(reviewId: string): Promise<BirdieReview> {
  return toBirdieReview(await apiJson<ApiBirdieReview>(`/birdie/reviews/${reviewId}/accept-style`, { method: 'POST' }))
}

export async function replyToSuggestion(id: string, body: string): Promise<SuggestionReply> {
  return toReply(
    await apiJson<ApiSuggestionReply>(`/birdie/suggestions/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  )
}
