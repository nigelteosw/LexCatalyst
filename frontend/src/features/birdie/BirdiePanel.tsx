import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampBirdieFrame, defaultBirdieFrame } from './panelFrame'
import type { BirdieFrame } from './panelFrame'
import { ArrowUp, BookMarked, Lightbulb, MoveDiagonal, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  distillBirdieLessons,
  listBirdieLessons,
  listKnowledgeBankEntries,
  streamBirdieMessage,
} from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import {
  MISSING_KEY_MESSAGE,
  describeModelChoice,
  useModelChoice,
  useOpenrouterModels,
} from '../../shared/lib/llm'
import { ModelPicker } from '../../shared/ui/ModelPicker'
import type {
  BirdieLesson,
  BirdiePageContext,
  FeedbackRound,
  KnowledgeBankEntry,
  LessonAnnotation,
} from '../../shared/types/workspace'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { FeatureHelp } from '../../shared/ui/FeatureHelp'
import birdieLogo from '../../assets/Birdie.png'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const BIRDIE_HELP: HelpContent = {
  intro: 'Your personal AI mentor for navigating life as a junior lawyer — ask anything, get straight answers.',
  steps: [
    {
      emoji: '🐦',
      title: 'Ask tab — live chat',
      body: 'Type any question you\'d be embarrassed to ask a partner. Birdie answers directly using your firm\'s Knowledge Bank as context, so responses are grounded in your firm\'s actual guidance.',
    },
    {
      emoji: '📋',
      title: 'Review tab — feedback from your reviewers',
      body: 'Comments your seniors left on your drafts, plus the general lessons Birdie draws from them. Tap "Explain this" on any comment to talk it through in the Ask tab.',
    },
    {
      emoji: '💡',
      title: 'Examples tab — KB-backed examples',
      body: 'Real examples drawn from your firm\'s Knowledge Bank, filtered to entries relevant to your current matter context.',
    },
    {
      emoji: '📈',
      title: 'Progress tab — skills map',
      body: 'A visual map of skills and competencies. Use it to identify gaps and ask Birdie targeted questions about areas you want to develop.',
    },
  ],
  tips: [
    'Birdie uses your firm\'s Knowledge Bank and your personal memories to give grounded, specific answers.',
    'Birdie is confidential to you. Your questions are not logged or shared with supervisors.',
    'Open Birdie from the bottom-right button. Drag its header to move it; drag the bottom-right corner to resize it.',
    'Ask Birdie to manage your assigned Workboard tickets or report their recorded progress.',
  ],
}

type BirdiePanelProps = {
  isOpen: boolean
  onToggle: () => void
  matterId: string | null
  pageContext?: BirdiePageContext
  onOpenSettings?: () => void
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

function playTweet(pitch = 1300) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(pitch, t)
    osc.frequency.linearRampToValueAtTime(pitch * 1.45, t + 0.07)
    osc.frequency.linearRampToValueAtTime(pitch * 1.1, t + 0.16)
    gain.gain.setValueAtTime(0.15, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.start(t)
    osc.stop(t + 0.28)
    osc.onended = () => ctx.close()
  } catch { /* AudioContext blocked (e.g. no prior user gesture) */ }
}

export function BirdiePanel({ isOpen, onToggle, matterId, pageContext, onOpenSettings }: BirdiePanelProps) {
  const [frame, setFrame] = useState(() => defaultBirdieFrame(window.innerWidth, (window.visualViewport?.height ?? window.innerHeight)))
  const interactionRef = useRef<{ mode: 'drag' | 'resize'; pointerId: number; x: number; y: number; frame: BirdieFrame } | null>(null)

  useEffect(() => {
    const onResize = () => setFrame((current) => clampBirdieFrame(current, window.innerWidth, (window.visualViewport?.height ?? window.innerHeight)))
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [])

  function startInteraction(event: ReactPointerEvent<HTMLElement>, mode: 'drag' | 'resize') {
    if (event.button !== 0) return
    if (mode === 'drag' && (event.target as HTMLElement).closest('button, input, textarea, a')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    interactionRef.current = { mode, pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame }
  }

  function moveInteraction(event: ReactPointerEvent<HTMLElement>) {
    const start = interactionRef.current
    if (!start || event.pointerId !== start.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    const next = start.mode === 'drag'
      ? { ...start.frame, x: start.frame.x + dx, y: start.frame.y + dy }
      : { ...start.frame, width: start.frame.width + dx, height: start.frame.height + dy }
    setFrame(clampBirdieFrame(next, window.innerWidth, (window.visualViewport?.height ?? window.innerHeight)))
  }

  function endInteraction() {
    interactionRef.current = null
  }

  const queryClient = useQueryClient()
  useEffect(() => {
    if (!isOpen) return
    playTweet()
    // Feedback may have arrived while Birdie was closed.
    queryClient.invalidateQueries({ queryKey: ['birdieLessons'] })
  }, [isOpen, queryClient])

  // The header shows which model is answering for the current tier choice.
  const { choice, settings } = useModelChoice('lex.birdie.tier', 'birdie')
  const modelsQuery = useOpenrouterModels(!!settings?.hasKey)
  const { modelId, modelName } = settings?.hasKey
    ? describeModelChoice(choice, settings, modelsQuery.data)
    : { modelId: null, modelName: null }
  useEffect(() => {
    if (isOpen) queryClient.invalidateQueries({ queryKey: ['llmSettings'] })
  }, [isOpen, queryClient])

  // Stay mounted when closed (just hidden) so the conversation and any in-flight answer survive.
  return (
    <div
      id="birdie-panel"
      role="region"
      aria-label="Birdie mentor"
      aria-hidden={!isOpen}
      className={`${isOpen ? '' : 'hidden '}birdie-enter fixed z-[60] flex flex-col overflow-hidden overscroll-none rounded-2xl border border-black/10 bg-white shadow-2xl`}
      style={{ left: `clamp(max(8px, env(safe-area-inset-left)), ${frame.x}px, calc(100vw - ${frame.width}px - max(8px, env(safe-area-inset-right))))`, top: `calc(var(--app-offset-top, 0px) + max(env(safe-area-inset-top), ${frame.y}px))`, width: frame.width, height: frame.height }}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onLostPointerCapture={endInteraction}
    >
      <header
        className="flex shrink-0 touch-none select-none cursor-grab items-center gap-2.5 border-b border-black/10 bg-white px-3 py-2.5 active:cursor-grabbing"
        onPointerDown={(event) => startInteraction(event, 'drag')}
      >
        <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-[#2d9e6b]/35 bg-[#fff8d8]">
          <img
            alt=""
            aria-hidden="true"
            className="h-auto w-[250%] max-w-none"
            src={birdieLogo}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[#0f0f0f]">Birdie</span>
            <FeatureHelp title="Birdie" content={BIRDIE_HELP} size="compact" />
          </div>
          {modelName && (
            <div className="truncate text-[11px] text-[#76766f]" title={modelId ?? undefined}>
              {modelName}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-[11px] font-medium text-[#1a6b4a]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2d9e6b]" />
          Live
        </div>
        <button
          aria-label="Close Birdie"
          className="grid h-6 w-6 place-items-center rounded-md text-[#76766f] hover:bg-[#f4f3ef]"
          onClick={onToggle}
          type="button"
        >
          <X size={12} />
        </button>
      </header>

      {/* Tabs + content */}
      <BirdiePanelBody matterId={matterId} onOpenSettings={onOpenSettings} pageContext={pageContext} />
      <button
        type="button"
        aria-label="Resize Birdie (drag or use arrow keys)"
        title="Drag to resize"
        className="absolute bottom-0 right-0 hidden h-5 w-5 lg:grid touch-none cursor-nwse-resize place-items-center text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2d9e6b]"
        onPointerDown={(event) => startInteraction(event, 'resize')}
        onKeyDown={(event) => {
          const deltas: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
          const delta = deltas[event.key]
          if (!delta) return
          event.preventDefault()
          setFrame((current) => clampBirdieFrame({ ...current, width: current.width + delta[0], height: current.height + delta[1] }, window.innerWidth, (window.visualViewport?.height ?? window.innerHeight)))
        }}
      >
        <MoveDiagonal size={12} />
      </button>
    </div>
  )
}

function BirdiePanelBody({
  matterId,
  pageContext,
  onOpenSettings,
}: {
  matterId: string | null
  pageContext?: BirdiePageContext
  onOpenSettings?: () => void
}) {
  const [activeTab, setActiveTab] = useState<MentorTab>('ask')
  const [pendingPrompt, setPendingPrompt] = useState<{ id: string; text: string } | null>(null)
  const pickedTabRef = useRef(false)

  const lessonsQuery = useQuery({ queryKey: ['birdieLessons'], queryFn: listBirdieLessons })
  const rounds = lessonsQuery.data ?? []

  // Open on Review when there is feedback whose lessons haven't been drawn up yet.
  const hasNewFeedback = rounds.some((round) => round.lessons.length === 0)
  useEffect(() => {
    if (hasNewFeedback && !pickedTabRef.current) setActiveTab('review')
  }, [hasNewFeedback])

  function selectTab(tab: MentorTab) {
    pickedTabRef.current = true
    setActiveTab(tab)
  }

  function explain(text: string) {
    pickedTabRef.current = true
    setPendingPrompt({ id: crypto.randomUUID(), text })
    setActiveTab('ask')
  }

  return (
    <>
      <nav className="flex shrink-0 border-b border-black/10">
        {(['ask', 'review', 'examples', 'progress'] as MentorTab[]).map((tab) => (
          <button
            key={tab}
            className={`flex-1 border-b-2 py-1.5 text-[10.5px] font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'border-[#2d9e6b] text-[#0f0f0f]'
                : 'border-transparent text-[#76766f] hover:text-[#5a5a56]'
            }`}
            onClick={() => selectTab(tab)}
            type="button"
          >
            {tab}
            {tab === 'review' && hasNewFeedback && (
              <span aria-label="New feedback" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#2d9e6b] align-middle" />
            )}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Ask stays mounted so the conversation survives tab switches. */}
        <div className={activeTab === 'ask' ? 'h-full' : 'hidden'}>
          <AskTab
            matterId={matterId}
            onOpenSettings={onOpenSettings}
            onPromptConsumed={() => setPendingPrompt(null)}
            pageContext={pageContext}
            pendingPrompt={pendingPrompt}
          />
        </div>
        {activeTab === 'review' && (
          <ReviewTab
            error={lessonsQuery.error}
            isLoading={lessonsQuery.isLoading}
            onExplain={explain}
            rounds={rounds}
          />
        )}
        {activeTab === 'examples' && <ExamplesTab matterId={matterId} />}
        {activeTab === 'progress' && <ProgressTab />}
      </div>
    </>
  )
}

function ReviewTab({
  rounds,
  isLoading,
  error,
  onExplain,
}: {
  rounds: FeedbackRound[]
  isLoading: boolean
  error: unknown
  onExplain: (prompt: string) => void
}) {
  return (
    <div className="app-scroll-region h-full overflow-y-auto p-3 space-y-4">
      {isLoading && <div className="text-xs text-[#76766f]">Loading feedback...</div>}
      {error != null && (
        <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-[11px] text-[#8a1f1f]">
          {getErrorMessage(error, 'Could not load reviewer feedback.')}
        </div>
      )}
      {!isLoading && error == null && rounds.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-black/15 px-3 py-3 text-[11.5px] leading-5 text-[#8c8c86]">
          Feedback from your reviewers will appear here after a review is returned.
        </div>
      )}
      {rounds.map((round) => (
        <RoundGroup key={round.handoffId} onExplain={onExplain} round={round} />
      ))}
      {rounds.length === 0 &&
        STARTER_CARDS.map((card) => <ReviewCard key={card.id} card={card} />)}
    </div>
  )
}

function explainPrompt(documentName: string, a: LessonAnnotation): string {
  const parts = [
    `Explain this feedback from my reviewer on "${documentName}" (p.${a.pageNo}).`,
    `They flagged: "${a.anchorQuote}".`,
  ]
  if (a.suggestedText) parts.push(`They suggested: "${a.suggestedText}".`)
  if (a.note) parts.push(`Their note: "${a.note}".`)
  parts.push('Why does it matter, and what should I do next time?')
  return parts.join(' ')
}

function RoundGroup({ round, onExplain }: { round: FeedbackRound; onExplain: (prompt: string) => void }) {
  const queryClient = useQueryClient()
  const distill = useMutation({
    mutationFn: () => distillBirdieLessons(round.handoffId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['birdieLessons'] }),
  })
  const startedRef = useRef(false)
  const needsLessons = round.lessons.length === 0

  useEffect(() => {
    if (needsLessons && !startedRef.current) {
      startedRef.current = true
      distill.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLessons])

  const meta = [
    round.reviewerName ? `Reviewed by ${round.reviewerName}` : 'Reviewed',
    new Date(round.date).toLocaleDateString(),
  ].join(' · ')

  return (
    <section>
      <div className="mb-2">
        <div className="truncate text-[11.5px] font-semibold text-[#0f0f0f]">{round.documentName}</div>
        <div className="text-[11px] text-[#76766f]">{meta}</div>
      </div>

      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">Lessons</div>
      <div className="mb-3 space-y-2">
        {round.lessons.map((lesson) => (
          <LessonCard key={lesson.id} lesson={lesson} />
        ))}
        {needsLessons && distill.isPending && (
          <div className="text-[11px] text-[#76766f]">Distilling lessons…</div>
        )}
        {needsLessons && distill.isError && (
          <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-[11px] text-[#8a1f1f]">
            {getErrorMessage(distill.error, 'Could not draw up lessons.')}{' '}
            <button className="font-medium underline" onClick={() => distill.mutate()} type="button">
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">Comments</div>
      <div className="space-y-2">
        {round.annotations.map((a) => (
          <CommentCard
            key={a.id}
            annotation={a}
            onExplain={() => onExplain(explainPrompt(round.documentName, a))}
          />
        ))}
      </div>
    </section>
  )
}

function LessonCard({ lesson }: { lesson: BirdieLesson }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#1a4a8a]/15">
      <div className="flex items-center gap-1.5 border-b border-[#1a4a8a]/15 bg-[#e8f0fe] px-3 py-2 text-[11px] font-medium text-[#1a4a8a]">
        <Lightbulb size={11} />
        <span className="truncate">{lesson.title}</span>
      </div>
      <div className="px-3 py-2.5 text-[11.5px] leading-[1.6] text-[#5a5a56]">{lesson.body}</div>
    </div>
  )
}

function CommentCard({ annotation, onExplain }: { annotation: LessonAnnotation; onExplain: () => void }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-black/10">
      <div className="space-y-1.5 px-3 py-2.5 text-[11.5px] leading-[1.6]">
        <div className="italic text-[#8c8c86]" style={{ fontFamily: 'Georgia, serif' }}>
          “{annotation.anchorQuote}”
        </div>
        {annotation.suggestedText && (
          <div className="text-[#1a6b4a]">
            <span className="font-medium">Suggested: </span>
            {annotation.suggestedText}
          </div>
        )}
        {annotation.note && <div className="text-[#5a5a56]">{annotation.note}</div>}
      </div>
      <div className="flex items-center justify-between border-t border-black/5 px-3 py-1.5">
        <span className="text-[11px] text-[#76766f]">Page {annotation.pageNo}</span>
        <button
          className="text-[10.5px] font-medium text-[#1a6b4a] hover:underline"
          onClick={onExplain}
          type="button"
        >
          Explain this
        </button>
      </div>
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
        <div className="px-3 pb-2 text-[11px] text-[#76766f]">{card.source}</div>
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
    return <div className="p-3 text-xs text-[#76766f]">Loading examples...</div>
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
          <BookMarked size={20} className="mx-auto text-[#8a8a84]" />
          <p className="mt-2 text-xs text-[#8c8c86]">No Knowledge Bank entries yet.</p>
          <p className="mt-1 text-[11px] text-[#76766f]">Upload documents and add them to the Knowledge Bank.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-scroll-region h-full overflow-y-auto p-3 space-y-4">
      {styleGuides.length > 0 && (
        <section>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#76766f]">
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
      <div className="flex items-center gap-1.5 bg-[#eeecff] px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#4a3db0]">
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
          className="mt-1.5 text-[11px] text-[#4a3db0] hover:underline"
          onClick={() => setExpanded((e) => !e)}
          type="button"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      </div>
      <div className="px-3 pb-2 text-[11px] text-[#76766f]">
        {entry.scope.replace('_', '-')} · v{entry.version}
      </div>
    </div>
  )
}

type BirdieMsg = { id: string; role: 'user' | 'assistant'; body: string }

const STARTERS = [
  'Show my Workboard progress for this matter.',
  'How do I raise a workload concern with my supervisor?',
  'What does reasonable endeavours actually require?',
  'How can I handle feedback I disagree with?',
  "What's the right way to ask for guidance without looking junior?",
]

function AskTab({
  matterId,
  pageContext,
  pendingPrompt,
  onPromptConsumed,
  onOpenSettings,
}: {
  onOpenSettings?: () => void
  matterId: string | null
  pageContext?: BirdiePageContext
  pendingPrompt: { id: string; text: string } | null
  onPromptConsumed: () => void
}) {
  const queryClient = useQueryClient()
  const { choice, setChoice, settings, needsKey } = useModelChoice('lex.birdie.tier', 'birdie')
  const [messages, setMessages] = useState<BirdieMsg[]>([])
  const [prompt, setPrompt] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    abortRef.current?.abort()
  }, [matterId])
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 80)}px`
  }, [prompt])

  async function send(text: string) {
    if (!text.trim() || isResponding) return
    if (needsKey) {
      setError(MISSING_KEY_MESSAGE)
      return
    }
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
    const history = messages.slice(-40).map((m) => ({ role: m.role, content: m.body }))

    try {
      await streamBirdieMessage({
        message: text,
        history,
        matterId,
        pageContext,
        model: choice,
        signal: controller.signal,
        onWorkboardChange: () => {
          void queryClient.invalidateQueries({ queryKey: ['actions'] })
          void queryClient.invalidateQueries({ queryKey: ['resourceMetadata'] })
        },
        onToken: (content) => {
          setMessages((m) =>
            m.map((msg) => (msg.id === draftId ? { ...msg, body: msg.body + content } : msg)),
          )
        },
        onDone: (fullContent) => {
          setMessages((m) =>
            m.map((msg) => (msg.id === draftId ? { ...msg, body: fullContent } : msg)),
          )
          playTweet(1600)
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
      // A mutation may commit just before the browser aborts the stream.
      void queryClient.invalidateQueries({ queryKey: ['actions'] })
      setIsResponding(false)
      abortRef.current = null
    }
  }

  // "Explain this" from the Review tab arrives as a pending prompt; send it once.
  const consumedPromptRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingPrompt || consumedPromptRef.current === pendingPrompt.id || isResponding) return
    consumedPromptRef.current = pendingPrompt.id
    onPromptConsumed()
    void send(pendingPrompt.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt])

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollContainerRef}
        className="app-scroll-region min-h-0 flex-1 select-text overflow-y-auto p-3"
      >
        {messages.length === 0 ? (
          <div className="space-y-2">
            <div className="mb-1 text-[11px] text-[#76766f]">Try asking</div>
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
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-black/10 bg-white p-2">
        <p className="mb-1.5 text-[10px] leading-4 text-[#76766f]">Shared text and your ticket data go to OpenRouter and your chosen model provider.</p>
        <div className="flex items-end gap-1.5 rounded-[10px] border border-black/15 bg-[#f4f3ef] p-1.5 pl-3 focus-within:border-black/30 focus-within:bg-white">
          <textarea
            ref={textareaRef}
            aria-label="Ask Birdie"
            className="min-h-8 max-h-20 flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-[12px] leading-5 text-[#0f0f0f] outline-none placeholder:text-[#8a8a84]"
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
            aria-label="Send message"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-[#1a6b4a] disabled:bg-[#aaa9a3]"
            disabled={!prompt.trim() || isResponding || needsKey}
            onClick={() => send(prompt)}
            type="button"
          >
            <ArrowUp size={13} className="text-white" />
          </button>
        </div>
        <div className="mt-1.5 flex justify-end">
          <ModelPicker
            choice={choice}
            compact
            onChange={setChoice}
            onOpenSettings={onOpenSettings}
            settings={settings}
          />
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
    <div className="app-scroll-region h-full overflow-y-auto p-3 space-y-4">
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
                <span className="w-7 text-right text-[11px] text-[#76766f]">{item.value}%</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
