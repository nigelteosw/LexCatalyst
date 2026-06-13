import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Gauge, Menu, Sparkles } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatPanel } from './components/ChatPanel'
import { Button } from './components/Button'
import { Sidebar } from './components/Sidebar'
import { LoginPage } from './components/LoginPage'
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
} from './lib/api'
import type { ChatModel, ChatThread, CurrentUser, Message } from './types/workspace'
import { useViewStore } from './store/viewStore'

const MemoriesPanel = lazy(() =>
  import('./components/MemoriesPanel').then((module) => ({ default: module.MemoriesPanel })),
)
const DocumentsPanel = lazy(() =>
  import('./components/DocumentsPanel').then((module) => ({ default: module.DocumentsPanel })),
)
const WikiPanel = lazy(() =>
  import('./components/WikiPanel').then((module) => ({ default: module.WikiPanel })),
)
const WellbeingPanel = lazy(() =>
  import('./components/WellbeingPanel').then((module) => ({ default: module.WellbeingPanel })),
)
const KnowledgeBankPanel = lazy(() =>
  import('./components/KnowledgeBankPanel').then((module) => ({
    default: module.KnowledgeBankPanel,
  })),
)
const ActionsPanel = lazy(() =>
  import('./components/ActionsPanel').then((module) => ({ default: module.ActionsPanel })),
)
const BirdiePanel = lazy(() =>
  import('./components/BirdiePanel').then((module) => ({ default: module.BirdiePanel })),
)
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel })),
)

type StoredUser = {
  full_name: string
  email: string
}

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

function getSavedUser(): StoredUser | null {
  try {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) as StoredUser : null
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('token'))
  const [user, setUser] = useState<StoredUser | null>(getSavedUser)

  const currentUserQuery = useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  })
  const currentUser = currentUserQuery.data ?? null

  const queryClient = useQueryClient()
  const { current, startNewChat, selectThread } = useViewStore()

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

  // Auto-select first thread on initial load
  useEffect(() => {
    if (!hasAutoSelectedRef.current && threads.length > 0) {
      hasAutoSelectedRef.current = true
      selectThread(threads[0].id)
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
      localStorage.setItem('token', response.access_token)
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
          if (useViewStore.getState().current.view === 'chat') {
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
      const uploaded = await uploadDocument(file, selectedMatterId)
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
    if (!user?.full_name) return 'LC'
    return user.full_name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }, [user])

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
    <div className="flex h-dvh bg-[#fcfcfb] text-neutral-900 overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        matters={matters}
        onClose={() => setIsSidebarOpen(false)}
        onMatterChange={handleMatterChange}
        onNewChat={handleNewChat}
        threads={threads}
        selectedMatterId={selectedMatterId}
        userFullName={user?.full_name ?? ''}
        userInitials={userInitials}
        onLogout={handleLogout}
      />

      {/* Birdie floating PiP — outside layout flow */}
      <Suspense fallback={null}>
        <BirdiePanel
          isOpen={isBirdieOpen}
          onToggle={() => setIsBirdieOpen((o) => !o)}
          matterId={selectedMatterId}
        />
      </Suspense>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white lg:my-2 lg:mr-2 lg:rounded-tl-2xl lg:border-l lg:border-t lg:border-neutral-200 lg:shadow-sm">
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
            <button
              aria-label={isBirdieOpen ? 'Hide Birdie' : 'Show Birdie'}
              className={`ml-auto grid h-8 w-8 place-items-center rounded-full border ${
                isBirdieOpen
                  ? 'border-[#1a6b4a]/18 bg-[#e8f5ee]'
                  : 'border-neutral-200 bg-neutral-50'
              }`}
              onClick={() => setIsBirdieOpen((open) => !open)}
              type="button"
            >
              <span className={`h-2 w-2 rounded-full ${isBirdieOpen ? 'bg-[#2d9e6b]' : 'bg-neutral-300'}`} />
            </button>
          </header>
        )}

        {workspaceError && current.view !== 'chat' && (
          <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
            {getErrorMessage(workspaceError)}
          </div>
        )}

        <Suspense fallback={<PanelLoading />}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {current.view === 'memories' ? (
            <MemoriesPanel />
          ) : current.view === 'documents' ? (
            <DocumentsPanel selectedMatterId={selectedMatterId} />
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
              <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-white/80 px-4 py-2 backdrop-blur-md lg:px-6">
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
                  <h2 className="truncate text-sm font-semibold text-neutral-900">
                    {activeThread?.title ?? 'New Chat'}
                  </h2>
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
                  {/* Birdie toggle */}
                  <button
                    aria-label={isBirdieOpen ? 'Hide Birdie' : 'Show Birdie'}
                    className={`flex h-8 w-8 items-center justify-center gap-1.5 rounded-full border text-[11px] font-medium transition-colors sm:w-auto sm:px-3 ${
                      isBirdieOpen
                        ? 'border-[#1a6b4a]/18 bg-[#e8f5ee] text-[#1a6b4a]'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-neutral-100'
                    }`}
                    onClick={() => setIsBirdieOpen((o) => !o)}
                    title={isBirdieOpen ? 'Hide Birdie' : 'Show Birdie'}
                    type="button"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isBirdieOpen ? 'animate-pulse bg-[#2d9e6b]' : 'bg-neutral-300'}`} />
                    <span className="hidden sm:inline">Birdie</span>
                  </button>
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
                assistantInitials="LC"
                attachmentStatus={composerAttachmentStatus}
                error={error ?? (workspaceError ? getErrorMessage(workspaceError) : null)}
                inputLabel="Ask LexCatalyst"
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
      </main>
    </div>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function mobileViewTitle(view: ReturnType<typeof useViewStore.getState>['current']['view']) {
  if (view === 'chat') return 'Chat'
  const labels = {
    actions: 'Actions',
    documents: 'Documents',
    knowledge_bank: 'Knowledge Bank',
    memories: 'Memories',
    settings: 'Settings',
    wellbeing: 'Wellbeing',
    wiki: 'Lex-Wiki',
  }
  return labels[view]
}

function PanelLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-white text-sm text-neutral-500">
      Loading workspace...
    </div>
  )
}

export default App
