import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Gauge, Menu, Sparkles } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatPanel } from '../features/chat/ChatPanel'
import { Button } from '../shared/ui/Button'
import { PanelErrorBoundary } from '../shared/ui/PanelErrorBoundary'
import { Sidebar } from '../features/navigation/Sidebar'
import { LoginPage } from '../features/auth/LoginPage'
import {
  deleteChatMessage,
  getCurrentUser,
  listChatThreads,
  listMatters,
  listThreadMessages,
  streamChatMessage,
  subscribeToUnauthorized,
  loginWithGoogle,
  uploadDocument,
} from '../shared/api/api'
import type {
  BirdiePageContext,
  ChatModel,
  ChatThread,
  CurrentUser,
  Message,
  SessionUser,
} from '../shared/types/workspace'
import { useWorkspaceNavigation } from './routes'
import { getErrorMessage, isAbortError } from '../shared/lib/errors'
import lexChatLogo from '../assets/LexCatalyst.png'

const MemoriesPanel = lazy(() =>
  import('../features/memories/MemoriesPanel').then((module) => ({ default: module.MemoriesPanel })),
)
const DocumentsPanel = lazy(() =>
  import('../features/documents/DocumentsPanel').then((module) => ({ default: module.DocumentsPanel })),
)
const WikiPanel = lazy(() =>
  import('../features/wiki/WikiPanel').then((module) => ({ default: module.WikiPanel })),
)
const WellbeingPanel = lazy(() =>
  import('../features/wellbeing/WellbeingPanel').then((module) => ({ default: module.WellbeingPanel })),
)
const KnowledgeBankPanel = lazy(() =>
  import('../features/knowledge-bank/KnowledgeBankPanel').then((module) => ({
    default: module.KnowledgeBankPanel,
  })),
)
const ActionsPanel = lazy(() =>
  import('../features/actions/ActionsPanel').then((module) => ({ default: module.ActionsPanel })),
)
const BirdiePanel = lazy(() =>
  import('../features/birdie/BirdiePanel').then((module) => ({ default: module.BirdiePanel })),
)
const SettingsPanel = lazy(() =>
  import('../features/settings/SettingsPanel').then((module) => ({ default: module.SettingsPanel })),
)
const HomePanel = lazy(() =>
  import('../features/home/HomePanel').then((module) => ({ default: module.HomePanel })),
)

type ActiveStream = {
  threadId: string | null
  messages: Message[]
}

const CHAT_MODELS: Array<{
  id: ChatModel
  label: string
  description: string
}> = [
  {
    id: 'deepseek-v4-flash',
    label: 'Flash',
    description: 'Faster, lower-cost responses',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'Pro',
    description: 'Deeper legal reasoning',
  },
]

function getSavedChatModel(): ChatModel {
  const saved = localStorage.getItem('chatModel')
  return saved === 'deepseek-v4-flash' || saved === 'deepseek-v4-pro'
    ? saved
    : 'deepseek-v4-pro'
}

function getSavedUser(): SessionUser | null {
  try {
    const saved = localStorage.getItem('user')
    if (!saved) return null
    const user = JSON.parse(saved) as Partial<SessionUser> & {
      full_name?: string | null
      firm_role?: SessionUser['firmRole']
      is_admin?: boolean
    }
    if (!user.id || !user.email) return null
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName ?? user.full_name ?? null,
      firmRole: user.firmRole ?? user.firm_role ?? 'associate',
      isAdmin: user.isAdmin ?? user.is_admin ?? false,
    }
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('token'))
  const [user, setUser] = useState<SessionUser | null>(getSavedUser)

  const currentUserQuery = useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  })
  const currentUser = currentUserQuery.data ?? null

  const queryClient = useQueryClient()
  const {
    current,
    isKnownRoute,
    selectThread,
    startNewChat,
  } = useWorkspaceNavigation()
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  }, [current])

  const threadId = current.view === 'chat' ? current.threadId : null

  // Server state — threads and messages via TanStack Query
  const threadsQuery = useQuery({
    queryKey: ['threads'],
    queryFn: listChatThreads,
    enabled: isAuthenticated,
  })
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const mattersQuery = useQuery({
    queryKey: ['matters'],
    queryFn: () => listMatters('active'),
    enabled: isAuthenticated,
  })
  const matters = useMemo(() => mattersQuery.data ?? [], [mattersQuery.data])

  const messagesQuery = useQuery({
    queryKey: ['messages', threadId],
    queryFn: () => listThreadMessages(threadId!),
    enabled: !!threadId && isAuthenticated,
  })
  const serverMessages = useMemo(
    () => messagesQuery.data ?? [],
    [messagesQuery.data],
  )
  const isFetchingMessages = messagesQuery.isFetching

  // Local UI state
  const [activeStream, setActiveStream] = useState<ActiveStream | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [isUploadingComposerFile, setIsUploadingComposerFile] = useState(false)
  const [composerAttachmentStatus, setComposerAttachmentStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isBirdieOpen, setIsBirdieOpen] = useState(() => window.innerWidth >= 1024)
  const [selectedModel, setSelectedModel] = useState<ChatModel>(getSavedChatModel)
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(
    () => localStorage.getItem('selectedMatterId'),
  )
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamAbortReasonRef = useRef<'stop' | 'navigation' | null>(null)
  const hasAutoSelectedRef = useRef(false)

  useEffect(() => {
    if (!isKnownRoute) startNewChat({ replace: true })
  }, [isKnownRoute, startNewChat])

  useEffect(() => subscribeToUnauthorized(() => {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsAuthenticated(false)
    setUser(null)
    setIsResponding(false)
    setActiveStream(null)
    queryClient.clear()
    startNewChat()
  }), [queryClient, startNewChat])

  useEffect(() => () => {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
  }, [])

  // Auto-select first thread on initial load
  useEffect(() => {
    if (!hasAutoSelectedRef.current && threads.length > 0) {
      hasAutoSelectedRef.current = true
      selectThread(threads[0].id, { replace: true })
    }
  }, [threads, selectThread])

  // Abort any active stream when the view changes (prevents snap-back and stale streams)
  useEffect(() => {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    // isResponding is reset in the stream's finally block once the abort propagates
  }, [current])

  const activeThread = useMemo(
    () => threads.find((t) => t.id === threadId) ?? null,
    [threadId, threads],
  )

  // isLoading blocks re-submission; isFetchingMessages prevents submitting before thread history loads
  const isLoading = isFetchingMessages || isResponding
  const workspaceError =
    currentUserQuery.error ??
    threadsQuery.error ??
    mattersQuery.error ??
    messagesQuery.error ??
    null
  const messages =
    activeStream &&
    current.view === 'chat' &&
    activeStream.threadId === current.threadId
      ? activeStream.messages
      : current.view === 'chat' && current.threadId
        ? serverMessages
        : []

  async function handleLoginSuccess(credential: string) {
    setError(null)
    try {
      const response = await loginWithGoogle(credential)
      localStorage.setItem('token', response.accessToken)
      localStorage.setItem('user', JSON.stringify(response.user))
      setUser(response.user)
      setIsAuthenticated(true)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  function handleLogout() {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setIsAuthenticated(false)
    setUser(null)
    queryClient.clear()
    startNewChat()
    setIsSidebarOpen(false)
    setIsResponding(false)
    hasAutoSelectedRef.current = false
  }

  function handleNewChat() {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setActiveStream(null)
    setIsResponding(false)
    setError(null)
    startNewChat()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isLoading) return

    // Prevent the auto-select effect from firing when onThread adds the new thread to the cache
    // mid-stream, which would abort the active stream.
    hasAutoSelectedRef.current = true

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      body: trimmedPrompt,
    }
    const assistantDraftId = crypto.randomUUID()
    const assistantDraft: Message = {
      id: assistantDraftId,
      role: 'assistant',
      body: '',
    }

    setActiveStream({
      threadId,
      messages: [...messages, userMessage, assistantDraft],
    })
    setPrompt('')
    setError(null)
    setIsResponding(true)
    const controller = new AbortController()
    streamAbortReasonRef.current = null
    streamAbortRef.current = controller

    try {
      await streamChatMessage({
        message: trimmedPrompt,
        model: selectedModel,
        matterId: selectedMatterId,
        signal: controller.signal,
        threadId,
        onThread: (tid, title) => {
          queryClient.setQueryData(['threads'], (old: ChatThread[] = []) => {
            if (old.some((t) => t.id === tid)) return old
            return [
              { id: tid, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
              ...old,
            ]
          })
        },
        onToolCall: (stepId, tool, args) => {
          setActiveStream((stream) => stream
            ? {
                ...stream,
                messages: stream.messages.map((message) =>
                  message.id === assistantDraftId
                    ? {
                        ...message,
                        steps: [
                          ...(message.steps ?? []),
                          { id: stepId, tool, args, summary: null, status: 'running' as const },
                        ],
                      }
                    : message,
                ),
              }
            : stream)
        },
        onToolResult: (stepId, tool, summary) => {
          setActiveStream((stream) => stream
            ? {
                ...stream,
                messages: stream.messages.map((message) => {
                  if (message.id !== assistantDraftId) return message
                  const steps = (message.steps ?? []).map((step) =>
                    (step.id === stepId || (!step.id && step.tool === tool && step.status === 'running'))
                      ? { ...step, summary, status: 'done' as const }
                      : step,
                  )
                  return { ...message, steps }
                }),
              }
            : stream)
        },
        onToken: (content) => {
          setActiveStream((stream) => stream
            ? {
                ...stream,
                messages: stream.messages.map((message) =>
                  message.id === assistantDraftId
                    ? { ...message, body: `${message.body}${content}` }
                    : message,
                ),
              }
            : stream)
        },
        onDone: (response) => {
          setActiveStream((stream) => stream
            ? {
                threadId: response.threadId,
                messages: stream.messages.map((message) =>
                  message.id === assistantDraftId
                    ? {
                        ...response.message,
                        steps: response.message.steps ?? message.steps,
                      }
                    : message,
                ),
              }
            : stream)
          // Pre-seed the cache so navigating to a newly-created thread never shows a blank screen
          if (!threadId) {
            queryClient.setQueryData(
              ['messages', response.threadId],
              [userMessage, response.message],
            )
          }
          queryClient.invalidateQueries({ queryKey: ['threads'] })
          queryClient.invalidateQueries({ queryKey: ['messages', response.threadId] })
          // Only navigate if the user hasn't moved to a different panel mid-stream
          if (currentRef.current.view === 'chat') {
            selectThread(response.threadId)
          }
        },
      })
    } catch (caughtError) {
      if (isAbortError(caughtError)) {
        if (streamAbortReasonRef.current === 'navigation') {
          setActiveStream(null)
        } else {
          setActiveStream((stream) => stream
            ? {
                ...stream,
                messages: stream.messages.filter(
                  (message) => message.id !== assistantDraftId || message.body.trim().length > 0,
                ),
              }
            : stream)
        }
        return
      }
      setActiveStream((stream) => stream
        ? {
            ...stream,
            messages: stream.messages.filter(
              (message) => message.id !== assistantDraftId || message.body.trim().length > 0,
            ),
          }
        : stream)
      setError(getErrorMessage(caughtError))
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
      streamAbortReasonRef.current = null
      setIsResponding(false)
    }
  }

  async function handleComposerFileUpload(file: File) {
    if (isUploadingComposerFile) return

    setIsUploadingComposerFile(true)
    setComposerAttachmentStatus(`Uploading ${file.name}...`)
    setError(null)

    try {
      const uploaded = await uploadDocument(file)
      const statusLabel =
        uploaded.status === 'ready'
          ? 'ready for search'
          : `${uploaded.status}; ingestion will continue in the background`
      setComposerAttachmentStatus(`${uploaded.filename} uploaded (${statusLabel})`)
    } catch (caughtError) {
      setComposerAttachmentStatus(null)
      setError(getErrorMessage(caughtError))
    } finally {
      setIsUploadingComposerFile(false)
    }
  }

  function handleStopResponse() {
    streamAbortReasonRef.current = 'stop'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsResponding(false)
  }

  async function handleDeleteMessage(messageId: string) {
    // Optimistic UI removal; restore on failure.
    const messageQueryKey = ['messages', threadId] as const
    const previousServerMessages =
      queryClient.getQueryData<Message[]>(messageQueryKey)
    const previousActiveStream = activeStream

    if (threadId) {
      queryClient.setQueryData<Message[]>(messageQueryKey, (current = []) =>
        current.filter((message) => message.id !== messageId),
      )
    }
    setActiveStream((stream) =>
      stream
        ? {
            ...stream,
            messages: stream.messages.filter((message) => message.id !== messageId),
          }
        : stream,
    )

    try {
      await deleteChatMessage(messageId)
      if (threadId) {
        queryClient.invalidateQueries({ queryKey: ['messages', threadId] })
      }
    } catch (caughtError) {
      if (threadId && previousServerMessages) {
        queryClient.setQueryData(messageQueryKey, previousServerMessages)
      }
      setActiveStream(previousActiveStream)
      setError(getErrorMessage(caughtError))
    }
  }

  function handleModelChange(model: ChatModel) {
    setSelectedModel(model)
    localStorage.setItem('chatModel', model)
  }

  function handleMatterChange(matterId: string | null) {
    setSelectedMatterId(matterId)
    if (matterId) {
      localStorage.setItem('selectedMatterId', matterId)
    } else {
      localStorage.removeItem('selectedMatterId')
    }
  }

  const userInitials = useMemo(() => {
    const name = currentUser?.fullName || user?.fullName
    if (!name) return 'LC'
    return name
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }, [currentUser, user])

  if (!isAuthenticated) {
    return (
      <LoginPage
        error={error}
        onLoginError={setError}
        onLoginSuccess={handleLoginSuccess}
      />
    )
  }

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden overscroll-none bg-[#fcfcfb] text-neutral-900">
      <Sidebar
        isOpen={isSidebarOpen}
        isBirdieOpen={isBirdieOpen}
        matters={matters}
        onBirdieToggle={() => setIsBirdieOpen((open) => !open)}
        onClose={() => setIsSidebarOpen(false)}
        onMatterChange={handleMatterChange}
        onNewChat={handleNewChat}
        threads={threads}
        selectedMatterId={selectedMatterId}
        userFullName={currentUser?.fullName ?? user?.fullName ?? ''}
        userInitials={userInitials}
        onLogout={handleLogout}
      />

      {/* Birdie floating PiP — outside layout flow */}
      <Suspense fallback={null}>
        <BirdiePanel
          isOpen={isBirdieOpen}
          onToggle={() => setIsBirdieOpen((o) => !o)}
          matterId={selectedMatterId}
          pageContext={buildBirdiePageContext(current, activeThread?.title ?? null)}
        />
      </Suspense>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white lg:my-2 lg:mr-2 lg:rounded-tl-2xl lg:border-l lg:border-t lg:border-neutral-200 lg:shadow-sm">
        {current.view !== 'chat' && (
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-100 px-3 lg:hidden">
            <Button
              aria-label="Open menu"
              onClick={() => setIsSidebarOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu size={20} />
            </Button>
            <span className="truncate text-sm font-semibold text-neutral-900">
              {mobileViewTitle(current.view)}
            </span>
          </header>
        )}

        {workspaceError && current.view !== 'chat' && (
          <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
            {getErrorMessage(workspaceError)}
          </div>
        )}

        <PanelErrorBoundary key={current.view}>
          <Suspense fallback={<PanelLoading />}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {current.view === 'home' ? (
                <HomePanel
                  currentUser={currentUser}
                  matters={matters}
                  onMatterChange={handleMatterChange}
                />
              ) : current.view === 'memories' ? (
                <MemoriesPanel />
              ) : current.view === 'documents' ? (
                <DocumentsPanel currentUser={currentUser} />
              ) : current.view === 'wiki' ? (
                <WikiPanel currentUser={currentUser} />
              ) : current.view === 'wellbeing' ? (
                <WellbeingPanel currentUser={currentUser} />
              ) : current.view === 'knowledge_bank' ? (
                <KnowledgeBankPanel
                  matters={matters}
                  selectedMatterId={selectedMatterId}
                  onMatterChange={handleMatterChange}
                  currentUser={currentUser}
                />
              ) : current.view === 'actions' ? (
                <ActionsPanel matters={matters} currentUser={currentUser} />
              ) : current.view === 'settings' ? (
                <SettingsPanel currentUser={currentUser} />
              ) : (
                <>
              <header className="z-30 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-white/80 px-4 py-2 backdrop-blur-md lg:px-6">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Button
                    aria-label="Open menu"
                    className="-ml-2 lg:hidden"
                    onClick={() => setIsSidebarOpen(true)}
                    size="icon"
                    variant="ghost"
                  >
                    <Menu size={20} />
                  </Button>
                  <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-sky-50 ring-1 ring-sky-100">
                    <img
                      alt=""
                      aria-hidden="true"
                      className="h-auto w-[150%] max-w-none"
                      src={lexChatLogo}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-600">
                      LexChat
                    </div>
                    <h2 className="truncate text-sm font-semibold text-neutral-900">
                      {activeThread?.title ?? 'New conversation'}
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Active matter"
                    className="hidden h-8 max-w-56 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs text-neutral-600 outline-none focus:border-neutral-400 md:block"
                    onChange={(event) => handleMatterChange(event.target.value || null)}
                    value={selectedMatterId ?? ''}
                  >
                    <option value="">No matter selected</option>
                    {matters.map((matter) => (
                      <option key={matter.id} value={matter.id}>
                        {matter.caseNumber} · {matter.title}
                      </option>
                    ))}
                  </select>
                  <div
                    className="flex items-center rounded-xl bg-neutral-100 p-1"
                    aria-label="Chat model"
                  >
                    {CHAT_MODELS.map((model) => {
                      const isSelected = selectedModel === model.id
                      return (
                        <Button
                          key={model.id}
                          aria-pressed={isSelected}
                          title={model.description}
                          onClick={() => handleModelChange(model.id)}
                          className="sm:px-2.5"
                          size="sm"
                          variant={isSelected ? 'selected' : 'secondary'}
                        >
                          {model.id === 'deepseek-v4-flash' ? (
                            <Gauge size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          <span className="hidden sm:inline">{model.label}</span>
                        </Button>
                      )
                    })}
                  </div>
                  <Button
                    className="hidden sm:inline-flex"
                    onClick={handleLogout}
                    size="sm"
                    variant="secondary"
                  >
                    Log out
                  </Button>
                </div>
                <select
                  aria-label="Active matter on mobile"
                  className="h-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs text-neutral-600 outline-none focus:border-neutral-400 md:hidden"
                  onChange={(event) => handleMatterChange(event.target.value || null)}
                  value={selectedMatterId ?? ''}
                >
                  <option value="">No matter selected</option>
                  {matters.map((matter) => (
                    <option key={matter.id} value={matter.id}>
                      {matter.caseNumber} · {matter.title}
                    </option>
                  ))}
                </select>
              </header>

              <ChatPanel
                attachmentStatus={composerAttachmentStatus}
                error={error ?? (workspaceError ? getErrorMessage(workspaceError) : null)}
                inputLabel="Ask LexChat"
                isLoading={isLoading}
                isResponding={isResponding}
                isUploadingFile={isUploadingComposerFile}
                messages={messages}
                onFileUpload={handleComposerFileUpload}
                onPromptChange={setPrompt}
                onStop={handleStopResponse}
                onSubmit={handleSubmit}
                onDeleteMessage={handleDeleteMessage}
                placeholder="Type your legal question or request..."
                prompt={prompt}
                sendLabel="Send"
                userInitials={userInitials}
              />
                </>
              )}
            </div>
          </Suspense>
        </PanelErrorBoundary>
      </main>
    </div>
  )
}

// ponytail: passes IDs not names for non-chat views; App only has thread titles cached centrally.
// Upgrade: pass display names when those panels expose them via props or a shared store.
function buildBirdiePageContext(current: import('./routes').AppView, threadTitle: string | null): BirdiePageContext {
  const base: BirdiePageContext = { view: current.view }
  if (current.view === 'chat') return { ...base, threadTitle }
  if (current.view === 'documents') return { ...base, documentName: current.documentId ?? undefined }
  if (current.view === 'wiki') return { ...base, wikiPageTitle: current.pageId ?? undefined }
  if (current.view === 'knowledge_bank') return { ...base, kbEntryTitle: current.entryId ?? undefined }
  if (current.view === 'actions') return { ...base, actionTitle: current.actionId ?? undefined }
  return base
}

function mobileViewTitle(view: import('./routes').AppView['view']) {
  const labels: Partial<Record<typeof view, string>> = {
    home: 'Home',
    chat: 'LexChat',
    actions: 'Workboard',
    documents: 'Documents',
    knowledge_bank: 'Knowledge Bank',
    memories: 'Memories',
    settings: 'Settings',
    wellbeing: 'Wellbeing',
    wiki: 'Lex-Wiki',
  }
  return labels[view] ?? 'LexCatalyst'
}

function PanelLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-white text-sm text-neutral-500">
      Loading workspace...
    </div>
  )
}

export default App
