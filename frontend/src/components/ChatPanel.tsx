import { useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, BookMarked, Brain, FileText, LoaderCircle, Paperclip, SendHorizontal, Sparkles, Square } from 'lucide-react'
import { Button } from './Button'
import { MarkdownContent } from './MarkdownContent'
import type { Message, ToolStep } from '../types/workspace'

type ChatPanelProps = {
  attachmentStatus?: string | null
  assistantInitials: string
  error: string | null
  inputLabel: string
  isLoading: boolean
  isResponding: boolean
  isUploadingFile: boolean
  messages: Message[]
  onFileUpload: (file: File) => void
  onPromptChange: (prompt: string) => void
  onStop: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  prompt: string
  sendLabel: string
  userInitials: string
}

export function ChatPanel({
  attachmentStatus,
  assistantInitials,
  error,
  inputLabel,
  isLoading,
  isResponding,
  isUploadingFile,
  messages,
  onFileUpload,
  onPromptChange,
  onStop,
  onSubmit,
  placeholder,
  prompt,
  sendLabel,
  userInitials,
}: ChatPanelProps) {
  const canSubmit = prompt.trim().length > 0 && !isLoading
  const canUpload = !isUploadingFile
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isNearBottomRef = useRef(true)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distanceFromBottom < 100
  }

  useEffect(() => {
    if (isNearBottomRef.current) scrollToBottom()
  }, [messages])

  // When a new message is submitted, always scroll to bottom
  const prevMessageCountRef = useRef(messages.length)
  useEffect(() => {
    const prevCount = prevMessageCountRef.current
    prevMessageCountRef.current = messages.length
    if (messages.length > prevCount && messages[messages.length - 1]?.role === 'user') {
      isNearBottomRef.current = true
      scrollToBottom()
    }
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [prompt])

  return (
    <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6">
        <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
          {messages.length > 0 ? (
            <div className="space-y-8 pb-12">
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id ?? `${message.role}-${index}`}
                  message={message}
                  userInitials={userInitials}
                  assistantInitials={assistantInitials}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
              <div className="w-12 h-12 bg-neutral-900 text-white rounded-2xl grid place-items-center shadow-lg">
                <Sparkles size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-neutral-900">How can I help you today?</h3>
                <p className="text-sm text-neutral-500 max-w-sm">
                  I can help you analyze legal documents, research case law, or draft professional correspondence.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-neutral-100 bg-white/95 p-4 md:p-6 lg:pb-8">
        <form
          className="mx-auto max-w-3xl"
          onSubmit={onSubmit}
        >
          {error && (
            <div className="mb-4 flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          <div className="rounded-[1.35rem] bg-neutral-50 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(23,23,23,0.08)] transition-all duration-200 focus-within:bg-white focus-within:shadow-[inset_0_0_0_1px_rgba(23,23,23,0.18),0_12px_35px_rgba(23,23,23,0.08)]">
            {attachmentStatus && (
              <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-[inset_0_0_0_1px_rgba(23,23,23,0.08)]">
                <Paperclip size={13} className="shrink-0 text-neutral-500" />
                <span className="truncate">{attachmentStatus}</span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <Button
                aria-label="Upload PDF or DOCX"
                className="mb-1 shrink-0"
                disabled={!canUpload}
                onClick={() => fileInputRef.current?.click()}
                size="icon"
                variant="ghost"
              >
                {isUploadingFile ? <LoaderCircle size={18} className="animate-spin" /> : <Paperclip size={18} />}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    onFileUpload(file)
                  }
                  event.currentTarget.value = ''
                }}
              />
              <textarea
                ref={textareaRef}
                aria-label={inputLabel}
                rows={1}
                className="min-h-[48px] max-h-48 flex-1 resize-none bg-transparent px-1 py-3 text-sm leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 md:text-base"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    if (isLoading) {
                      return
                    }
                    // Fallback for browsers that don't support requestSubmit.
                    if (event.currentTarget.form) {
                      if (typeof event.currentTarget.form.requestSubmit === 'function') {
                        event.currentTarget.form.requestSubmit()
                      } else {
                        const submitEvent = new Event('submit', { cancelable: true, bubbles: true })
                        event.currentTarget.form.dispatchEvent(submitEvent)
                      }
                    }
                  }
                }}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder={placeholder}
                value={prompt}
              />
              {isResponding ? (
                <Button
                  aria-label="Stop response"
                  className="mb-1 shrink-0"
                  onClick={onStop}
                  size="icon"
                  variant="secondary"
                >
                  <Square size={15} fill="currentColor" />
                </Button>
              ) : (
                <Button
                  aria-label={sendLabel}
                  className="mb-1 shrink-0"
                  disabled={!canSubmit}
                  size="icon"
                  type="submit"
                  variant="primary"
                >
                  <SendHorizontal size={18} />
                </Button>
              )}
            </div>
          </div>
          <p className="mt-3 text-[10px] text-center text-neutral-400">
            LexCatalyst can make mistakes. Check important info.
          </p>
        </form>
      </div>
    </section>
  )
}

type ChatMessageProps = {
  message: Message
  userInitials: string
  assistantInitials: string
}

function ChatMessage({ message, userInitials }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <article className={`flex gap-4 md:gap-6 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        aria-hidden="true"
        className={`flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-xl grid place-items-center text-[10px] font-semibold border uppercase ${
          isUser
            ? 'bg-neutral-900 border-neutral-900 text-white shadow-sm'
            : 'bg-white border-neutral-200 text-neutral-600 shadow-sm'
        }`}
      >
        {isUser ? userInitials : <Sparkles size={18} className="text-neutral-900" />}
      </div>
      <div className={`flex flex-col max-w-[85%] md:max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        {!isUser && message.steps && message.steps.length > 0 && (
          <div className="mb-2 flex flex-col gap-1 w-full">
            {message.steps.map((step, i) => (
              <ToolStepRow key={step.id ?? `${step.tool}-${i}`} step={step} />
            ))}
          </div>
        )}
        <div
          className={`relative px-4 py-3 text-sm md:text-base leading-relaxed shadow-sm ${
            isUser
              ? 'bg-neutral-900 text-white rounded-2xl rounded-tr-none'
              : 'bg-neutral-50 text-neutral-900 rounded-2xl rounded-tl-none border border-neutral-100'
          }`}
        >
          {message.meta && (
            <p className={`mb-1 text-[11px] font-semibold uppercase tracking-tight ${isUser ? 'text-neutral-400' : 'text-neutral-500'}`}>
              {message.meta}
            </p>
          )}
          {!isUser && !message.body && !message.steps?.length ? (
            <span className="flex items-center gap-1 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:300ms]" />
            </span>
          ) : (
            isUser ? (
              <div className="whitespace-pre-wrap">{message.body}</div>
            ) : (
              <MarkdownContent markdown={message.body} />
            )
          )}
        </div>
      </div>
    </article>
  )
}

function ToolStepRow({ step }: { step: ToolStep }) {
  const icons: Record<string, React.ReactNode> = {
    search_documents: <FileText size={12} />,
    search_knowledge_bank: <BookMarked size={12} />,
    search_memories: <Brain size={12} />,
    get_kb_entry: <BookMarked size={12} />,
  }
  const labels: Record<string, string> = {
    search_documents: 'Searching documents',
    search_knowledge_bank: 'Searching knowledge bank',
    search_memories: 'Searching memories',
    get_kb_entry: 'Reading KB entry',
  }
  const input = formatToolInput(step)

  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-[11px] text-neutral-500">
      <div className="flex items-center gap-1.5">
        <span>{icons[step.tool] ?? <Sparkles size={12} />}</span>
        <span className="font-medium text-neutral-600">{labels[step.tool] ?? step.tool}</span>
        {step.status === 'running' ? (
          <LoaderCircle size={11} className="ml-auto animate-spin text-neutral-400" />
        ) : (
          <span className="ml-auto min-w-0 max-w-[55%] truncate text-right text-neutral-400">
            {step.summary ?? 'Completed'}
          </span>
        )}
      </div>
      {input && (
        <div className="mt-1 break-words font-mono text-[10px] leading-4 text-neutral-400">
          {input}
        </div>
      )}
    </div>
  )
}

function formatToolInput(step: ToolStep) {
  if (typeof step.args.query === 'string') {
    return `query: "${step.args.query}"`
  }
  if (typeof step.args.entry_id === 'string') {
    return `entry_id: "${step.args.entry_id}"`
  }
  const entries = Object.entries(step.args)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(', ')
}
