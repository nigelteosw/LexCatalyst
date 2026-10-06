import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchLlmSettings,
  type LlmSettings,
  type ModelChoice,
  type BirdieTurn,
  type CaseLink,
  type SearchStep,
  type ExtensionUser,
  fetchMe,
  type PrecedentResult,
  signIn,
  streamBirdie,
  UnauthorizedError,
} from '../lib/api'
import { clearToken, getToken } from '../lib/auth'
import { APP_URL } from '../lib/config'
import { clearTurns, loadTurns, saveTurns, TURNS_KEY } from '../lib/conversation'
import { buildWebContext } from '../lib/webContext'
import { BirdieMark } from './BirdieMark'
import { CasesList } from './CasesList'
import { ContextChips } from './ContextChips'
import { MarkdownContent } from './MarkdownContent'
import { loadSavedChoice, ModelPicker, saveChoice } from './ModelPicker'
import { PrecedentTab } from './PrecedentTab'
import { ReviewTab } from './ReviewTab'
import { SearchSteps } from './SearchSteps'
import { useBrowserContext } from './useBrowserContext'

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: ExtensionUser }
type View = 'chat' | 'precedent' | 'review'

const CASE_SEARCH_PROMPT = 'Find Singapore judgments on eLitigation relevant to the highlighted text.'

// host 'floating' is the on-page popup: same panel, pinned to the tab it floats in.
export function BirdieSidePanel({ tabId }: { tabId?: number } = {}) {
  const floating = tabId !== undefined
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [view, setView] = useState<View>('chat')
  const [turns, setTurns] = useState<BirdieTurn[]>([])
  const [turnsLoaded, setTurnsLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [streamingCases, setStreamingCases] = useState<CaseLink[]>([])
  const [streamingSearches, setStreamingSearches] = useState<SearchStep[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [llm, setLlm] = useState<LlmSettings | null>(null)
  const [override, setOverride] = useState<ModelChoice | null>(loadSavedChoice)
  const choice: ModelChoice = override ?? { tier: llm?.featureTiers.birdie ?? 'mid' }
  const needsKey = llm !== null && !llm.hasKey
  const abortRef = useRef<AbortController | null>(null)
  const browser = useBrowserContext(tabId)
  const lastTurnsJson = useRef('[]')

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
      .then((loaded) => {
        lastTurnsJson.current = JSON.stringify(loaded)
        setTurns(loaded)
      })
      .finally(() => setTurnsLoaded(true))
  }, [])

  useEffect(() => {
    if (auth.status === 'signedIn') fetchLlmSettings().then(setLlm).catch(handleError)
  }, [auth.status, handleError])

  useEffect(() => {
    if (!turnsLoaded) return
    const json = JSON.stringify(turns)
    if (json === lastTurnsJson.current) return
    lastTurnsJson.current = json
    saveTurns(turns).catch(console.error)
  }, [turns, turnsLoaded])

  // The docked and floating panels share one thread: adopt the other surface's turns.
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !changes[TURNS_KEY] || busy) return
      const next = Array.isArray(changes[TURNS_KEY].newValue) ? (changes[TURNS_KEY].newValue as BirdieTurn[]) : []
      const json = JSON.stringify(next)
      if (json === lastTurnsJson.current) return
      lastTurnsJson.current = json
      setTurns(next)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [busy])

  const { clearAll } = browser
  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setTurns([])
    setStreaming('')
    setStreamingCases([])
    setStreamingSearches([])
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
    if (needsKey) {
      setError('Add your OpenRouter key in Settings')
      return
    }
    const history = turns
    const webContext = browser.selection ?? browser.page
    let cases: CaseLink[] = []
    let searches: SearchStep[] = []
    setTurns([...history, { role: 'user', content: message }])
    setDraft('')
    browser.clearSelection()
    setStreaming('')
    setStreamingCases([])
    setStreamingSearches([])
    setError(null)
    setBusy(true)
    abortRef.current = new AbortController()
    try {
      const answer = await streamBirdie({
        message,
        history,
        webContext,
        model: choice,
        signal: abortRef.current.signal,
        onSources: (found) => {
          cases = found
          setStreamingCases(found)
        },
        onSearchStep: (step) => {
          // A result updates its call in place; it carries no query of its own.
          const known = searches.find((s) => s.id === step.id)
          searches = known
            ? searches.map((s) => (s.id === step.id ? { ...s, status: step.status, summary: step.summary } : s))
            : [...searches, step]
          setStreamingSearches(searches)
        },
        onToken: (token) => setStreaming((prev) => prev + token),
      })
      setTurns((prev) => [...prev, { role: 'assistant', content: answer, cases, searches }])
    } catch (err) {
      handleError(err)
    } finally {
      setStreaming('')
      setStreamingCases([])
      setStreamingSearches([])
      setBusy(false)
    }
  }

  function useInChat(result: PrecedentResult) {
    const ctx = buildWebContext({
      url: result.documentId ? `${APP_URL}/documents/${result.documentId}` : APP_URL,
      title: `Related document: ${result.documentTitle}`,
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
    `flex-1 border-b-2 py-1.5 text-xs font-medium transition-colors ${
      active ? 'border-[#2d9e6b] text-[#0f0f0f]' : 'border-transparent text-[#76766f] hover:text-[#5a5a56]'
    }`

  return (
    <main className="flex h-screen flex-col bg-white">
      <header className="border-b border-black/10">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          {/* The floating shell already carries the avatar and title in its drag bar. */}
          {floating ? (
            <span />
          ) : (
            <span className="flex items-center gap-2.5">
              <BirdieMark />
              <span className="text-xs font-semibold text-[#0f0f0f]">Birdie</span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-[#1a6b4a]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2d9e6b]" />
                Live
              </span>
            </span>
          )}
          <span className="flex items-center gap-2 text-xs text-[#76766f]">
            <button className="underline" title="New chat (⌘K)" onClick={newChat}>
              New chat
            </button>
            <button className="underline" onClick={handleSignOut}>
              Sign out
            </button>
          </span>
        </div>
        <nav className="flex">
          <button className={tabClass(view === 'chat')} onClick={() => setView('chat')}>
            Chat
          </button>
          <button className={tabClass(view === 'precedent')} onClick={() => setView('precedent')}>
            Related documents
          </button>
          <button className={tabClass(view === 'review')} onClick={() => setView('review')}>
            Review
          </button>
        </nav>
      </header>

      {view === 'precedent' && (
        <PrecedentTab selectionText={browser.selection?.text ?? null} onUseInChat={useInChat} onError={handleError} />
      )}

      {view === 'review' && (
        <ReviewTab browser={browser} model={choice} needsKey={needsKey} onError={handleError} />
      )}

      {view === 'chat' && (
        <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
          {turns.length === 0 && !streaming && (
            <p className="text-stone-500">
              Ask Birdie anything. Turn Birdie on for this site and highlight text to ask about it, or open Related documents
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
                <SearchSteps steps={turn.searches ?? []} />
                <MarkdownContent markdown={turn.content} />
                <CasesList cases={turn.cases ?? []} />
              </div>
            ),
          )}
          {(streaming || streamingCases.length > 0 || streamingSearches.length > 0) && (
            <div className="mr-4 rounded-md bg-white px-3 py-2 shadow-sm">
              <SearchSteps steps={streamingSearches} />
              <MarkdownContent markdown={streaming || '…'} />
              <CasesList cases={streamingCases} />
            </div>
          )}
          {error && <p className="text-red-600">{error}</p>}
        </section>
      )}

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
          <button className="rounded-md bg-stone-900 px-3 text-sm text-white disabled:opacity-50" disabled={busy || needsKey}>
            Send
          </button>
        </form>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-stone-500">
            {needsKey
              ? 'Add your OpenRouter key in the LexCatalyst web app (Settings → Models) to use Birdie.'
              : `Text you share and your Workboard ticket data are sent to OpenRouter and the model provider you choose${llm?.keySource === 'demo' ? ' (demo key in use)' : ''}.`}{' '}
            Case searches send only a short phrase to eLitigation.
          </p>
          {llm && (
            <ModelPicker
              choice={choice}
              settings={llm}
              onChange={(next) => {
                setOverride(next)
                saveChoice(next)
              }}
            />
          )}
        </div>
      </footer>
    </main>
  )
}
