import { useQuery } from '@tanstack/react-query'
import { listActionItems, listMatters } from '../../shared/api/api'
import type { ActionItem, CurrentUser } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { dueLabel, daysUntil } from './format'

const DUE_SOON_DAYS = 7
const MAX_ITEMS = 6

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

const toneClass = {
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  blue: 'bg-blue-50 text-[#1e3a8a]',
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
      <h2 className="flex items-baseline gap-2.5 border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900">
        Needs your attention
        {flagged.length > 0 && <span className="font-sans text-sm text-neutral-400">{flagged.length}</span>}
      </h2>
      {actions.isPending ? (
        <p className="py-6 text-sm text-neutral-400">Loading…</p>
      ) : flagged.length === 0 ? (
        <p className="py-6 text-sm text-neutral-500">Nothing is overdue or waiting on you.</p>
      ) : (
        <div className="divide-y divide-neutral-200/70">
          {flagged.slice(0, MAX_ITEMS).map(({ item, flag }) => {
            const matter = matters.data?.find((m) => m.id === item.matterId)
            return (
              <button
                className="group flex w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-black/[0.025]"
                key={item.id}
                onClick={() => selectActions(item.id)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-neutral-900 group-hover:text-[#1e3a8a]">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-neutral-500">
                    {matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[flag.tone]}`}>
                  {flag.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {flagged.length > MAX_ITEMS && (
        <button
          className="mt-2 text-sm text-[#1e3a8a] hover:underline"
          onClick={() => selectActions()}
          type="button"
        >
          See all {flagged.length} on the Workboard
        </button>
      )}
    </section>
  )
}
