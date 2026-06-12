import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, BookMarked, Lightbulb, User, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { listKnowledgeBankEntries, streamBirdieMessage } from '../lib/api'
import type { KnowledgeBankEntry } from '../types/workspace'
import { MarkdownContent } from './MarkdownContent'

type BirdiePanelProps = {
  isOpen: boolean
  onToggle: () => void
  matterId: string | null
}

type MentorTab = 'review' | 'examples' | 'ask' | 'progress'

type ReviewCard = {
  id: string
  tone: 'issue' | 'watch' | 'ok' | 'tip'
  title: string
  body: string
  source?: string
}

const STARTER_CARDS: ReviewCard[] = [
  {
    id: '1',
    tone: 'tip',
    title: 'How Birdie works',
    body: "Ask me anything in the Ask tab — legal questions, soft skills, workload concerns, or how to approach a difficult conversation.",
    source: 'Birdie · mentor',
  },
  {
    id: '2',
    tone: 'ok',
    title: 'Knowledge Bank connected',
    body: "Your firm's playbooks and style guides are indexed. I'll surface relevant examples when you ask questions.",
    source: 'Birdie · mentor',
  },
]

const toneStyles = {
  issue: {
    header: 'bg-[#fdeeed] text-[#8a1f1f] border-[#8a1f1f]/15',
    icon: 'text-[#8a1f1f]',
    label: 'Issue',
  },
  watch: {
    header: 'bg-[#fef3dc] text-[#8a5a00] border-[#8a5a00]/15',
    icon: 'text-[#8a5a00]',
    label: 'Watch',
  },
  ok: {
    header: 'bg-[#e8f5ee] text-[#1a6b4a] border-[#1a6b4a]/15',
    icon: 'text-[#1a6b4a]',
    label: 'Good',
  },
  tip: {
    header: 'bg-[#e8f0fe] text-[#1a4a8a] border-[#1a4a8a]/15',
    icon: 'text-[#1a4a8a]',
    label: 'Tip',
  },
}

const PANEL_WIDTH = 320
const PANEL_HEIGHT = 480
const PANEL_MARGIN = 16

function getDefaultPosition() {
  return {
    x: Math.max(PANEL_MARGIN, window.innerWidth - PANEL_MARGIN - PANEL_WIDTH),
    y: Math.max(PANEL_MARGIN, window.innerHeight - PANEL_MARGIN - PANEL_HEIGHT),
  }
}

export function BirdiePanel({ isOpen, onToggle, matterId }: BirdiePanelProps) {
  const [pos, setPos] = useState(getDefaultPosition)
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent) => {
    if (window.innerWidth < 640) return
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y }
  }, [pos])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setPos({
        x: Math.max(PANEL_MARGIN, Math.min(window.innerWidth - PANEL_WIDTH - PANEL_MARGIN, dragRef.current.startPosX + dx)),
        y: Math.max(PANEL_MARGIN, Math.min(window.innerHeight - PANEL_HEIGHT - PANEL_MARGIN, dragRef.current.startPosY + dy)),
      })
    }
    function onUp() { dragRef.current = null }
    function onResize() {
      setPos((current) => ({
        x: Math.max(PANEL_MARGIN, Math.min(window.innerWidth - PANEL_WIDTH - PANEL_MARGIN, current.x)),
        y: Math.max(PANEL_MARGIN, Math.min(window.innerHeight - PANEL_HEIGHT - PANEL_MARGIN, current.y)),
      }))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-x-2 bottom-2 z-[60] flex h-[min(75dvh,34rem)] select-none flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl max-sm:!left-2 max-sm:!right-2 max-sm:!top-auto sm:inset-auto sm:h-[480px] sm:w-[320px]"
      style={{ left: pos.x, top: pos.y }}
    >
      <header
        className="flex shrink-0 items-center gap-2.5 border-b border-black/10 bg-white px-3 py-2.5 sm:cursor-grab sm:active:cursor-grabbing"
        onMouseDown={startDrag}
      >
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e8f5ee] border border-[#1a6b4a]/20">
          <User size={14} className="text-[#1a6b4a]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[#0f0f0f]">Birdie</div>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-medium text-[#1a6b4a]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2d9e6b]" />
          Live
        </div>
        <button
          aria-label="Close Birdie"
          className="grid h-6 w-6 place-items-center rounded-md text-[#9a9a94] hover:bg-[#f4f3ef]"
          onClick={onToggle}
          type="button"
        >
          <X size={12} />
        </button>
      </header>

      {/* Tabs + content */}
      <BirdiePanelBody matterId={matterId} />
    </div>
  )
}

function BirdiePanelBody({ matterId }: { matterId: string | null }) {
  const [activeTab, setActiveTab] = useState<MentorTab>('ask')
  return (
    <>
      <nav className="flex shrink-0 border-b border-black/10">
        {(['ask', 'review', 'examples', 'progress'] as MentorTab[]).map((tab) => (
          <button
            key={tab}
            className={`flex-1 border-b-2 py-1.5 text-[10.5px] font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-[#2d9e6b] text-[#0f0f0f]'
                : 'border-transparent text-[#9a9a94] hover:text-[#5a5a56]'
            }`}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'ask' && <AskTab matterId={matterId} />}
        {activeTab === 'review' && <ReviewTab />}
        {activeTab === 'examples' && <ExamplesTab matterId={matterId} />}
        {activeTab === 'progress' && <ProgressTab />}
      </div>
    </>
  )
}

function ReviewTab() {
  return (
    <div className="h-full overflow-y-auto p-3 space-y-2.5">
      {STARTER_CARDS.map((card) => (
        <ReviewCard key={card.id} card={card} />
      ))}
    </div>
  )
}

function ReviewCard({ card }: { card: ReviewCard }) {
  const s = toneStyles[card.tone]
  return (
    <div className="overflow-hidden rounded-[10px] border border-black/10">
      <div className={`flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-medium ${s.header}`}>
        <span>{s.label}</span>
        <span className="truncate">{card.title}</span>
      </div>
      <div className="px-3 py-2.5 text-[11.5px] leading-[1.6] text-[#5a5a56]">
        {card.body}
      </div>
      {card.source && (
        <div className="px-3 pb-2 text-[10px] text-[#9a9a94]">{card.source}</div>
      )}
    </div>
  )
}

function ExamplesTab({ matterId }: { matterId: string | null }) {
  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: ['kbEntries', { matterId }],
    queryFn: () => listKnowledgeBankEntries({ matterId: matterId ?? undefined }),
  })

  const styleGuides = entries.filter((e) => e.entryType === 'style_guide')
  const knowledgeEntries = entries.filter((e) => e.entryType === 'knowledge_bank')

  if (isLoading) {
    return <div className="p-3 text-xs text-[#9a9a94]">Loading examples...</div>
  }

  if (error) {
    return (
      <div className="m-3 rounded-lg bg-[#fdeeed] px-3 py-2 text-[11px] text-[#8a1f1f]">
        {error instanceof Error ? error.message : 'Could not load Knowledge Bank examples.'}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="grid h-full place-items-center p-4 text-center">
        <div>
          <BookMarked size={20} className="mx-auto text-[#aaa9a3]" />
          <p className="mt-2 text-xs text-[#8c8c86]">No Knowledge Bank entries yet.</p>
          <p className="mt-1 text-[11px] text-[#9a9a94]">Upload documents and add them to the Knowledge Bank.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      {styleGuides.length > 0 && (
        <section>
          <div className="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            Style guides
          </div>
          <div className="space-y-2">
            {styleGuides.slice(0, 4).map((entry) => (
              <KBEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}
      {knowledgeEntries.length > 0 && (
        <section>
          <div className="mb-2 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            Precedents & playbooks
          </div>
          <div className="space-y-2">
            {knowledgeEntries.slice(0, 4).map((entry) => (
              <KBEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function KBEntryCard({ entry }: { entry: KnowledgeBankEntry }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#4a3db0]/18 bg-[#eeecff]/30">
      <div className="flex items-center gap-1.5 bg-[#eeecff] px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#4a3db0]">
        <Lightbulb size={10} />
        {entry.entryType.replace('_', ' ')}
      </div>
      <div className="px-3 py-2.5">
        <div className="text-[11px] font-medium text-[#0f0f0f]">{entry.title}</div>
        {expanded ? (
          <div className="mt-1.5 max-h-48 overflow-y-auto text-[11.5px] italic leading-[1.65] text-[#5a5a56]" style={{ fontFamily: 'Georgia, serif' }}>
            {entry.bodyMarkdown}
          </div>
        ) : (
          <div className="mt-1 line-clamp-2 text-[11px] italic text-[#8c8c86]" style={{ fontFamily: 'Georgia, serif' }}>
            {entry.bodyMarkdown}
          </div>
        )}
        <button
          className="mt-1.5 text-[10px] text-[#4a3db0] hover:underline"
          onClick={() => setExpanded((e) => !e)}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      </div>
      <div className="px-3 pb-2 text-[10px] text-[#9a9a94]">
        {entry.scope.replace('_', '-')} · v{entry.version}
      </div>
    </div>
  )
}

type BirdieMsg = { id: string; role: 'user' | 'assistant'; body: string }

const STARTERS = [
  'How do I raise a workload concern with my supervisor?',
  'What does reasonable endeavours actually require?',
  'How can I handle feedback I disagree with?',
  "What's the right way to ask for guidance without looking junior?",
]

function AskTab({ matterId }: { matterId: string | null }) {
  const [messages, setMessages] = useState<BirdieMsg[]>([])
  const [prompt, setPrompt] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function send(text: string) {
    if (!text.trim() || isResponding) return
    setPrompt('')
    setError(null)

    const draftId = crypto.randomUUID()
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'user', body: text },
      { id: draftId, role: 'assistant', body: '' },
    ])
    setIsResponding(true)

    const controller = new AbortController()
    abortRef.current = controller

    // Build history from current messages (exclude the draft we just appended)
    const history = messages.map((m) => ({ role: m.role, content: m.body }))

    try {
      await streamBirdieMessage({
        message: text,
        history,
        matterId,
        signal: controller.signal,
        onToken: (content) => {
          setMessages((m) =>
            m.map((msg) => (msg.id === draftId ? { ...msg, body: msg.body + content } : msg)),
          )
        },
        onDone: (fullContent) => {
          setMessages((m) =>
            m.map((msg) => (msg.id === draftId ? { ...msg, body: fullContent } : msg)),
          )
        },
        onError: (detail) => {
          setMessages((m) => m.filter((msg) => msg.id !== draftId))
          setError(detail)
        },
      })
    } catch (caughtError) {
      if (!(caughtError instanceof Error && caughtError.name === 'AbortError')) {
        setMessages((current) => current.filter((message) => message.id !== draftId))
        setError(caughtError instanceof Error ? caughtError.message : 'Birdie could not respond.')
      }
    } finally {
      setIsResponding(false)
      abortRef.current = null
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <div className="mb-1 text-[10px] text-[#9a9a94]">Try asking</div>
            {STARTERS.map((s) => (
              <button
                key={s}
                className="w-full rounded-[9px] border border-black/10 bg-[#f4f3ef] px-3 py-2 text-left text-[11.5px] leading-5 text-[#5a5a56] transition-colors hover:border-black/20 hover:bg-[#eeecea]"
                onClick={() => send(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {messages.map((msg) => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                {msg.role === 'user' ? (
                  <div className="max-w-[88%] rounded-[10px] rounded-br-[3px] bg-[#0f0f0f] px-3 py-2 text-[12px] leading-[1.65] text-white">
                    {msg.body}
                  </div>
                ) : (
                  <div className="rounded-[3px_10px_10px_10px] border border-black/10 bg-[#f4f3ef] px-3 py-2.5 text-[12px] leading-[1.65] text-[#0f0f0f]">
                    {msg.body ? (
                      <MarkdownContent markdown={msg.body} />
                    ) : (
                      <span className="flex gap-1">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#9a9a94]"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {error && (
              <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-[11px] text-[#8a1f1f]">{error}</div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-black/10 p-2.5">
        <div className="flex items-end gap-2 rounded-[10px] border border-black/15 bg-[#f4f3ef] px-3 py-2 focus-within:border-black/30 focus-within:bg-white">
          <textarea
            className="max-h-20 flex-1 resize-none bg-transparent text-[12px] leading-5 text-[#0f0f0f] outline-none placeholder:text-[#aaa9a3]"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(prompt)
              }
            }}
            placeholder="Ask Birdie anything..."
            rows={1}
            value={prompt}
          />
          <button
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#1a6b4a] disabled:bg-[#aaa9a3]"
            disabled={!prompt.trim() || isResponding}
            onClick={() => send(prompt)}
            type="button"
          >
            <ArrowUp size={13} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgressTab() {
  const skills = [
    { category: 'Legal drafting', items: [
      { label: 'Clause construction', value: 70, color: 'bg-[#2d9e6b]' },
      { label: 'Risk flagging', value: 55, color: 'bg-[#8a5a00]' },
      { label: 'Defined terms', value: 82, color: 'bg-[#2d9e6b]' },
    ]},
    { category: 'Soft skills', items: [
      { label: 'Workload boundary-setting', value: 38, color: 'bg-[#8a2621]' },
      { label: 'Upward feedback', value: 50, color: 'bg-[#8a5a00]' },
      { label: 'Asking for help', value: 65, color: 'bg-[#2d9e6b]' },
    ]},
    { category: 'Sustainability principles', items: [
      { label: 'Principles knowledge', value: 72, color: 'bg-[#2d9e6b]' },
      { label: 'Wellbeing tracking', value: 44, color: 'bg-[#8a5a00]' },
    ]},
  ]

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <div className="rounded-[10px] border border-black/10 bg-[#f4f3ef] px-3 py-2.5 text-[11.5px] leading-5 text-[#5a5a56]">
        Based on your questions and drafts. Updates as you work — a learning map, not a performance report.
      </div>
      {skills.map((section) => (
        <section key={section.category}>
          <div className="mb-2 text-[10.5px] font-medium text-[#5a5a56]">{section.category}</div>
          <div className="space-y-1.5">
            {section.items.map((item) => (
              <div key={item.label} className="flex items-center gap-2.5 rounded-[8px] bg-[#f4f3ef] px-2.5 py-2">
                <span className="min-w-0 flex-1 text-[11px] text-[#5a5a56]">{item.label}</span>
                <div className="h-1 w-14 overflow-hidden rounded-full bg-[#dddcd8]">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.value}%` }} />
                </div>
                <span className="w-7 text-right text-[10px] text-[#9a9a94]">{item.value}%</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
