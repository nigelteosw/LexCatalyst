import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type BirdieSettings,
  type BirdieTurn,
  type CaseLink,
  type ExtensionUser,
  fetchMe,
  getBirdieSettings,
  type PrecedentResult,
  signIn,
  streamBirdie,
  UnauthorizedError,
} from '../lib/api'
import { clearToken, getToken } from '../lib/auth'
import { APP_URL } from '../lib/config'
import { clearTurns, loadTurns, saveTurns } from '../lib/conversation'
import { modelLabel, providerDisclosure } from '../lib/models'
import { buildWebContext } from '../lib/webContext'
import { CasesList } from './CasesList'
import { ContextChips } from './ContextChips'
import { MarkdownContent } from './MarkdownContent'
import { ModelView } from './ModelView'
import { PrecedentTab } from './PrecedentTab'
import { useBrowserContext } from './useBrowserContext'

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: ExtensionUser }
type View = 'chat' | 'precedent' | 'model'

const CASE_SEARCH_PROMPT = 'Find Singapore judgments on eLitigation relevant to the highlighted text.'

export function BirdieSidePanel() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [view, setView] = useState<View>('chat')
  const [turns, setTurns] = useState<BirdieTurn[]>([])
  const [turnsLoaded, setTurnsLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [streamingCases, setStreamingCases] = useState<CaseLink[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<BirdieSettings | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const browser = useBrowserContext()

  const handleError = useCallback((err: unknown) => {
    if (err instanceof UnauthorizedError) setAuth({ status: 'signedOut' })
    if (err instanceof Error && err.name === 'AbortError') return
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  useEffect(() => {
    getToken()
      .then((token) => (token ? fetchMe() : null))
      .then((user) => setAuth(user ? { status: 'signedIn', user } : { status: 'signedOut' }))
      .catch((err) => {
        setAuth({ status: 'signedOut' })
        if (!(err instanceof UnauthorizedError)) setError(String(err))
      })
    loadTurns()
      .then(setTurns)
      .finally(() => setTurnsLoaded(true))
  }, [])

  useEffect(() => {
    if (auth.status === 'signedIn') getBirdieSettings().then(setSettings).catch(handleError)
  }, [auth.status, handleError])

  useEffect(() => {
    if (turnsLoaded) saveTurns(turns).catch(console.error)
  }, [turns, turnsLoaded])

  const { clearAll } = browser
  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setTurns([])
    setStreaming('')
    setStreamingCases([])
    setDraft('')
    setError(null)
    clearAll()
    setView('chat')
    clearTurns().catch(console.error)
  }, [clearAll])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  async function handleSignIn() {
    setError(null)
    try {
      setAuth({ status: 'signedIn', user: await signIn() })
    } catch (err) {
      handleError(err)
    }
  }

  async function handleSignOut() {
    newChat()
    await clearToken()
    setAuth({ status: 'signedOut' })
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    const history = turns
    const webContext = browser.selection ?? browser.page
    let cases: CaseLink[] = []
    setTurns([...history, { role: 'user', content: message }])
    setDraft('')
    browser.clearSelection()
    setStreaming('')
    setStreamingCases([])
    setError(null)
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      const answer = await streamBirdie({
        message,
        history,
        webContext,
        signal: abortRef.current.signal,
        onSources: (found) => {
          cases = found
          setStreamingCases(found)
        },
        onToken: (token) => setStreaming((prev) => prev + token),
      })
      setTurns((prev) => [...prev, { role: 'assistant', content: answer, cases }])
    } catch (err) {
      handleError(err)
    } finally {
      setStreaming('')
      setStreamingCases([])
      setBusy(false)
    }
  }

  function useInChat(result: PrecedentResult) {
    const ctx = buildWebContext({
      url: result.documentId ? `${APP_URL}/documents/${result.documentId}` : APP_URL,
      title: `Precedent: ${result.documentTitle}`,
      text: result.excerpt,
      source: 'selection',
    })
    if (ctx) browser.share(ctx)
    setView('chat')
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

  const tabClass = (active: boolean) =>
    `px-2 py-1 text-xs ${active ? 'border-b-2 border-stone-900 font-semibold' : 'text-stone-500'}`

  return (
    <main className="flex h-screen flex-col">
      <header className="space-y-1 border-b border-stone-200 px-3 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Birdie</span>
          <span className="flex items-center gap-2 text-xs text-stone-500">
            <button className="underline" title="New chat (⌘K)" onClick={newChat}>
              New chat
            </button>
            <button className="max-w-32 truncate underline" title="Choose model" onClick={() => setView('model')}>
              {modelLabel(settings)}
            </button>
            <button className="underline" onClick={handleSignOut}>
              Sign out
            </button>
          </span>
        </div>
        <nav className="flex gap-2">
          <button className={tabClass(view === 'chat')} onClick={() => setView('chat')}>
            Chat
          </button>
          <button className={tabClass(view === 'precedent')} onClick={() => setView('precedent')}>
            Precedent
          </button>
        </nav>
      </header>

      {view === 'model' && <ModelView settings={settings} onChange={setSettings} onClose={() => setView('chat')} />}

      {view === 'precedent' && (
        <PrecedentTab selectionText={browser.selection?.text ?? null} onUseInChat={useInChat} onError={handleError} />
      )}

      {view === 'chat' && (
        <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
          {turns.length === 0 && !streaming && (
            <p className="text-stone-500">
              Ask Birdie anything. Turn Birdie on for this site and highlight text to ask about it, or open Precedent
              to see how the firm drafted a clause before.
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
                <CasesList cases={turn.cases ?? []} />
              </div>
            ),
          )}
          {(streaming || streamingCases.length > 0) && (
            <div className="mr-4 rounded-md bg-white px-3 py-2 shadow-sm">
              <MarkdownContent markdown={streaming || '…'} />
              <CasesList cases={streamingCases} />
            </div>
          )}
          {error && <p className="text-red-600">{error}</p>}
        </section>
      )}

      {view !== 'model' && (
        <footer className="space-y-2 border-t border-stone-200 p-3">
          <ContextChips context={browser} onSearchCases={() => void send(CASE_SEARCH_PROMPT)} />
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setView('chat')
              void send(draft)
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
                  setView('chat')
                  void send(draft)
                }
              }}
            />
            <button className="rounded-md bg-stone-900 px-3 text-sm text-white disabled:opacity-50" disabled={busy}>
              Send
            </button>
          </form>
          <p className="text-[11px] text-stone-500">
            {providerDisclosure(settings)} Case searches send only a short phrase to eLitigation.
          </p>
        </footer>
      )}
    </main>
  )
}
