import { useQuery } from '@tanstack/react-query'
import { listActionItems, listMatters } from '../../shared/api/api'
import type { ActionItem, CurrentUser } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import type { StatusTone } from '../../shared/ui/StatusBadge'
import { dueLabel, daysUntil } from './format'

const DUE_SOON_DAYS = 7
const MAX_ITEMS = 4

type Flag = { label: string; tone: 'red' | 'amber' | 'blue'; rank: number }

/** Why an item needs the user's attention now, or null if it does not. Lower rank = more urgent. */
export function attentionFlag(item: ActionItem, userId: string | undefined, now: Date = new Date()): Flag | null {
  if (!userId || item.status === 'done') return null
  if (item.assignerId === userId && item.status === 'review') {
    return { label: 'Ready for your review', tone: 'blue', rank: 0 }
  }
  if (item.assigneeId !== userId) return null
  if (item.dueDate) {
    const days = daysUntil(item.dueDate, now)
    if (days < 0) return { label: dueLabel(days), tone: 'red', rank: 1 }
    if (days <= DUE_SOON_DAYS) return { label: dueLabel(days), tone: 'amber', rank: 2 + days / 100 }
  }
  return null
}

const badgeTone: Record<Flag['tone'], StatusTone> = {
  red: 'danger',
  amber: 'warning',
  blue: 'accent',
}

/** Reviews waiting and work that is overdue or due this week. */
export function AttentionSection({ currentUser }: { currentUser: CurrentUser | null }) {
  const { selectActions } = useWorkspaceNavigation()
  const actions = useQuery({ queryKey: ['actions'], queryFn: listActionItems, staleTime: 30_000 })
  const matters = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters(), staleTime: 60_000 })

  const flagged = (actions.data ?? [])
    .map((item) => ({ item, flag: attentionFlag(item, currentUser?.id) }))
    .filter((entry): entry is { item: ActionItem; flag: Flag } => entry.flag !== null)
    .sort((a, b) => a.flag.rank - b.flag.rank)

  return (
    <section>
      <h2 className="flex items-baseline gap-2.5 border-b border-line pb-3 font-serif text-xl text-ink">
        Needs your attention
        {flagged.length > 0 && <span className="font-sans text-sm text-ink-tertiary">{flagged.length}</span>}
      </h2>
      {actions.isPending ? (
        <p className="py-6 t-body text-ink-tertiary">Loading…</p>
      ) : actions.isError ? (
        <p className="t-body py-6 text-danger">Could not load items needing attention.</p>
      ) : flagged.length === 0 ? (
        <p className="t-body py-6 text-ink-secondary">Nothing is overdue or waiting on you.</p>
      ) : (
        <div className="divide-y divide-hairline">
          {flagged.slice(0, MAX_ITEMS).map(({ item, flag }) => {
            const matter = matters.data?.find((m) => m.id === item.matterId)
            return (
              <button
                className="group -mx-2 flex w-[calc(100%+1rem)] flex-wrap items-start gap-3 rounded-md px-2 py-3.5 text-left transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                key={item.id}
                onClick={() => selectActions(item.id)}
                type="button"
              >
                <span className="min-w-0 basis-40 flex-1">
                  <span className="block truncate text-body text-ink group-hover:text-accent">
                    {item.title}
                  </span>
                  <span className="t-meta mt-0.5 block truncate text-ink-secondary">
                    {matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
                  </span>
                </span>
                <span className="shrink-0">
                  <StatusBadge tone={badgeTone[flag.tone]}>{flag.label}</StatusBadge>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {flagged.length > MAX_ITEMS && (
        <button
          className="t-meta mt-2 font-medium text-accent hover:underline"
          onClick={() => selectActions()}
          type="button"
        >
          See all {flagged.length} on the Workboard
        </button>
      )}
    </section>
  )
}
