import { useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import { SendHorizontal, User, Sparkles, AlertCircle } from 'lucide-react'
import type { Message } from '../types/workspace'

type ChatPanelProps = {
  assistantInitials: string
  error: string | null
  inputLabel: string
  isLoading: boolean
  messages: Message[]
  onPromptChange: (prompt: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  prompt: string
  sendLabel: string
  userInitials: string
}

export function ChatPanel({
  assistantInitials,
  error,
  inputLabel,
  isLoading,
  messages,
  onPromptChange,
  onSubmit,
  placeholder,
  prompt,
  sendLabel,
  userInitials,
}: ChatPanelProps) {
  const canSubmit = prompt.trim().length > 0 && !isLoading
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6">
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

      <div className="border-t border-neutral-100 bg-white p-4 md:p-6 lg:pb-8">
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
          <div className="relative group transition-all duration-200">
            <textarea
              ref={textareaRef}
              aria-label={inputLabel}
              rows={1}
              className="w-full min-h-[56px] max-h-48 resize-none bg-neutral-50 text-neutral-900 text-sm md:text-base leading-relaxed rounded-2xl border border-neutral-200 pl-4 pr-14 py-4 focus:bg-white focus:border-neutral-400 focus:ring-4 focus:ring-neutral-100 outline-none transition-all placeholder:text-neutral-400"
              disabled={isLoading}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  // Fallback for browsers that don't support requestSubmit
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
            <button
              aria-label={sendLabel}
              className={`absolute right-2 bottom-2 h-10 w-10 flex items-center justify-center rounded-xl transition-all ${
                canSubmit
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-md active:scale-95'
                  : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
              }`}
              disabled={!canSubmit}
              type="submit"
            >
              <SendHorizontal size={18} className={isLoading ? 'animate-pulse' : ''} />
            </button>
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
          <div className="whitespace-pre-wrap">{message.body}</div>
        </div>
      </div>
    </article>
  )
}
