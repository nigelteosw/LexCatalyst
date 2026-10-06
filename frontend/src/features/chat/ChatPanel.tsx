import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, ArrowDown, BookMarked, Brain, Check, ChevronDown, Copy, FileText, LoaderCircle, MessageSquare, Paperclip, Sparkles, Square, Trash2 } from 'lucide-react'
import { Button } from '../../shared/ui/Button'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { FeatureHelp } from '../../shared/ui/FeatureHelp'
import type { Matter, Message, MessageSource, ToolStep } from '../../shared/types/workspace'
import { SourcePanel } from './SourcePanel'
import { citedSources, describeSource } from './sourceLabels'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const CHAT_HELP: HelpContent = {
  intro: 'A matter-aware AI assistant that searches your documents, knowledge bank, and public Singapore judgments on eLitigation.',
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
      title: 'Research Singapore court judgments',
      body: 'Ask for eLitigation cases, including recent judgments or a specific decision year. Open a numbered source to view its excerpt and full judgment. Only short legal-topic search phrases are sent to eLitigation. Prompts and retrieved excerpts go to OpenRouter and your chosen model provider.',
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
  matters: Matter[]
  attachmentStatus?: string | null
  error: string | null
  inputLabel: string
  modelPicker?: ReactNode
  /** Matter chip rendered at the start of the composer's action row. */
  composerLeading?: ReactNode
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
  matters,
  attachmentStatus,
  error,
  inputLabel,
  modelPicker,
  composerLeading,
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
  // The footnote whose passage is open in the side panel, scoped to its message.
  const [openSource, setOpenSource] = useState<{ messageKey: string; n: number } | null>(null)
  const openSourceData = openSource
    ? messages
        .map((m, i) => ({ m, key: m.id ?? `${m.role}-${i}` }))
        .find(({ key }) => key === openSource.messageKey)
        ?.m.sources?.find((s) => s.n === openSource.n)
    : undefined

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
    <section aria-label="LexChat" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
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
                  matters={matters}
                  message={message}
                  openSourceN={
                    openSource?.messageKey === (message.id ?? `${message.role}-${index}`)
                      ? openSource.n
                      : null
                  }
                  onOpenSource={(n) =>
                    setOpenSource({ messageKey: message.id ?? `${message.role}-${index}`, n })
                  }
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
            <div className="flex min-h-[40vh] flex-col items-center justify-center text-center sm:min-h-[50vh]">
              <div className="hidden h-12 w-12 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm sm:grid">
                <MessageSquare aria-hidden="true" size={22} />
              </div>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">
                What are you working on?
              </h3>
              <p className="mt-2 hidden max-w-md text-sm leading-relaxed text-neutral-600 sm:block">
                Ask about your documents and matters. Answers cite your firm’s knowledge and your own files.
              </p>
              <div className="mt-6 grid w-full max-w-2xl gap-2 sm:mt-8 sm:grid-cols-2 sm:gap-2.5">
                {SUGGESTED_PROMPTS.map((suggestion, i) => (
                  <button
                    key={suggestion}
                    className={`rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm leading-snug text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 ${i >= 3 ? 'hidden sm:block' : ''}`}
                    onClick={() => {
                      onPromptChange(suggestion)
                      textareaRef.current?.focus({ preventScroll: true })
                    }}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <div className="mt-5 hidden sm:block">
                <FeatureHelp title="LexChat" content={CHAT_HELP} />
              </div>
            </div>
          )}
        </div>
      </div>

      {openSourceData && (
        <SourcePanel matters={matters} onClose={() => setOpenSource(null)} source={openSourceData} />
      )}

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

      <div data-print-hide className="shrink-0 border-t border-neutral-200/70 bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 md:p-6 lg:pb-8">
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
            <textarea
              ref={textareaRef}
              aria-label={inputLabel}
              rows={1}
              className="min-h-[48px] max-h-[min(12rem,25dvh)] w-full resize-none overflow-y-auto bg-transparent px-1 py-3 text-base leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
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
            <div className="flex flex-wrap items-center gap-2 pb-1">
              {composerLeading}
              <Button
                aria-label="Attach PDF or DOCX"
                disabled={!canUpload}
                onClick={() => fileInputRef.current?.click()}
                size="md"
                variant="ghost"
              >
                {isUploadingFile ? <LoaderCircle size={16} className="animate-spin" /> : <Paperclip size={16} />}
                <span className="hidden sm:inline">Attach</span>
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
              {modelPicker}
              <div className="ml-auto mr-14 sm:mr-0">
                {isResponding ? (
                  <Button aria-label="Stop response" onClick={onStop} variant="secondary" className="border border-neutral-200">
                    <Square size={14} fill="currentColor" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    aria-label={sendLabel}
                    className="px-5"
                    disabled={!canSubmit}
                    type="submit"
                    variant="primary"
                  >
                    {sendLabel}
                  </Button>
                )}
              </div>
            </div>
          </div>
          {sendDisabledReason && (
            <div className="mt-2 text-center text-meta text-amber-700">{sendDisabledReason}</div>
          )}
          <p className="mt-2 hidden text-center text-meta text-neutral-500 sm:block">
            Enter to send · Shift+Enter for a new line · LexChat can make mistakes, so check important information.
          </p>
        </form>
      </div>
    </section>
  )
}

type ChatMessageProps = {
  matters: Matter[]
  message: Message
  openSourceN: number | null
  onOpenSource: (n: number) => void
  userInitials: string
  onDelete?: () => void
}

function ChatMessage({ matters, message, openSourceN, onOpenSource, userInitials, onDelete }: ChatMessageProps) {
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
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
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
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta text-neutral-500 hover:bg-red-50 hover:text-red-700"
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
      <article aria-label={`Message from ${userInitials}`} className="group">
        <div className="flex items-center gap-4 rounded-xl bg-neutral-100 px-5 py-4">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white"
          >
            {userInitials}
          </span>
          <div className="min-w-0 flex-1 whitespace-pre-wrap text-body leading-relaxed text-neutral-900">
            {message.body}
          </div>
        </div>
        {actions}
      </article>
    )
  }

  return (
    <article className="group">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-950 font-serif text-sm text-white"
        >
          L
        </span>
        <span className="text-sm text-neutral-500">LexChat</span>
        {message.steps && message.steps.length > 0 && (
          <>
            <span aria-hidden="true" className="text-neutral-300">·</span>
            <ToolSteps steps={message.steps} />
          </>
        )}
        {message.meta && <span className="text-xs text-neutral-400">{message.meta}</span>}
      </div>
      <div className="mt-3 min-w-0">
        {!message.body && !message.steps?.length ? (
          <span className="flex items-center gap-1 py-2" role="status" aria-label="LexChat is thinking">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:300ms]" />
          </span>
        ) : (
          message.body && (
            <MarkdownContent
              className="font-serif text-reading leading-8 text-neutral-900"
              footnotes={message.sources?.map((s) => s.n)}
              markdown={message.body}
              onFootnoteClick={onOpenSource}
            />
          )
        )}
        <SourceList
          cited={citedSources(message.body, message.sources)}
          matters={matters}
          onOpen={onOpenSource}
          openN={openSourceN}
        />
        {actions}
      </div>
    </article>
  )
}

function SourceList({
  cited,
  matters,
  onOpen,
  openN,
}: {
  cited: MessageSource[]
  matters: Matter[]
  onOpen: (n: number) => void
  openN: number | null
}) {
  if (cited.length === 0) return null
  return (
    <section aria-label="Sources" className="mt-6 border-t border-neutral-200 pt-4">
      <h4 className="text-sm text-neutral-500">Sources</h4>
      <ol className="mt-2 space-y-0.5">
        {cited.map((source) => (
          <li key={source.n}>
            <button
              aria-pressed={openN === source.n}
              className={`flex w-full items-start gap-5 rounded-md px-2 py-2 text-left transition-colors ${
                openN === source.n ? 'bg-indigo-50' : 'hover:bg-neutral-50'
              }`}
              onClick={() => onOpen(source.n)}
              type="button"
            >
              <span className="w-3 shrink-0 text-sm font-semibold text-accent">{source.n}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-neutral-900">{source.title}</span>
                <span className="block truncate text-sm text-neutral-500">{describeSource(source, matters)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Collapsible record of the sources LexChat consulted. Open while running, collapsed once done. */
function ToolSteps({ steps }: { steps: ToolStep[] }) {
  const running = steps.some((step) => step.status === 'running')
  const [open, setOpen] = useState(false)
  const expanded = running || open
  const current = steps.find((step) => step.status === 'running')

  return (
    <div className={expanded ? 'basis-full' : 'min-w-0'}>
      <button
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 rounded-md py-0.5 text-sm text-neutral-500 hover:text-neutral-800"
        disabled={running}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {running && <LoaderCircle size={12} className="animate-spin" />}
        <span>
          {running
            ? `${TOOL_LABELS[current?.tool ?? ''] ?? 'Working'}…`
            : `Reviewed ${steps.length} ${steps.length === 1 ? 'source' : 'sources'}`}
        </span>
        {!running && (
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 flex basis-full flex-col gap-1 border-l-2 border-neutral-200 pl-3">
          {steps.map((step, i) => (
            <ToolStepRow key={step.id ?? `${step.tool}-${i}`} step={step} />
          ))}
        </div>
      )}
    </div>
  )
}

const TOOL_LABELS: Record<string, string> = {
  search_elitigation: 'Searching eLitigation judgments',
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
        <div className="mt-1 break-words font-mono text-meta leading-4 text-neutral-500">
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
