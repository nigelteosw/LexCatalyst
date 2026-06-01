import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Gauge, Menu, Sparkles } from 'lucide-react'
import { ChatPanel } from './components/ChatPanel'
import { Sidebar } from './components/Sidebar'
import { LoginPage } from './components/LoginPage'
import { MemoriesPanel } from './components/MemoriesPanel'
import { DocumentsPanel } from './components/DocumentsPanel'
import { listChatThreads, listThreadMessages, streamChatMessage, loginWithGoogle } from './lib/api'
import type { ChatModel, ChatThread, Message } from './types/workspace'

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
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null) // null means new chat; special panels use string keys
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ChatModel>(getSavedChatModel)

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  )

  // Initial load
  useEffect(() => {
    if (!isAuthenticated) return

    let isMounted = true

    async function loadThreads() {
      try {
        const nextThreads = await listChatThreads()
        if (!isMounted) return
        setThreads(nextThreads)
        // Only set active thread if we don't have one and we just loaded threads
        if (nextThreads.length > 0 && activeThreadId === null) {
          setActiveThreadId(nextThreads[0].id)
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(getErrorMessage(caughtError))
        }
      }
    }

    void loadThreads()
    return () => { isMounted = false }
  }, [isAuthenticated, activeThreadId]) // Added activeThreadId to deps

  // Load messages when active thread changes
  useEffect(() => {
    if (
      !isAuthenticated ||
      !activeThreadId ||
      activeThreadId === 'memories' ||
      activeThreadId === 'documents'
    ) {
      if (!activeThreadId || activeThreadId === 'memories' || activeThreadId === 'documents') {
        setMessages([])
      }
      return
    }

    let isMounted = true

    async function loadMessages(threadId: string) {
      setIsLoading(true)
      setError(null)

      try {
        const nextMessages = await listThreadMessages(threadId)
        if (isMounted) {
          setMessages(nextMessages)
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(getErrorMessage(caughtError))
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadMessages(activeThreadId)
    return () => { isMounted = false }
  }, [activeThreadId, isAuthenticated])

  async function handleLoginSuccess(credential: string) {
    setIsLoading(true)
    setError(null)
    try {
      const response = await loginWithGoogle(credential)
      localStorage.setItem('token', response.access_token)
      localStorage.setItem('user', JSON.stringify(response.user))
      setUser(response.user)
      setIsAuthenticated(true)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setIsAuthenticated(false)
    setUser(null)
    setThreads([])
    setActiveThreadId(null)
    setMessages([])
    setIsSidebarOpen(false)
  }

  async function refreshThreads(nextActiveThreadId: string) {
    try {
      const nextThreads = await listChatThreads()
      setThreads(nextThreads)
      setActiveThreadId(nextActiveThreadId)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt || isLoading) {
      return
    }

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

    setMessages((currentMessages) => [...currentMessages, userMessage, assistantDraft])
    setPrompt('')
    setError(null)
    setIsLoading(true)

    try {
      await streamChatMessage({
        message: trimmedPrompt,
        model: selectedModel,
        threadId:
          activeThreadId === 'memories' || activeThreadId === 'documents'
            ? null
            : activeThreadId,
        onThread: (threadId, title) => {
          setThreads((currentThreads) => {
            if (currentThreads.some((thread) => thread.id === threadId)) {
              return currentThreads
            }

            return [
              {
                id: threadId,
                title,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              ...currentThreads,
            ]
          })
          // If this was a new thread, we might want to set it active
          // but we'll wait for onDone to do a full refresh to be safe
        },
        onToken: (content) => {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantDraftId
                ? { ...message, body: `${message.body}${content}` }
                : message,
            ),
          )
        },
        onDone: async (response) => {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantDraftId ? response.message : message,
            ),
          )
          await refreshThreads(response.threadId)
        },
      })
    } catch (caughtError) {
      setMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.id !== assistantDraftId || message.body.trim().length > 0,
        ),
      )
      setError(getErrorMessage(caughtError))
    } finally {
      setIsLoading(false)
    }
  }

  function startNewChat() {
    setActiveThreadId(null)
    setMessages([])
    setPrompt('')
    setError(null)
  }

  function selectThread(threadId: string) {
    setActiveThreadId(threadId || null)
    if (!threadId) {
      setMessages([])
      setPrompt('')
      setError(null)
    }
  }

  function selectMemories() {
    setActiveThreadId('memories')
  }

  function selectDocuments() {
    setActiveThreadId('documents')
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
        activeThreadId={activeThreadId}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewChat={startNewChat}
        onSelectThread={selectThread}
        onSelectMemories={selectMemories}
        onSelectDocuments={selectDocuments}
        threads={threads}
        userFullName={user?.full_name ?? ''}
        userInitials={userInitials}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-white lg:rounded-tl-2xl lg:border-t lg:border-l lg:border-neutral-200 lg:shadow-sm lg:my-2 lg:mr-2">
        {activeThreadId === 'memories' ? (
          <MemoriesPanel />
        ) : activeThreadId === 'documents' ? (
          <DocumentsPanel />
        ) : (
          <>
            <header className="flex h-14 items-center justify-between border-b border-neutral-100 bg-white/80 backdrop-blur-md px-4 lg:px-6 sticky top-0 z-30">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden p-2 -ml-2 text-neutral-500 hover:bg-neutral-100 rounded-md"
                  aria-label="Open menu"
                >
                  <Menu size={20} />
                </button>
                <h2 className="truncate text-sm font-semibold text-neutral-900">
                  {activeThread?.title ?? 'New Chat'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center rounded-lg border border-neutral-200 bg-neutral-50 p-1"
                  aria-label="Chat model"
                >
                  {CHAT_MODELS.map((model) => {
                    const isSelected = selectedModel === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        aria-pressed={isSelected}
                        title={model.description}
                        onClick={() => handleModelChange(model.id)}
                        className={`flex h-8 items-center gap-1.5 rounded-md px-2 sm:px-2.5 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'bg-white text-neutral-950 shadow-sm ring-1 ring-neutral-200'
                            : 'text-neutral-500 hover:text-neutral-900'
                        }`}
                      >
                        {model.id === 'deepseek-v4-flash' ? <Gauge size={14} /> : <Sparkles size={14} />}
                        <span className="hidden sm:inline">{model.label}</span>
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={handleLogout}
                  className="text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors px-3 py-1.5 rounded-md hover:bg-neutral-50"
                >
                  Log out
                </button>
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.25 rounded-full bg-emerald-50 text-[11px] font-medium text-emerald-700 border border-emerald-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  AI Online
                </div>
              </div>
            </header>

            <ChatPanel
              assistantInitials="LC"
              error={error}
              inputLabel="Ask LexCatalyst"
              isLoading={isLoading}
              messages={messages}
              onPromptChange={setPrompt}
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
  if (error instanceof Error) {
    return error.message
  }
  return 'Something went wrong.'
}

export default App
