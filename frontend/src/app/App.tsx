import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Menu } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatPanel } from '../features/chat/ChatPanel'
import { Button } from '../shared/ui/Button'
import { ChatHeader } from '../features/chat/ChatHeader'
import { MatterChip } from '../features/chat/MatterChip'
import { ModelPicker } from '../shared/ui/ModelPicker'
import { MISSING_KEY_MESSAGE, useModelChoice } from '../shared/lib/llm'
import { PanelErrorBoundary } from '../shared/ui/PanelErrorBoundary'
import { Sidebar } from '../features/navigation/Sidebar'
import birdieLogo from '../assets/Birdie.png'
import { DemoBar } from '../features/demo/DemoBar'
import { DemoSwitcher } from '../features/demo/DemoSwitcher'
import { LoginPage } from '../features/auth/LoginPage'
import {
  deleteChatMessage,
  getCurrentUser,
  listChatThreads,
  listMatters,
  moveChatThread,
  listThreadMessages,
  streamChatMessage,
  subscribeToUnauthorized,
  loginWithGoogle,
  clearPresenterSession,
  isImpersonating,
  restorePresenterSession,
  switchToDemoUser,
  uploadDocument,
} from '../shared/api/api'
import type {
  BirdiePageContext,
  ChatThread,
  CurrentUser,
  Message,
  SessionUser,
} from '../shared/types/workspace'
import { useWorkspaceNavigation } from './routes'
import { getErrorMessage, isAbortError } from '../shared/lib/errors'

const MemoriesPanel = lazy(() =>
  import('../features/memories/MemoriesPanel').then((module) => ({ default: module.MemoriesPanel })),
)
const DocumentsPanel = lazy(() =>
  import('../features/documents/DocumentsPanel').then((module) => ({ default: module.DocumentsPanel })),
)
const MatterPage = lazy(() =>
  import('../features/knowledge-bank/MatterPage').then((module) => ({ default: module.MatterPage })),
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
    selectHome,
    selectMatter,
    selectSettings,
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
    queryKey: ['threads', 'all'],
    queryFn: () => listChatThreads(),
    enabled: isAuthenticated,
  })
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  // Keep the selected matter in step with the open thread.
  useEffect(() => {
    const thread = threads.find((t) => t.id === threadId)
    if (thread && thread.matterId !== selectedMatterId) handleMatterChange(thread.matterId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, threads])
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
  const [isBirdieOpen, setIsBirdieOpen] = useState(false)
  const { choice: modelChoice, setChoice: setModelChoice, settings: llmSettings, needsKey } = useModelChoice(
    'lex.chat.tier',
    'lexchat',
  )
  // The Workboard's matter filter (or open ticket's matter); Birdie works in that matter there.
  const [workboardMatterId, setWorkboardMatterId] = useState<string | null>(null)
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(
    () => localStorage.getItem('selectedMatterId'),
  )
  // The saved matter may belong to another account (demo user switching); drop it if this user can't see it.
  useEffect(() => {
    if (!mattersQuery.isSuccess || !selectedMatterId) return
    if (!matters.some((matter) => matter.id === selectedMatterId)) {
      setSelectedMatterId(null)
      localStorage.removeItem('selectedMatterId')
    }
  }, [mattersQuery.isSuccess, matters, selectedMatterId])
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamAbortReasonRef = useRef<'stop' | 'navigation' | null>(null)

  useEffect(() => {
    if (!isKnownRoute) selectHome({ replace: true })
  }, [isKnownRoute, selectHome])

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
      clearPresenterSession()
      localStorage.setItem('token', response.accessToken)
      localStorage.setItem('user', JSON.stringify(response.user))
      setUser(response.user)
      setIsAuthenticated(true)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  // Demo mode: swap the whole session, then reset every cached query so nothing from the
  // previous user's view leaks into the next one.
  async function resetForSessionChange(nextUser: SessionUser | null) {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setUser(nextUser)
    setIsResponding(false)
    setActiveStream(null)
    setSelectedMatterId(null)
    localStorage.removeItem('selectedMatterId')
    selectHome()
    await queryClient.resetQueries()
  }

  async function handleDemoSwitch(userId: string) {
    try {
      await resetForSessionChange(await switchToDemoUser(userId))
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function handleDemoReturn() {
    if (!restorePresenterSession()) return
    await resetForSessionChange(getSavedUser())
  }

  function handleLogout() {
    streamAbortReasonRef.current = 'navigation'
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    clearPresenterSession()
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setIsAuthenticated(false)
    setUser(null)
    queryClient.clear()
    startNewChat()
    setIsSidebarOpen(false)
    setIsResponding(false)
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
    if (!trimmedPrompt || isLoading || needsKey) return

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
        model: modelChoice,
        matterId: selectedMatterId,
        signal: controller.signal,
        threadId,
        onThread: (tid, title) => {
          queryClient.setQueryData(['threads', 'all'], (old: ChatThread[] = []) => {
            if (old.some((t) => t.id === tid)) return old
            return [
              { id: tid, title, matterId: selectedMatterId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
        onSources: (sources) => {
          setActiveStream((stream) => stream
            ? {
                ...stream,
                messages: stream.messages.map((message) =>
                  message.id === assistantDraftId ? { ...message, sources } : message,
                ),
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
                        sources: response.message.sources ?? message.sources,
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
      const uploaded = await uploadDocument(file, { matterId: selectedMatterId })
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

  function handleMatterChange(matterId: string | null) {
    setSelectedMatterId(matterId)
    if (matterId) {
      localStorage.setItem('selectedMatterId', matterId)
    } else {
      localStorage.removeItem('selectedMatterId')
    }
  }

  // In a chat, changing the matter re-files the open thread; before the first
  // message it only sets where the next thread will be created.
  async function handleChatMatterChange(matterId: string | null) {
    handleMatterChange(matterId)
    if (!threadId) return
    try {
      await moveChatThread(threadId, matterId)
      queryClient.invalidateQueries({ queryKey: ['threads'] })
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  const panelKey = current.view

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
    <div className="flex h-dvh min-h-0 w-full overflow-hidden overscroll-none bg-surface text-neutral-900">
      <Sidebar
        isOpen={isSidebarOpen}
        matters={matters}
        onClose={() => setIsSidebarOpen(false)}
        onMatterChange={handleMatterChange}
        onNewChat={handleNewChat}
        threads={threads}
        selectedMatterId={selectedMatterId}
        userFullName={currentUser?.fullName ?? user?.fullName ?? ''}
        userInitials={userInitials}
        onLogout={handleLogout}
        userRole={(currentUser?.firmRole ?? user?.firmRole ?? '').replace('_', ' ')}
        menuExtra={
          <DemoSwitcher
            currentUserId={currentUser?.id ?? user?.id ?? null}
            isAdmin={currentUser?.isAdmin ?? user?.isAdmin ?? false}
            onReturn={handleDemoReturn}
            onSwitch={handleDemoSwitch}
          />
        }
      />

      <button
        type="button"
        aria-label={isBirdieOpen ? 'Close Birdie' : 'Open Birdie'}
        aria-expanded={isBirdieOpen}
        aria-controls="birdie-panel"
        title="Birdie"
        onClick={() => setIsBirdieOpen((open) => !open)}
        className="birdie-launcher fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] grid h-12 w-12 place-items-center overflow-hidden rounded-full border border-[#2d9e6b]/45 bg-[#fff8d8] shadow-lg hover:ring-2 hover:ring-[#2d9e6b]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d9e6b] focus-visible:ring-offset-2"
      >
        <img alt="" aria-hidden="true" className="h-auto w-[250%] max-w-none" src={birdieLogo} />
      </button>

      {/* Birdie stays mounted so closing it preserves the conversation. */}
      <Suspense fallback={null}>
        <BirdiePanel
          key={currentUser?.id ?? user?.id ?? 'anonymous'}
          isOpen={isBirdieOpen}
          onToggle={() => setIsBirdieOpen((o) => !o)}
          matterId={current.view === 'matter'
            ? current.matterId
            : current.view === 'actions'
              ? workboardMatterId
              : current.view === 'chat' && activeThread
              ? activeThread.matterId
              : selectedMatterId}
          onOpenSettings={() => selectSettings()}
          pageContext={buildBirdiePageContext(current)}
        />
      </Suspense>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface lg:border-l lg:border-neutral-200 lg:shadow-sm">
        {isImpersonating() && (
          <DemoBar
            name={currentUser?.fullName ?? user?.fullName ?? 'demo user'}
            onReturn={handleDemoReturn}
            role={(currentUser?.firmRole ?? user?.firmRole ?? '').replace('_', ' ')}
          />
        )}
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

        <PanelErrorBoundary key={panelKey}>
          <Suspense fallback={<PanelLoading />}>
            <div
              key={panelKey}
              className="workspace-panel-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
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
              ) : current.view === 'matter' ? (
                <MatterPage matterId={current.matterId} onMatterChange={handleMatterChange} />
              ) : current.view === 'knowledge_bank' ? (
                <KnowledgeBankPanel
                  matters={matters}
                  selectedMatterId={selectedMatterId}
                  onMatterChange={handleMatterChange}
                  currentUser={currentUser}
                />
              ) : current.view === 'actions' || current.view === 'handoff_review' ? (
                <ActionsPanel matters={matters} currentUser={currentUser} onFocusMatterChange={setWorkboardMatterId} />
              ) : current.view === 'settings' ? (
                <SettingsPanel currentUser={currentUser} />
              ) : (
                <>
              <ChatHeader
                leading={
                  <Button
                    aria-label="Open menu"
                    className="-ml-2 lg:hidden"
                    onClick={() => setIsSidebarOpen(true)}
                    size="icon"
                    variant="ghost"
                  >
                    <Menu size={20} />
                  </Button>
                }
                matter={matters.find((m) => m.id === selectedMatterId) ?? null}
                onOpenMatter={() => selectMatter(selectedMatterId ?? 'general')}
                title={activeThread?.title ?? 'New conversation'}
              />

              <ChatPanel
                matters={matters}
                attachmentStatus={composerAttachmentStatus}
                error={error ?? (workspaceError ? getErrorMessage(workspaceError) : null)}
                inputLabel="Ask LexChat"
                composerLeading={
                  <MatterChip
                    matters={matters}
                    onChange={handleChatMatterChange}
                    value={selectedMatterId}
                  />
                }
                modelPicker={
                  <ModelPicker
                    choice={modelChoice}
                    onChange={setModelChoice}
                    onOpenSettings={() => selectSettings()}
                    settings={llmSettings}
                  />
                }
                sendDisabledReason={needsKey ? MISSING_KEY_MESSAGE : undefined}
                isLoading={isLoading}
                isResponding={isResponding}
                isUploadingFile={isUploadingComposerFile}
                messages={messages}
                onFileUpload={handleComposerFileUpload}
                onPromptChange={setPrompt}
                onStop={handleStopResponse}
                onSubmit={handleSubmit}
                onDeleteMessage={handleDeleteMessage}
                placeholder={selectedMatterId ? 'Ask LexChat about this matter' : 'Ask LexChat'}
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

// Sends the open resource's ID; the backend loads its title and text with the user's access.
function buildBirdiePageContext(current: import('./routes').AppView): BirdiePageContext {
  const base: BirdiePageContext = { view: current.view }
  if (current.view === 'chat') return { ...base, threadId: current.threadId }
  if (current.view === 'documents') return { ...base, documentId: current.documentId }
  if (current.view === 'knowledge_bank') return { ...base, kbEntryId: current.entryId }
  if (current.view === 'actions') return { ...base, actionId: current.actionId }
  if (current.view === 'handoff_review') return { ...base, actionId: current.actionId }
  return base
}

function mobileViewTitle(view: import('./routes').AppView['view']) {
  const labels: Partial<Record<typeof view, string>> = {
    home: 'Home',
    chat: 'LexChat',
    actions: 'Workboard',
    handoff_review: 'Review',
    documents: 'Documents',
    knowledge_bank: 'Knowledge Bank',
    memories: 'Memories',
    settings: 'Settings',
  }
  return labels[view] ?? 'LexCatalyst'
}

function PanelLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-white px-6 text-sm text-neutral-500">
      <div className="w-full max-w-3xl space-y-4">
        <div className="h-5 w-40 animate-pulse rounded-full bg-neutral-100" />
        <div className="space-y-3 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
          <div className="h-4 w-2/3 animate-pulse rounded-full bg-neutral-100" />
          <div className="h-4 w-full animate-pulse rounded-full bg-neutral-100" />
          <div className="h-4 w-5/6 animate-pulse rounded-full bg-neutral-100" />
        </div>
        <p className="text-xs text-neutral-400">Loading workspace...</p>
      </div>
    </div>
  )
}

export default App
