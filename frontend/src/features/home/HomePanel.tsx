import { useQuery } from '@tanstack/react-query'
import { listActionItems, getSurveyResults } from '../../shared/api/api'
import type { CurrentUser, ActionItem } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { isManager } from '../actions/config'
import { AttentionSection } from './AttentionSection'
import { MattersSection } from './MattersSection'
import { RecentDocumentsSection } from './RecentDocumentsSection'

type Props = {
  currentUser: CurrentUser | null
  /** Kept for the shell's prop contract; the matters list loads its own data. */
  matters?: unknown
  onMatterChange: (matterId: string | null) => void
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HomePanel({ currentUser, onMatterChange }: Props) {
  const nav = useWorkspaceNavigation()
  const isPartnerOrAdmin = currentUser?.isAdmin || currentUser?.firmRole === 'partner'
  const isSeniorOrAbove = isManager(currentUser)
  const name = currentUser?.fullName ?? currentUser?.email?.split('@')[0] ?? 'Welcome'

  return (
    <div className="app-scroll-region h-full overflow-y-auto bg-surface px-5 pb-10 pt-14 lg:px-12 lg:pt-20">
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-sm text-neutral-500">
          {getGreeting()} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="break-words font-serif text-4xl tracking-tight text-neutral-950">{name}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-neutral-500">{roleLabel(currentUser)}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <ReviewsStat currentUser={currentUser} onClick={() => nav.selectActions()} />
          <OpenTicketsStat currentUser={currentUser} onClick={() => nav.selectActions()} />
          {isPartnerOrAdmin && <WellbeingStat onClick={() => nav.selectWellbeing()} />}
          {isSeniorOrAbove && !isPartnerOrAdmin && (
            <DelegatedStat currentUser={currentUser} onClick={() => nav.selectActions()} />
          )}
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-5xl">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)] xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <MattersSection currentUser={currentUser} onMatterChange={onMatterChange} />
          </div>
          <aside className="min-w-0 space-y-9">
            <AttentionSection currentUser={currentUser} />
            <RecentDocumentsSection />
          </aside>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary statistics
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
      className="min-w-36 flex-1 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-left transition-colors hover:border-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a] sm:flex-none"
      onClick={onClick}
      type="button"
    >
      <p className={`text-xl font-semibold tabular-nums leading-none ${active ? 'text-[#1e3a8a]' : 'text-neutral-500'}`}>
        {value}
      </p>
      <p className="mt-1.5 text-xs text-neutral-500">{label}</p>
    </button>
  )
}

function ReviewsStat({ currentUser, onClick }: { currentUser: CurrentUser | null; onClick: () => void }) {
  const q = useQuery({ queryKey: ['actions'], queryFn: listActionItems, staleTime: 30_000 })
  const count = (q.data ?? []).filter(
    (a: ActionItem) => a.assignerId === currentUser?.id && a.status === 'review',
  ).length
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
