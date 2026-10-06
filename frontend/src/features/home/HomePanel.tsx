import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { listActionItems, listMatters, listChatThreads, getSurveyResults } from '../../shared/api/api'
import type { CurrentUser } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { Button } from '../../shared/ui/Button'
import { AttentionSection } from './AttentionSection'
import { MattersSection } from './MattersSection'
import { RecentDocumentsSection } from './RecentDocumentsSection'
import { daysUntil, formatRelative } from './format'

type Props = {
  currentUser: CurrentUser | null
  matters?: unknown
  onMatterChange: (matterId: string | null) => void
}

export function HomePanel({ currentUser, onMatterChange }: Props) {
  const nav = useWorkspaceNavigation()
  const actions = useQuery({ queryKey: ['actions'], queryFn: listActionItems, staleTime: 30_000 })
  const matters = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters(), staleTime: 60_000 })
  const name = currentUser?.fullName?.split(' ')[0] ?? currentUser?.email?.split('@')[0]
  const open = (actions.data ?? []).filter((item) =>
    item.status !== 'done' && (item.assigneeId === currentUser?.id || item.assignerId === currentUser?.id))
  const due = open.filter((item) => item.assigneeId === currentUser?.id && item.dueDate && daysUntil(item.dueDate) >= 0 && daysUntil(item.dueDate) <= 7).length
  const overdue = open.filter((item) => item.assigneeId === currentUser?.id && item.dueDate && daysUntil(item.dueDate) < 0).length
  const reviews = open.filter((item) => item.assignerId === currentUser?.id && item.status === 'review').length
  const count = (query: { isPending: boolean; isError: boolean }, value: number) => query.isPending ? '…' : query.isError ? '—' : String(value)

  return (
    <div className="app-scroll-region h-full overflow-y-auto bg-page px-4 pb-20 pt-8 sm:px-6 sm:pb-10 lg:px-12 lg:pt-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="t-meta mb-2 text-ink-secondary">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="break-words font-serif text-3xl sm:text-4xl tracking-tight text-ink">{getGreeting()}{name ? `, ${name}` : ''}</h1>
          </div>
          <Button onClick={() => { onMatterChange(null); nav.startNewChat() }} variant="primary">
            <MessageSquare size={16} /> New LexChat
          </Button>
        </header>

        <div className="mt-7 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-card sm:grid-cols-4">
          <Stat value={count(matters, (matters.data ?? []).filter((matter) => matter.status === 'active').length)} label="Active matters" onClick={() => document.getElementById('home-matters')?.scrollIntoView({ block: 'start' })} />
          <Stat value={count(actions, overdue)} label="Overdue" tone={overdue > 0 ? 'danger' : undefined} onClick={() => nav.selectActions()} />
          <Stat value={count(actions, due)} label="Due this week" tone={due > 0 ? 'warning' : undefined} onClick={() => nav.selectActions()} />
          <Stat value={count(actions, reviews)} label="Reviews waiting" tone={reviews > 0 ? 'accent' : undefined} onClick={() => nav.selectActions()} />
        </div>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-10">
          <div className="min-w-0 space-y-8">
            <div className="rounded-lg border border-line bg-card p-4 sm:p-5">
              <AttentionSection currentUser={currentUser} />
            </div>
            <div id="home-matters" className="scroll-mt-6">
              <MattersSection currentUser={currentUser} onMatterChange={onMatterChange} />
            </div>
          </div>
          <aside className="min-w-0 space-y-8">
            <RecentChatsSection onMatterChange={onMatterChange} />
            <RecentDocumentsSection />
            {(currentUser?.isAdmin || currentUser?.firmRole === 'partner') && <WellbeingSummary />}
          </aside>
        </div>
      </div>
    </div>
  )
}

const statTone = { accent: 'text-accent', danger: 'text-danger', warning: 'text-warning' }

function Stat({ value, label, tone, onClick }: { value: string; label: string; tone?: keyof typeof statTone; onClick: () => void }) {
  return (
    <button className="group min-w-0 border-line px-5 py-4 text-left transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent [&:not(:first-child)]:border-l max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t" onClick={onClick} type="button">
      <p className={`text-2xl font-medium tabular-nums ${tone ? statTone[tone] : 'text-ink'}`}>{value}</p>
      <p className="t-meta mt-1 flex items-center gap-1.5 text-ink-secondary">
        {tone && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full bg-current ${statTone[tone]}`} />}
        {label}
      </p>
    </button>
  )
}

function RecentChatsSection({ onMatterChange }: Pick<Props, 'onMatterChange'>) {
  const { selectThread } = useWorkspaceNavigation()
  const threads = useQuery({ queryKey: ['threads', 'all'], queryFn: () => listChatThreads(), staleTime: 30_000 })
  const recent = [...(threads.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
  return (
    <section>
      <h2 className="border-b border-line pb-3 font-serif text-xl text-ink">Continue working</h2>
      {threads.isPending ? <p className="t-body py-5 text-ink-secondary">Loading conversations…</p>
        : threads.isError ? <p className="t-body py-5 text-danger">Could not load conversations.</p>
        : recent.length === 0 ? <p className="t-body py-5 text-ink-secondary">Your recent LexChats will appear here.</p>
        : <div className="divide-y divide-hairline">{recent.map((thread) => (
          <button key={thread.id} type="button" className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-3.5 text-left transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => { onMatterChange(thread.matterId); selectThread(thread.id) }}>
            <MessageSquare size={15} className="mt-0.5 shrink-0 text-ink-tertiary" />
            <span className="min-w-0"><span className="t-body block truncate text-ink group-hover:text-accent">{thread.title}</span><span className="t-meta mt-1 block text-ink-secondary">{formatRelative(thread.updatedAt)}</span></span>
          </button>
        ))}</div>}
    </section>
  )
}

function WellbeingSummary() {
  const { selectWellbeing } = useWorkspaceNavigation()
  const query = useQuery({ queryKey: ['surveyResults'], queryFn: getSurveyResults, staleTime: 60_000, retry: false })
  return <button type="button" onClick={() => selectWellbeing()} className="t-meta w-full border-t border-line pt-4 text-left text-ink-secondary hover:text-accent">Team wellbeing <span className="float-right">{query.isPending ? '…' : query.isError ? 'Unavailable' : `${query.data?.currentCohortSize ?? 0} responses`} →</span></button>
}

function getGreeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}
