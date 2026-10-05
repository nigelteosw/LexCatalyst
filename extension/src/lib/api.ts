import { clearToken, getGoogleIdToken, getToken, setToken } from './auth'
import { API_URL } from './config'
import { splitSseBuffer } from './sse'
import type { WebContext } from './webContext'

export type ExtensionUser = { id: string; email: string; fullName: string | null }
export type CaseLink = { citation: string; title: string; decisionDate: string | null; url: string }
export type BirdieTurn = { role: 'user' | 'assistant'; content: string; cases?: CaseLink[] }

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
  message: string
  history: BirdieTurn[]
  webContext: WebContext | null
  signal?: AbortSignal
  onSources?: (cases: CaseLink[]) => void
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
    body: JSON.stringify({ message: opts.message, history: opts.history.slice(-40).map(({ role, content }) => ({ role, content })), web_context: webContext }),
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

export type BirdieSettings = {
  hasOpenRouterKey: boolean
  keyLast4: string | null
  openRouterModel: string | null
  effectiveModel: string | null
}
export type OpenRouterModel = {
  id: string
  name: string
  contextLength: number | null
  promptPricePerMillion: number | null
}

type ApiBirdieSettings = {
  has_openrouter_key: boolean
  key_last4: string | null
  openrouter_model: string | null
  effective_model: string | null
}
type ApiOpenRouterModel = {
  id: string
  name: string
  context_length: number | null
  prompt_price_per_million: number | null
}

export function toBirdieSettings(raw: ApiBirdieSettings): BirdieSettings {
  return {
    hasOpenRouterKey: raw.has_openrouter_key,
    keyLast4: raw.key_last4 ?? null,
    openRouterModel: raw.openrouter_model ?? null,
    effectiveModel: raw.effective_model ?? null,
  }
}

export function toOpenRouterModel(raw: ApiOpenRouterModel): OpenRouterModel {
  return {
    id: raw.id,
    name: raw.name,
    contextLength: raw.context_length ?? null,
    promptPricePerMillion: raw.prompt_price_per_million ?? null,
  }
}

export async function getBirdieSettings(): Promise<BirdieSettings> {
  return toBirdieSettings(await apiJson<ApiBirdieSettings>('/settings/birdie'))
}

export async function saveBirdieSettings(update: { apiKey?: string; model?: string | null }): Promise<BirdieSettings> {
  const body: Record<string, string | null> = {}
  if (update.apiKey) body.openrouter_api_key = update.apiKey
  if (update.model !== undefined) body.openrouter_model = update.model
  return toBirdieSettings(
    await apiJson<ApiBirdieSettings>('/settings/birdie', { method: 'PUT', body: JSON.stringify(body) }),
  )
}

export async function removeOpenRouterKey(): Promise<BirdieSettings> {
  return toBirdieSettings(await apiJson<ApiBirdieSettings>('/settings/birdie/openrouter-key', { method: 'DELETE' }))
}

export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
  return (await apiJson<ApiOpenRouterModel[]>('/settings/birdie/models')).map(toOpenRouterModel)
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
