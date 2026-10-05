import { useEffect, useRef, useState } from 'react'
import { type BirdieTurn, type ExtensionUser, fetchMe, signIn, streamBirdie, UnauthorizedError } from '../lib/api'
import { clearToken, getToken } from '../lib/auth'
import { readActiveTabText } from '../lib/pageText'
import { buildWebContext, PENDING_CONTEXT_KEY, type WebContext } from '../lib/webContext'
import { MarkdownContent } from './MarkdownContent'

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: ExtensionUser }

export function BirdieSidePanel() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [turns, setTurns] = useState<BirdieTurn[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<WebContext | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function handleError(err: unknown) {
    if (err instanceof UnauthorizedError) setAuth({ status: 'signedOut' })
    if (err instanceof Error && err.name === 'AbortError') return
    setError(err instanceof Error ? err.message : String(err))
  }

  useEffect(() => {
    getToken()
      .then((token) => (token ? fetchMe() : null))
      .then((user) => setAuth(user ? { status: 'signedIn', user } : { status: 'signedOut' }))
      .catch((err) => {
        setAuth({ status: 'signedOut' })
        if (!(err instanceof UnauthorizedError)) setError(String(err))
      })
  }, [])

  useEffect(() => {
    const take = (value: unknown) => {
      if (!value) return
      setContext(value as WebContext)
      chrome.storage.session.remove(PENDING_CONTEXT_KEY).catch(console.error)
    }
    chrome.storage.session.get(PENDING_CONTEXT_KEY).then((stored) => take(stored[PENDING_CONTEXT_KEY]))
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[PENDING_CONTEXT_KEY]) take(changes[PENDING_CONTEXT_KEY].newValue)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  async function handleSignIn() {
    setError(null)
    try {
      setAuth({ status: 'signedIn', user: await signIn() })
    } catch (err) {
      handleError(err)
    }
  }

  async function handleSignOut() {
    abortRef.current?.abort()
    await clearToken()
    setTurns([])
    setAuth({ status: 'signedOut' })
  }

  async function handleReadPage() {
    setError(null)
    try {
      const page = await readActiveTabText()
      const ctx = buildWebContext({ ...page, source: 'page' })
      if (!ctx) throw new Error('This page has no readable text')
      setContext(ctx)
    } catch (err) {
      handleError(err)
    }
  }

  async function handleSend() {
    const message = draft.trim()
    if (!message || busy) return
    const history = turns
    const sentContext = context
    setTurns([...history, { role: 'user', content: message }])
    setDraft('')
    setContext(null)
    setStreaming('')
    setError(null)
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      const answer = await streamBirdie({
        message,
        history,
        webContext: sentContext,
        signal: abortRef.current.signal,
        onToken: (token) => setStreaming((prev) => prev + token),
      })
      setTurns((prev) => [...prev, { role: 'assistant', content: answer }])
    } catch (err) {
      handleError(err)
    } finally {
      setStreaming('')
      setBusy(false)
    }
  }

  if (auth.status === 'loading') return <p className="p-4 text-sm text-stone-500">Loading…</p>

  if (auth.status === 'signedOut') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Birdie</h1>
        <p className="text-sm text-stone-600">Sign in with your LexCatalyst Google account.</p>
        <button className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white" onClick={handleSignIn}>
          Sign in with Google
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    )
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
        <span className="text-sm font-semibold">Birdie</span>
        <span className="flex items-center gap-2 text-xs text-stone-500">
          {auth.user.fullName ?? auth.user.email}
          <button className="underline" onClick={handleSignOut}>
            Sign out
          </button>
        </span>
      </header>

      <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {turns.length === 0 && !streaming && (
          <p className="text-stone-500">
            Ask Birdie anything. Highlight text and right-click “Ask Birdie about this”, or share this page.
          </p>
        )}
        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <p key={index} className="ml-8 rounded-md bg-stone-200 px-3 py-2">
              {turn.content}
            </p>
          ) : (
            <div key={index} className="mr-4 rounded-md bg-white px-3 py-2 shadow-sm">
              <MarkdownContent markdown={turn.content} />
            </div>
          ),
        )}
        {streaming && (
          <div className="mr-4 rounded-md bg-white px-3 py-2 shadow-sm">
            <MarkdownContent markdown={streaming} />
          </div>
        )}
        {error && <p className="text-red-600">{error}</p>}
      </section>

      <footer className="space-y-2 border-t border-stone-200 p-3">
        {context ? (
          <div className="flex items-start justify-between gap-2 rounded-md bg-amber-50 px-2 py-1 text-xs">
            <span className="line-clamp-2">
              {context.source === 'selection' ? 'Selection' : 'Page'} from {context.title || context.url}
              {context.truncated && ' (truncated)'}
            </span>
            <button aria-label="Remove shared text" onClick={() => setContext(null)}>
              ×
            </button>
          </div>
        ) : (
          <button className="text-xs underline" onClick={handleReadPage}>
            Ask about this page
          </button>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSend()
          }}
        >
          <textarea
            className="flex-1 resize-none rounded-md border border-stone-300 p-2 text-sm"
            rows={2}
            value={draft}
            placeholder="Ask Birdie…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
          />
          <button className="rounded-md bg-stone-900 px-3 text-sm text-white disabled:opacity-50" disabled={busy}>
            Send
          </button>
        </form>
        <p className="text-[11px] text-stone-500">
          Text you share is sent to DeepSeek, or OpenRouter if you saved your own key in Settings.
        </p>
      </footer>
    </main>
  )
}
