import { clearToken, getGoogleIdToken, getToken, setToken } from './auth'
import { API_URL } from './config'
import { splitSseBuffer } from './sse'
import type { WebContext } from './webContext'

export type ExtensionUser = { id: string; email: string; fullName: string | null }
export type BirdieTurn = { role: 'user' | 'assistant'; content: string }

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
  const response = await fetch(`${API_URL}/me`, { headers: await authHeaders() })
  await checkAuth(response)
  if (!response.ok) throw new Error(`Could not load your account (${response.status})`)
  return toUser((await response.json()) as ApiUser)
}

export async function streamBirdie(opts: {
  message: string
  history: BirdieTurn[]
  webContext: WebContext | null
  signal?: AbortSignal
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
    body: JSON.stringify({ message: opts.message, history: opts.history.slice(-40), web_context: webContext }),
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
      if (event === 'token') opts.onToken(data.content)
      else if (event === 'done') return data.content
      else if (event === 'error') throw new Error(data.detail)
    }
  }
  throw new Error('Birdie stopped responding')
}
