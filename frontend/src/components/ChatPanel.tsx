import type { FormEvent } from 'react'
import type { Message } from '../types/workspace'

type ChatPanelProps = {
  assistantInitials: string
  inputLabel: string
  messages: Message[]
  onPromptChange: (prompt: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  prompt: string
  sendLabel: string
  suggestions: string[]
  userInitials: string
}

export function ChatPanel({
  assistantInitials,
  inputLabel,
  messages,
  onPromptChange,
  onSubmit,
  placeholder,
  prompt,
  sendLabel,
  suggestions,
  userInitials,
}: ChatPanelProps) {
  return (
    <section aria-label="Chat" className="flex min-h-[calc(100vh-73px)] min-w-0 flex-col bg-stone-50">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-8 md:px-[8vw] md:py-10">
        {messages.map((message, index) => (
          <ChatMessage
            assistantInitials={assistantInitials}
            key={`${message.role}-${index}`}
            message={message}
            userInitials={userInitials}
          />
        ))}
      </div>

      <div aria-label="Suggested prompts" className="flex flex-wrap gap-2 px-5 pb-4 md:px-[8vw]">
        {suggestions.map((suggestion) => (
          <button
            className="min-h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            key={suggestion}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className="mx-5 mb-6 grid gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-[0_16px_40px_rgba(24,24,24,0.08)] md:mx-[8vw] md:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={onSubmit}
      >
        <textarea
          aria-label={inputLabel}
          className="min-h-12 max-h-40 w-full resize-y bg-transparent leading-relaxed text-stone-950 outline-none placeholder:text-stone-400"
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={placeholder}
          value={prompt}
        />
        <button
          aria-label={sendLabel}
          className="min-h-11 rounded-lg bg-neutral-950 px-5 text-sm font-semibold text-white transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-blue-500 md:self-end"
          type="submit"
        >
          {sendLabel}
        </button>
      </form>
    </section>
  )
}

type ChatMessageProps = {
  assistantInitials: string
  message: Message
  userInitials: string
}

function ChatMessage({ assistantInitials, message, userInitials }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const avatar = isUser ? userInitials : assistantInitials

  return (
    <article
      className={`grid items-start gap-3 md:gap-4 ${
        isUser
          ? 'grid-cols-[minmax(0,760px)_34px] justify-end max-sm:grid-cols-[32px_minmax(0,1fr)]'
          : 'grid-cols-[34px_minmax(0,760px)] max-sm:grid-cols-[32px_minmax(0,1fr)]'
      }`}
    >
      <div
        aria-hidden="true"
        className={`grid h-8 w-8 place-items-center rounded-lg border text-[11px] font-extrabold md:h-[34px] md:w-[34px] ${
          isUser
            ? 'col-start-2 row-start-1 border-blue-700 bg-blue-600 text-white max-sm:col-start-1'
            : 'border-stone-300 bg-stone-200 text-stone-800'
        }`}
      >
        {avatar}
      </div>
      <div
        className={`rounded-lg px-4 py-3 leading-relaxed text-stone-950 ${
          isUser
            ? 'col-start-1 row-start-1 max-w-[680px] justify-self-end border border-blue-100 bg-blue-50 max-sm:col-start-2 max-sm:justify-self-stretch'
            : ''
        }`}
      >
        {message.meta ? (
          <p className="mb-1.5 text-xs font-bold text-stone-500">{message.meta}</p>
        ) : null}
        <p>{message.body}</p>
      </div>
    </article>
  )
}
