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
import { listChatThreads, listThreadMessages, streamChatMessage, loginWithGoogle, uploadDocument } from './lib/api'
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
  const { current, startNewChat, selectThread, selectWiki, selectDocuments, selectMemories } = useViewStore()

  const threadId = current.view === 'chat' ? current.threadId : null

  // Server state — threads and messages via TanStack Query
  const { data: threads = [] } = useQuery({
    queryKey: ['threads'],
    queryFn: listChatThreads,
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
        signal: controller.signal,
        threadId,
        onThread: (tid, title) => {
          // Optimistically add the new thread so the sidebar updates immediately
          queryClient.setQueryData(['threads'], (old: ChatThread[] = []) => {
            if (old.some((t) => t.id === tid)) return old
            return [
              { id: tid, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
              ...old,
            ]
          })
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
            curr.map((m) => (m.id === assistantDraftId ? response.message : m)),
          )
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
        setIsResponding(false)
      }
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
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsResponding(false)
  }

  function handleModelChange(model: ChatModel) {
    setSelectedModel(model)
    localStorage.setItem('chatModel', model)
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
        onClose={() => setIsSidebarOpen(false)}
        threads={threads}
        userFullName={user?.full_name ?? ''}
        userInitials={userInitials}
        onLogout={handleLogout}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-white lg:rounded-tl-2xl lg:border-t lg:border-l lg:border-neutral-200 lg:shadow-sm lg:my-2 lg:mr-2">
        {current.view === 'memories' ? (
          <MemoriesPanel />
        ) : current.view === 'documents' ? (
          <DocumentsPanel selectedModel={selectedModel} />
        ) : current.view === 'wiki' ? (
          <WikiPanel />
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
