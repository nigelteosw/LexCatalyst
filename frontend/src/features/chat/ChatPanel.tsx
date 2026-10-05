import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, ArrowDown, BookMarked, Brain, Check, ChevronDown, Copy, FileText, LoaderCircle, MessageSquare, Paperclip, SendHorizontal, Sparkles, Square, Trash2 } from 'lucide-react'
import { Button } from '../../shared/ui/Button'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { FeatureHelp } from '../../shared/ui/FeatureHelp'
import type { Message, ToolStep } from '../../shared/types/workspace'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const CHAT_HELP: HelpContent = {
  intro: 'A matter-aware AI assistant that searches your documents and knowledge bank before every answer.',
  steps: [
    {
      emoji: '💬',
      title: 'Just ask in plain English',
      body: 'Type any legal question, ask to draft a clause, summarise a document, or compare two positions. No special syntax needed.',
    },
    {
      emoji: '📎',
      title: 'Attach a document to the conversation',
      body: 'Use the paperclip icon to attach an uploaded document. The AI will read the full text and cite specific pages in its answer.',
    },
    {
      emoji: '🔍',
      title: 'Automatic knowledge retrieval',
      body: 'Before each response, the AI searches your accessible Knowledge Bank entries and document chunks for relevant context — without you having to ask.',
    },
    {
      emoji: '⚖️',
      title: 'Choose your model',
      body: 'Use the model pill under the message box to pick High (stronger, slower reasoning) or Mid (faster, lower cost), or search any OpenRouter model. Set the models behind each tier in Settings.',
    },
    {
      emoji: '🗂️',
      title: 'Thread history',
      body: 'Every conversation is saved. Browse previous threads in the sidebar. Switch to a matter context to keep case-specific conversations scoped to that matter.',
    },
  ],
  tips: [
    'The AI can hallucinate. Always verify cited page references against the source document before relying on them.',
    'For the best results, upload the relevant document first, then ask your question — the AI will cite exact passages.',
    'Thread summaries are stored and used in later sessions so the AI remembers the context of long-running matters.',
  ],
}

export type ChatPanelProps = {
  attachmentStatus?: string | null
  error: string | null
  inputLabel: string
  modelPicker?: ReactNode
  sendDisabledReason?: string
  isLoading: boolean
  isResponding: boolean
  isUploadingFile: boolean
  messages: Message[]
  onFileUpload: (file: File) => void
  onPromptChange: (prompt: string) => void
  onStop: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onDeleteMessage?: (messageId: string) => void
  placeholder: string
  prompt: string
  sendLabel: string
  userInitials: string
}

const SUGGESTED_PROMPTS = [
  'Summarise the key risks in my latest document',
  'What does our playbook say about indemnity caps?',
  'Draft a client email explaining a change in governing law',
  'What should I check before sending this draft to a partner?',
]

export function ChatPanel({
  attachmentStatus,
  error,
  inputLabel,
  modelPicker,
  sendDisabledReason,
  isLoading,
  isResponding,
  isUploadingFile,
  messages,
  onFileUpload,
  onPromptChange,
  onStop,
  onSubmit,
  onDeleteMessage,
  placeholder,
  prompt,
  sendLabel,
  userInitials,
}: ChatPanelProps) {
  const canSubmit = prompt.trim().length > 0 && !isLoading && !sendDisabledReason
  const canUpload = !isUploadingFile
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isNearBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const scrollToBottom = () => {
    const container = scrollContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottomRef.current = distanceFromBottom < 100
    setShowJumpToLatest(distanceFromBottom > 240)
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
    <section aria-label="LexChat" className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="app-scroll-region flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 sm:pt-6"
      >
        <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
          {messages.length > 0 ? (
            <div className="space-y-7 pb-12">
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id ?? `${message.role}-${index}`}
                  message={message}
                  userInitials={userInitials}
                  onDelete={
                    onDeleteMessage && message.id && !isResponding
                      ? () => onDeleteMessage(message.id!)
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm">
                <MessageSquare aria-hidden="true" size={22} />
              </div>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">
                What are you working on?
              </h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
                Ask about your documents and matters. Answers cite your firm’s knowledge and your own files.
              </p>
              <div className="mt-8 grid w-full max-w-2xl gap-2.5 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm leading-snug text-neutral-700 shadow-sm transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                    onClick={() => {
                      onPromptChange(suggestion)
                      textareaRef.current?.focus()
                    }}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <div className="mt-5">
                <FeatureHelp title="LexChat" content={CHAT_HELP} />
              </div>
            </div>
          )}
        </div>
      </div>

      {showJumpToLatest && (
        <div className="pointer-events-none relative">
          <button
            aria-label="Jump to latest message"
            className="pointer-events-auto absolute -top-12 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-md hover:bg-neutral-50"
            onClick={scrollToBottom}
            type="button"
          >
            <ArrowDown size={15} />
          </button>
        </div>
      )}

      <div className="shrink-0 border-t border-neutral-100 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 md:p-6 lg:pb-8">
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
                className="min-h-[48px] max-h-48 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-3 text-sm leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 md:text-base"
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
          <div className="mt-2 flex items-center justify-center gap-2">
            {modelPicker}
            {sendDisabledReason && <span className="text-[11px] text-amber-700">{sendDisabledReason}</span>}
          </div>
          <p className="mt-2 text-center text-[11px] text-neutral-500">
            Enter to send · Shift+Enter for a new line · LexChat can make mistakes, so check important information.
          </p>
        </form>
      </div>
    </section>
  )
}

type ChatMessageProps = {
  message: Message
  userInitials: string
  onDelete?: () => void
}

function ChatMessage({ message, userInitials, onDelete }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const actions = (
    <div
      className={`mt-1.5 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${
        isUser ? 'justify-end' : ''
      }`}
    >
      {message.body && (
        <button
          aria-label={copied ? 'Copied' : 'Copy message'}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          onClick={copy}
          type="button"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
      {onDelete && (
        <button
          aria-label="Delete message"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-red-50 hover:text-red-700"
          onClick={() => {
            if (window.confirm('Delete this message?')) onDelete()
          }}
          type="button"
        >
          <Trash2 size={12} />
          Delete
        </button>
      )}
    </div>
  )

  if (isUser) {
    return (
      <article aria-label={`Message from ${userInitials}`} className="group flex flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-100 px-4 py-2.5 text-[15px] leading-relaxed text-neutral-900">
          {message.body}
        </div>
        {actions}
      </article>
    )
  }

  return (
    <article className="group flex gap-3.5">
      <div
        aria-hidden="true"
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-950 text-white"
      >
        <Sparkles size={13} />
      </div>
      <div className="min-w-0 flex-1">
        {message.steps && message.steps.length > 0 && <ToolSteps steps={message.steps} />}
        {message.meta && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{message.meta}</p>
        )}
        {!message.body && !message.steps?.length ? (
          <span className="flex items-center gap-1 py-2" role="status" aria-label="LexChat is thinking">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:300ms]" />
          </span>
        ) : (
          message.body && <MarkdownContent markdown={message.body} className="text-[15px] leading-7 text-neutral-900" />
        )}
        {actions}
      </div>
    </article>
  )
}

/** Collapsible record of the sources LexChat consulted. Open while running, collapsed once done. */
function ToolSteps({ steps }: { steps: ToolStep[] }) {
  const running = steps.some((step) => step.status === 'running')
  const [open, setOpen] = useState(false)
  const expanded = running || open
  const current = steps.find((step) => step.status === 'running')

  return (
    <div className="mb-3">
      <button
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
        disabled={running}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {running ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
        <span className="font-medium">
          {running
            ? `${TOOL_LABELS[current?.tool ?? ''] ?? 'Working'}…`
            : `Searched ${steps.length} ${steps.length === 1 ? 'source' : 'sources'}`}
        </span>
        {!running && (
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 border-l-2 border-neutral-200 pl-3">
          {steps.map((step, i) => (
            <ToolStepRow key={step.id ?? `${step.tool}-${i}`} step={step} />
          ))}
        </div>
      )}
    </div>
  )
}

const TOOL_LABELS: Record<string, string> = {
  search_documents: 'Searching documents',
  search_knowledge_bank: 'Searching knowledge bank',
  search_memories: 'Searching memories',
  get_kb_entry: 'Reading KB entry',
}

function ToolStepRow({ step }: { step: ToolStep }) {
  const icons: Record<string, ReactNode> = {
    search_documents: <FileText size={12} />,
    search_knowledge_bank: <BookMarked size={12} />,
    search_memories: <Brain size={12} />,
    get_kb_entry: <BookMarked size={12} />,
  }
  const labels = TOOL_LABELS
  const input = formatToolInput(step)

  return (
    <div className="py-0.5 text-xs text-neutral-600">
      <div className="flex items-center gap-1.5">
        <span>{icons[step.tool] ?? <Sparkles size={12} />}</span>
        <span className="font-medium text-neutral-600">{labels[step.tool] ?? step.tool}</span>
        {step.status === 'running' ? (
          <LoaderCircle size={11} className="ml-auto animate-spin text-neutral-400" />
        ) : (
          <span className="ml-auto min-w-0 max-w-[55%] truncate text-right text-neutral-500">
            {step.summary ?? 'Completed'}
          </span>
        )}
      </div>
      {input && (
        <div className="mt-1 break-words font-mono text-[11px] leading-4 text-neutral-500">
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
