import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Gauge, Menu, Sparkles } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatPanel } from './components/ChatPanel'
import { Button } from './components/Button'
import { Sidebar } from './components/Sidebar'
import { LoginPage } from './components/LoginPage'
import { MemoriesPanel } from './components/MemoriesPanel'
import { DocumentsPanel } from './components/DocumentsPanel'
import { WikiPanel } from './components/WikiPanel'
import { WellbeingPanel } from './components/WellbeingPanel'
import { KnowledgeBankPanel } from './components/KnowledgeBankPanel'
import {
  listChatThreads,
  listMatters,
  listThreadMessages,
  streamChatMessage,
  loginWithGoogle,
  uploadDocument,
} from './lib/api'
import type { ChatModel, ChatThread, Message } from './types/workspace'
import { useViewStore } from './store/viewStore'

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

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!localStorage.getItem('token'))
  const [user, setUser] = useState<{ full_name: string; email: string } | null>(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })

  const queryClient = useQueryClient()
  const { current, startNewChat, selectThread } = useViewStore()

  const threadId = current.view === 'chat' ? current.threadId : null

  // Server state — threads and messages via TanStack Query
  const { data: threads = [] } = useQuery({
    queryKey: ['threads'],
    queryFn: listChatThreads,
    enabled: isAuthenticated,
  })
  const { data: matters = [] } = useQuery({
    queryKey: ['matters'],
    queryFn: () => listMatters('active'),
    enabled: isAuthenticated,
  })

  const { data: serverMessages = [], isFetching: isFetchingMessages } = useQuery({
    queryKey: ['messages', threadId],
    queryFn: () => listThreadMessages(threadId!),
    enabled: !!threadId && isAuthenticated,
  })

  // Local UI state
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [isUploadingComposerFile, setIsUploadingComposerFile] = useState(false)
  const [composerAttachmentStatus, setComposerAttachmentStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ChatModel>(getSavedChatModel)
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(
    () => localStorage.getItem('selectedMatterId'),
  )
  const streamAbortRef = useRef<AbortController | null>(null)
  const hasAutoSelectedRef = useRef(false)

  // Auto-select first thread on initial load
  useEffect(() => {
    if (!hasAutoSelectedRef.current && threads.length > 0) {
      hasAutoSelectedRef.current = true
      selectThread(threads[0].id)
    }
  }, [threads, selectThread])

  // Abort any active stream when the view changes (prevents snap-back and stale streams)
  useEffect(() => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    // isResponding is reset in the stream's finally block once the abort propagates
  }, [current])

  // Sync server messages to local state whenever not actively streaming
  useEffect(() => {
    if (!isResponding) {
      setMessages(serverMessages)
    }
  }, [serverMessages, isResponding])

  // Clear local messages when not in a chat thread
  useEffect(() => {
    if (current.view !== 'chat' || current.threadId === null) {
      if (!isResponding) {
        setMessages([])
      }
    }
  }, [current, isResponding])

  const activeThread = useMemo(
    () => threads.find((t) => t.id === threadId) ?? null,
    [threadId, threads],
  )

  // isLoading blocks re-submission; isFetchingMessages prevents submitting before thread history loads
  const isLoading = isFetchingMessages || isResponding

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

    setMessages((curr) => [...curr, userMessage, assistantDraft])
    setPrompt('')
    setError(null)
    setIsResponding(true)
    const controller = new AbortController()
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
        onToolCall: (tool, args) => {
          setMessages((curr) =>
            curr.map((m) =>
              m.id === assistantDraftId
                ? { ...m, steps: [...(m.steps ?? []), { tool, args, summary: null, status: 'running' as const }] }
                : m,
            ),
          )
        },
        onToolResult: (tool, summary) => {
          setMessages((curr) =>
            curr.map((m) => {
              if (m.id !== assistantDraftId) return m
              const steps = (m.steps ?? []).map((s) =>
                s.tool === tool && s.status === 'running'
                  ? { ...s, summary, status: 'done' as const }
                  : s,
              )
              return { ...m, steps }
            }),
          )
        },
        onToken: (content) => {
          setMessages((curr) =>
            curr.map((m) =>
              m.id === assistantDraftId ? { ...m, body: `${m.body}${content}` } : m,
            ),
          )
        },
        onDone: (response) => {
          setMessages((curr) =>
            curr.map((m) => {
              if (m.id !== assistantDraftId) return m
              // Preserve tool steps collected during streaming
              return { ...response.message, steps: m.steps }
            }),
          )
          // Pre-seed the cache so navigating to a newly-created thread never shows a blank screen
          if (!threadId) {
            queryClient.setQueryData(['messages', response.threadId], [userMessage, response.message])
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
        setMessages((curr) =>
          curr.filter((m) => m.id !== assistantDraftId || m.body.trim().length > 0),
        )
        return
      }
      setMessages((curr) =>
        curr.filter((m) => m.id !== assistantDraftId || m.body.trim().length > 0),
      )
      setError(getErrorMessage(caughtError))
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
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
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsResponding(false)
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
    return <LoginPage error={error} onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <div className="flex h-screen bg-[#fcfcfb] text-neutral-900 overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        matters={matters}
        onClose={() => setIsSidebarOpen(false)}
        onMatterChange={handleMatterChange}
        threads={threads}
        selectedMatterId={selectedMatterId}
        userFullName={user?.full_name ?? ''}
        userInitials={userInitials}
        onLogout={handleLogout}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-white lg:rounded-tl-2xl lg:border-t lg:border-l lg:border-neutral-200 lg:shadow-sm lg:my-2 lg:mr-2">
        {current.view === 'memories' ? (
          <MemoriesPanel />
        ) : current.view === 'documents' ? (
          <DocumentsPanel
            selectedModel={selectedModel}
            selectedMatterId={selectedMatterId}
          />
        ) : current.view === 'wiki' ? (
          <WikiPanel />
        ) : current.view === 'wellbeing' ? (
          <WellbeingPanel />
        ) : current.view === 'knowledge_bank' ? (
          <KnowledgeBankPanel
            matters={matters}
            selectedMatterId={selectedMatterId}
            onMatterChange={handleMatterChange}
          />
        ) : (
          <>
            <header className="flex h-14 items-center justify-between border-b border-neutral-100 bg-white/80 backdrop-blur-md px-4 lg:px-6 sticky top-0 z-30">
              <div className="flex items-center gap-3 min-w-0">
                <Button
                  onClick={() => setIsSidebarOpen(true)}
                  className="-ml-2 lg:hidden"
                  aria-label="Open menu"
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
                <Button onClick={handleLogout} size="sm" variant="secondary">
                  Log out
                </Button>
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.25 rounded-full bg-emerald-50 text-[11px] font-medium text-emerald-700 border border-emerald-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  AI Online
                </div>
              </div>
            </header>

            <ChatPanel
              assistantInitials="LC"
              attachmentStatus={composerAttachmentStatus}
              error={error}
              inputLabel="Ask LexCatalyst"
              isLoading={isLoading}
              isResponding={isResponding}
              isUploadingFile={isUploadingComposerFile}
              messages={messages}
              onFileUpload={handleComposerFileUpload}
              onPromptChange={setPrompt}
              onStop={handleStopResponse}
              onSubmit={handleSubmit}
              placeholder="Type your legal question or request..."
              prompt={prompt}
              sendLabel="Send"
              userInitials={userInitials}
            />
          </>
        )}
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

export default App
