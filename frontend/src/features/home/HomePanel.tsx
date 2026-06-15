import { useQuery } from '@tanstack/react-query'
import {
  BookMarked,
  Brain,
  CheckSquare,
  ClipboardList,
  FileText,
  GitBranch,
  MessageSquare,
  Settings,
  Users,
  Clock,
  ArrowRight,
  Loader2,
  Heart,
  AlertCircle,
} from 'lucide-react'
import {
  getReviewsWaitingCount,
  listActionItems,
  listChatThreads,
  listDocuments,
  getSurveyResults,
} from '../../shared/api/api'
import type { CurrentUser, ActionItem } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { isManager } from '../actions/config'

type Props = {
  currentUser: CurrentUser | null
  matters: { id: string; title: string; caseNumber: string | null }[]
  onMatterChange: (matterId: string | null) => void
}

// ---------------------------------------------------------------------------
// Feature registry
// ---------------------------------------------------------------------------

const FEATURES = [
  { icon: MessageSquare, label: 'Chat',         description: 'Ask the AI anything',           nav: 'chat'     },
  { icon: FileText,      label: 'Documents',    description: 'Upload & search PDFs',           nav: 'documents'},
  { icon: BookMarked,    label: 'Knowledge',    description: 'Precedents & playbooks',         nav: 'knowledge'},
  { icon: CheckSquare,   label: 'Workboard',    description: 'Track & delegate work',          nav: 'actions'  },
  { icon: Brain,         label: 'Memory',       description: 'Your personal AI context',       nav: 'memories' },
  { icon: GitBranch,     label: 'Lex-Wiki',     description: 'AI-generated matter maps',       nav: 'wiki'     },
  { icon: ClipboardList, label: 'Wellbeing',    description: 'Weekly team check-in',           nav: 'wellbeing'},
  { icon: Settings,      label: 'Settings',     description: 'Profile & team roster',          nav: 'settings' },
] as const

type NavKey = typeof FEATURES[number]['nav']

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HomePanel({ currentUser, matters, onMatterChange }: Props) {
  const nav = useWorkspaceNavigation()
  const isPartnerOrAdmin = currentUser?.isAdmin || currentUser?.firmRole === 'partner'
  const isSeniorOrAbove = isManager(currentUser)
  const name = currentUser?.fullName ?? currentUser?.email?.split('@')[0] ?? 'Welcome'

  function navigate(key: NavKey) {
    if (key === 'chat') nav.startNewChat()
    else if (key === 'documents') nav.selectDocuments()
    else if (key === 'knowledge') nav.selectKnowledgeBank()
    else if (key === 'actions') nav.selectActions()
    else if (key === 'memories') nav.selectMemories()
    else if (key === 'wiki') nav.selectWiki()
    else if (key === 'wellbeing') nav.selectWellbeing()
    else if (key === 'settings') nav.selectSettings()
  }

  return (
    <div className="app-scroll-region h-full overflow-y-auto bg-white">

      {/* ------------------------------------------------------------------ */}
      {/* Hero — dark, authoritative */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-b border-black/[0.07] bg-[#0f0f0f] px-6 py-8 sm:px-10 lg:px-16">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
          {getGreeting()} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="font-serif text-2xl italic tracking-tight text-white sm:text-3xl">
          {name}
        </h1>
        <p className="mt-1 text-xs text-white/40">{roleLabel(currentUser)}</p>

        {/* Inline stat strip */}
        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          <ReviewsStat onClick={() => nav.selectActions()} />
          <OpenTicketsStat currentUser={currentUser} onClick={() => nav.selectActions()} />
          {isPartnerOrAdmin && <WellbeingStat onClick={() => nav.selectWellbeing()} />}
          {isSeniorOrAbove && !isPartnerOrAdmin && (
            <DelegatedStat currentUser={currentUser} onClick={() => nav.selectActions()} />
          )}
          {!isSeniorOrAbove && <DocsStat onClick={() => nav.selectDocuments()} />}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Body */}
      {/* ------------------------------------------------------------------ */}
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 lg:px-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">

          {/* Left — features + matters */}
          <div className="space-y-10">

            {/* Feature list */}
            <section>
              <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                Workspace
              </h2>
              <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
                {FEATURES.map(({ icon: Icon, label, description, nav: navKey }) => (
                  <button
                    key={label}
                    className="group flex w-full items-center gap-4 py-3.5 text-left transition-colors hover:bg-neutral-50"
                    onClick={() => navigate(navKey)}
                    type="button"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 transition group-hover:text-neutral-700">
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-neutral-900">{label}</span>
                      <span className="ml-2.5 text-xs text-neutral-400">{description}</span>
                    </div>
                    <ArrowRight
                      size={13}
                      className="mr-1 shrink-0 text-neutral-200 transition group-hover:translate-x-0.5 group-hover:text-neutral-400"
                    />
                  </button>
                ))}
              </div>
            </section>

            {/* Matters */}
            {matters.length > 0 && (
              <section>
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                    Matters
                  </h2>
                  <span className="text-[11px] text-neutral-300">{matters.length}</span>
                </div>
                <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
                  {matters.slice(0, 8).map((m) => (
                    <button
                      key={m.id}
                      className="group flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-neutral-50"
                      onClick={() => { onMatterChange(m.id); nav.selectKnowledgeBank() }}
                      type="button"
                    >
                      <span className="w-14 shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-300">
                        {m.caseNumber ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 group-hover:text-neutral-900">
                        {m.title}
                      </span>
                      <ArrowRight size={12} className="shrink-0 text-neutral-200 transition group-hover:translate-x-0.5 group-hover:text-neutral-400" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Right — recent conversations */}
          <aside>
            <RecentThreadsSection onClick={(id) => nav.selectThread(id)} />
          </aside>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline stat components — text-only, no card chrome
// ---------------------------------------------------------------------------

function Stat({
  value,
  label,
  active,
  onClick,
}: {
  value: string
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      className="text-left transition-opacity hover:opacity-60"
      onClick={onClick}
      type="button"
    >
      <p className={`text-xl font-semibold tabular-nums leading-none ${active ? 'text-white' : 'text-white/50'}`}>
        {value}
      </p>
      <p className="mt-1.5 text-[10px] uppercase tracking-[0.1em] text-white/25">{label}</p>
    </button>
  )
}

function ReviewsStat({ onClick }: { onClick: () => void }) {
  const q = useQuery({ queryKey: ['reviewsWaiting'], queryFn: getReviewsWaitingCount, staleTime: 30_000 })
  const count = q.data ?? 0
  return <Stat value={q.isPending ? '…' : String(count)} label="Reviews waiting" active={count > 0} onClick={onClick} />
}

function OpenTicketsStat({ currentUser, onClick }: { currentUser: CurrentUser | null; onClick: () => void }) {
  const q = useQuery({ queryKey: ['actions'], queryFn: listActionItems, staleTime: 30_000 })
  const open = (q.data ?? []).filter(
    (a: ActionItem) =>
      (a.assigneeId === currentUser?.id || a.assignerId === currentUser?.id) &&
      a.status !== 'done',
  )
  return <Stat value={q.isPending ? '…' : String(open.length)} label="Open tickets" active={open.length > 0} onClick={onClick} />
}

function DelegatedStat({ currentUser, onClick }: { currentUser: CurrentUser | null; onClick: () => void }) {
  const q = useQuery({ queryKey: ['actions'], queryFn: listActionItems, staleTime: 30_000 })
  const mine = (q.data ?? []).filter(
    (a: ActionItem) => a.assignerId === currentUser?.id && a.status !== 'done',
  )
  return <Stat value={q.isPending ? '…' : String(mine.length)} label="Delegated open" active={mine.length > 0} onClick={onClick} />
}

function WellbeingStat({ onClick }: { onClick: () => void }) {
  const q = useQuery({ queryKey: ['surveyResults'], queryFn: getSurveyResults, staleTime: 60_000, retry: false })
  const cohortOk = !q.isError && q.data?.currentCohortSize != null
  const value = q.isPending ? '…' : cohortOk ? String(q.data!.currentCohortSize) : '0'
  return <Stat value={value} label="Wellbeing responses" active={cohortOk} onClick={onClick} />
}

function DocsStat({ onClick }: { onClick: () => void }) {
  const q = useQuery({ queryKey: ['documents'], queryFn: listDocuments, staleTime: 30_000 })
  const count = q.data?.length ?? 0
  return <Stat value={q.isPending ? '…' : String(count)} label="Documents" active={count > 0} onClick={onClick} />
}

// ---------------------------------------------------------------------------
// Recent conversations
// ---------------------------------------------------------------------------

function RecentThreadsSection({ onClick }: { onClick: (threadId: string) => void }) {
  const q = useQuery({ queryKey: ['chatThreads'], queryFn: listChatThreads, staleTime: 30_000 })
  const threads = (q.data ?? []).slice(0, 8)

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
          Recent conversations
        </h2>
        {q.isPending && <Loader2 size={12} className="animate-spin text-neutral-300" />}
      </div>

      {threads.length === 0 && !q.isPending ? (
        <p className="py-6 text-center text-xs text-neutral-300">No conversations yet</p>
      ) : (
        <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
          {threads.map((t) => (
            <button
              key={t.id}
              className="group flex w-full items-start gap-2 py-3 text-left transition-colors hover:bg-neutral-50"
              onClick={() => onClick(t.id)}
              type="button"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-700 group-hover:text-neutral-900">{t.title}</p>
                <p className="mt-0.5 text-[10px] text-neutral-300">{formatRelative(t.updatedAt)}</p>
              </div>
              <ArrowRight size={12} className="mt-1 shrink-0 text-neutral-200 transition group-hover:translate-x-0.5 group-hover:text-neutral-400" />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function roleLabel(user: CurrentUser | null) {
  if (!user) return ''
  if (user.isAdmin) return 'Admin'
  const map: Record<string, string> = {
    partner: 'Partner',
    senior_associate: 'Senior Associate',
    associate: 'Associate',
  }
  return map[user.firmRole] ?? user.firmRole
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
