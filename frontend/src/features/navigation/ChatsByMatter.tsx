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
    <div className="space-y-3">
      <div className="px-2.5 text-[11px] font-medium text-white/35">Chats by matter</div>
      {groups.map(({ matter, threads: groupThreads }) => (
        <section key={matter?.id ?? 'general'} aria-label={matter ? matter.title : 'General'}>
          <button
            type="button"
            onClick={() => onSelectMatter(matter?.id ?? null)}
            title={matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-white/85 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <Folder size={14} className="shrink-0 text-white/45" />
            <span className="truncate">
              {matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
            </span>
          </button>
          <div className="ml-[17px] space-y-0.5 border-l border-white/10 pl-2">
            {groupThreads.length > 0 ? (
              groupThreads.map(renderThread)
            ) : (
              <div className="px-2 py-1 text-[11px] text-white/30">No LexChats yet</div>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
