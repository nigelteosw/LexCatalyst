import type { ReactNode } from 'react'
import { Folder } from 'lucide-react'
import type { ChatThread, Matter } from '../../shared/types/workspace'

export type MatterGroup = { matter: Matter | null; threads: ChatThread[] }

/** Matters ordered by their most recent thread; matters with no threads are hidden; General last. */
export function groupThreadsByMatter(threads: ChatThread[], matters: Matter[]): MatterGroup[] {
  const byId = new Map(matters.map((m) => [m.id, m]))
  const groups = new Map<string, MatterGroup>()
  const general: MatterGroup = { matter: null, threads: [] }
  // Threads arrive newest first, so insertion order is recency order.
  // A thread whose matter is not in `matters` (closed, or no access) shows under General.
  for (const thread of threads) {
    const matter = thread.matterId ? byId.get(thread.matterId) : undefined
    if (!matter) {
      general.threads.push(thread)
      continue
    }
    const group = groups.get(matter.id) ?? { matter, threads: [] }
    group.threads.push(thread)
    groups.set(matter.id, group)
  }
  return [...groups.values(), general]
}

export function ChatsByMatter({
  threads,
  matters,
  renderThread,
  onSelectMatter,
}: {
  threads: ChatThread[]
  matters: Matter[]
  renderThread: (thread: ChatThread) => ReactNode
  onSelectMatter: (matterId: string | null) => void
}) {
  const groups = groupThreadsByMatter(threads, matters)
  return (
    <div className="space-y-2.5">
      <div className="t-label px-2.5 uppercase text-ink-tertiary">Chats by matter</div>
      {groups.map(({ matter, threads: groupThreads }) => (
        <section key={matter?.id ?? 'general'} aria-label={matter ? matter.title : 'General'}>
          <button
            type="button"
            onClick={() => onSelectMatter(matter?.id ?? null)}
            title={matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
            className="t-meta-strong flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-ink hover:bg-fill-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Folder size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            {/* Lead with the matter name; the case number stays in the tooltip. */}
            <span className="truncate">{matter ? matter.title || matter.caseNumber : 'General'}</span>
          </button>
          <div className="ml-[16px] space-y-px border-l border-line pl-1.5">
            {groupThreads.length > 0 ? (
              groupThreads.map(renderThread)
            ) : (
              <div className="t-meta px-2 py-1 text-ink-tertiary">No LexChats yet</div>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
