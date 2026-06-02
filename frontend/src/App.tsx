import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Gauge, Menu, Sparkles } from 'lucide-react'
import { ChatPanel } from './components/ChatPanel'
import { Button } from './components/Button'
import { Sidebar } from './components/Sidebar'
import { LoginPage } from './components/LoginPage'
import { MemoriesPanel } from './components/MemoriesPanel'
import { DocumentsPanel } from './components/DocumentsPanel'
import { WikiPanel } from './components/WikiPanel'
import { listChatThreads, listThreadMessages, streamChatMessage, loginWithGoogle, uploadDocument } from './lib/api'
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
  const [isResponding, setIsResponding] = useState(false)
  const [isUploadingComposerFile, setIsUploadingComposerFile] = useState(false)
  const [composerAttachmentStatus, setComposerAttachmentStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ChatModel>(getSavedChatModel)
  const [selectedWikiPageId, setSelectedWikiPageId] = useState<string | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const hasAutoSelectedThreadRef = useRef(false)

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
        if (!hasAutoSelectedThreadRef.current && nextThreads.length > 0) {
          hasAutoSelectedThreadRef.current = true
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
  }, [isAuthenticated])

  // Load messages when active thread changes
  useEffect(() => {
    if (
      !isAuthenticated ||
      !activeThreadId ||
      activeThreadId === 'memories' ||
      activeThreadId === 'documents' ||
      activeThreadId === 'wiki'
    ) {
      if (
        !activeThreadId ||
        activeThreadId === 'memories' ||
        activeThreadId === 'documents' ||
        activeThreadId === 'wiki'
      ) {
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
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setIsAuthenticated(false)
    setUser(null)
    setThreads([])
    setActiveThreadId(null)
    setMessages([])
    setIsSidebarOpen(false)
    setIsLoading(false)
    setIsResponding(false)
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
    setIsResponding(true)
    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      await streamChatMessage({
        message: trimmedPrompt,
        model: selectedModel,
        signal: controller.signal,
        threadId:
          activeThreadId === 'memories' || activeThreadId === 'documents' || activeThreadId === 'wiki'
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
        onDone: (response) => {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === assistantDraftId ? response.message : message,
            ),
          )
          void refreshThreads(response.threadId)
        },
      })
    } catch (caughtError) {
      if (isAbortError(caughtError)) {
        setMessages((currentMessages) =>
          currentMessages.filter(
            (message) => message.id !== assistantDraftId || message.body.trim().length > 0,
          ),
        )
        return
      }

      setMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.id !== assistantDraftId || message.body.trim().length > 0,
        ),
      )
      setError(getErrorMessage(caughtError))
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
        setIsLoading(false)
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
      const statusLabel = uploaded.status === 'ready'
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
    setIsLoading(false)
    setIsResponding(false)
  }

  function startNewChat() {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setActiveThreadId(null)
    setMessages([])
    setPrompt('')
    setError(null)
    setIsLoading(false)
    setIsResponding(false)
  }

  function selectThread(threadId: string) {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsResponding(false)
    setActiveThreadId(threadId || null)
    if (!threadId) {
      setMessages([])
      setPrompt('')
      setError(null)
    }
  }

  function selectMemories() {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsLoading(false)
    setIsResponding(false)
    setActiveThreadId('memories')
  }

  function selectDocuments() {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsLoading(false)
    setIsResponding(false)
    setActiveThreadId('documents')
  }

  function selectWiki(pageId: string | null = selectedWikiPageId) {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setIsLoading(false)
    setIsResponding(false)
    setSelectedWikiPageId(pageId)
    setActiveThreadId('wiki')
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
        onSelectWiki={() => selectWiki()}
        threads={threads}
        userFullName={user?.full_name ?? ''}
        userInitials={userInitials}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-white lg:rounded-tl-2xl lg:border-t lg:border-l lg:border-neutral-200 lg:shadow-sm lg:my-2 lg:mr-2">
        {activeThreadId === 'memories' ? (
          <MemoriesPanel />
        ) : activeThreadId === 'documents' ? (
          <DocumentsPanel
            selectedModel={selectedModel}
            onOpenWikiPage={(pageId) => selectWiki(pageId)}
          />
        ) : activeThreadId === 'wiki' ? (
          <WikiPanel
            selectedPageId={selectedWikiPageId}
            onSelectPage={setSelectedWikiPageId}
            onBackToDocuments={selectDocuments}
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
                        {model.id === 'deepseek-v4-flash' ? <Gauge size={14} /> : <Sparkles size={14} />}
                        <span className="hidden sm:inline">{model.label}</span>
                      </Button>
                    )
                  })}
                </div>
                <Button
                  onClick={handleLogout}
                  size="sm"
                  variant="secondary"
                >
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
  if (error instanceof Error) {
    return error.message
  }
  return 'Something went wrong.'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export default App
