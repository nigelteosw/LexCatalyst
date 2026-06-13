import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Moon, Plus, Repeat, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '../../shared/ui/Button'
import type {
  AcceptedDreamProposal,
  DreamProposal,
  Memory,
  MemoryCategory,
} from '../../shared/types/workspace'

type Tab = 'additions' | 'merges' | 'updates' | 'drops'

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  semantic: 'Stable fact',
  procedural: 'Working style',
  episodic: 'Session note',
}

type Props = {
  proposal: DreamProposal
  memories: Memory[]
  onCancel: () => void
  onApply: (accepted: AcceptedDreamProposal) => Promise<void>
}

export function DreamReviewDialog({ proposal, memories, onCancel, onApply }: Props) {
  const memoryById = useMemo(() => {
    const map = new Map<string, Memory>()
    for (const m of memories) map.set(m.id, m)
    return map
  }, [memories])

  const [selectedAdditions, setSelectedAdditions] = useState<Set<number>>(
    () => new Set(proposal.additions.map((_, i) => i)),
  )
  const [selectedMerges, setSelectedMerges] = useState<Set<number>>(
    () => new Set(proposal.merges.map((_, i) => i)),
  )
  const [selectedUpdates, setSelectedUpdates] = useState<Set<number>>(
    () => new Set(proposal.updates.map((_, i) => i)),
  )
  const [selectedDrops, setSelectedDrops] = useState<Set<number>>(
    () => new Set(proposal.drops.map((_, i) => i)),
  )
  const [tab, setTab] = useState<Tab>(() => {
    if (proposal.additions.length) return 'additions'
    if (proposal.merges.length) return 'merges'
    if (proposal.updates.length) return 'updates'
    return 'drops'
  })
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEmpty =
    proposal.additions.length +
      proposal.merges.length +
      proposal.updates.length +
      proposal.drops.length ===
    0

  const selectedTotal =
    selectedAdditions.size + selectedMerges.size + selectedUpdates.size + selectedDrops.size

  function toggle(set: Set<number>, updater: (next: Set<number>) => void, idx: number) {
    const next = new Set(set)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    updater(next)
  }

  async function handleApply() {
    setIsApplying(true)
    setError(null)
    try {
      await onApply({
        additions: proposal.additions.filter((_, i) => selectedAdditions.has(i)),
        merges: proposal.merges.filter((_, i) => selectedMerges.has(i)),
        updates: proposal.updates.filter((_, i) => selectedUpdates.has(i)),
        drops: proposal.drops.filter((_, i) => selectedDrops.has(i)),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes')
      setIsApplying(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Plus; count: number }[] = [
    { id: 'additions', label: 'Add', icon: Plus, count: proposal.additions.length },
    { id: 'merges', label: 'Merge', icon: Repeat, count: proposal.merges.length },
    { id: 'updates', label: 'Update', icon: Sparkles, count: proposal.updates.length },
    { id: 'drops', label: 'Drop', icon: Trash2, count: proposal.drops.length },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
              <Moon size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-900">Dream review</h2>
              <p className="text-xs text-neutral-500">
                Reviewed {proposal.reviewedMessageCount} recent messages
              </p>
            </div>
          </div>
          <Button
            aria-label="Close review"
            onClick={onCancel}
            size="icon"
            variant="ghost"
          >
            <X size={18} />
          </Button>
        </header>

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
            <Sparkles size={28} className="text-neutral-400" />
            <h3 className="text-sm font-semibold text-neutral-900">Your memory is already tidy</h3>
            <p className="max-w-sm text-xs text-neutral-500">
              Nothing to consolidate right now. Come back after more chats and we&apos;ll take
              another look.
            </p>
            <Button onClick={onCancel} size="sm" variant="primary">
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-neutral-100 px-4 pt-3">
              {tabs.map((t) => {
                const active = tab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    <t.icon size={14} />
                    {t.label} ({t.count})
                  </button>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {tab === 'additions' && (
                <List
                  items={proposal.additions}
                  empty="No additions proposed."
                  render={(item, i) => (
                    <Row
                      key={i}
                      checked={selectedAdditions.has(i)}
                      onToggle={() =>
                        toggle(selectedAdditions, setSelectedAdditions, i)
                      }
                      title={`Add — ${CATEGORY_LABEL[item.category]}`}
                      proposed={item.content}
                      reason={item.reason}
                    />
                  )}
                />
              )}

              {tab === 'merges' && (
                <List
                  items={proposal.merges}
                  empty="No merges proposed."
                  render={(item, i) => (
                    <Row
                      key={i}
                      checked={selectedMerges.has(i)}
                      onToggle={() => toggle(selectedMerges, setSelectedMerges, i)}
                      title={`Merge ${item.replaceIds.length} memories — ${CATEGORY_LABEL[item.category]}`}
                      proposed={item.content}
                      reason={item.reason}
                      existing={item.replaceIds
                        .map((id) => memoryById.get(id)?.content ?? '(unknown memory)')
                        .map((c) => `• ${c}`)
                        .join('\n')}
                    />
                  )}
                />
              )}

              {tab === 'updates' && (
                <List
                  items={proposal.updates}
                  empty="No updates proposed."
                  render={(item, i) => (
                    <Row
                      key={i}
                      checked={selectedUpdates.has(i)}
                      onToggle={() => toggle(selectedUpdates, setSelectedUpdates, i)}
                      title="Update existing memory"
                      proposed={item.content}
                      reason={item.reason}
                      existing={memoryById.get(item.memoryId)?.content ?? '(unknown memory)'}
                    />
                  )}
                />
              )}

              {tab === 'drops' && (
                <List
                  items={proposal.drops}
                  empty="No drops proposed."
                  render={(item, i) => (
                    <Row
                      key={i}
                      checked={selectedDrops.has(i)}
                      onToggle={() => toggle(selectedDrops, setSelectedDrops, i)}
                      title="Drop memory"
                      proposed={null}
                      reason={item.reason}
                      existing={memoryById.get(item.memoryId)?.content ?? '(unknown memory)'}
                    />
                  )}
                />
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-neutral-100 px-6 py-4">
              <div className="text-xs text-neutral-500">
                {selectedTotal} change{selectedTotal === 1 ? '' : 's'} selected
              </div>
              <div className="flex items-center gap-3">
                {error && <span className="text-xs text-red-600">{error}</span>}
                <Button onClick={onCancel} size="sm" variant="secondary">
                  Cancel
                </Button>
                <Button
                  disabled={isApplying || selectedTotal === 0}
                  onClick={handleApply}
                  size="sm"
                  variant="primary"
                >
                  <Check size={14} />
                  Apply selected
                </Button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function List<T>({
  items,
  empty,
  render,
}: {
  items: T[]
  empty: string
  render: (item: T, index: number) => ReactNode
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center text-xs text-neutral-400">
        {empty}
      </div>
    )
  }
  return <div className="space-y-3">{items.map((item, i) => render(item, i))}</div>
}

function Row({
  checked,
  onToggle,
  title,
  proposed,
  reason,
  existing,
}: {
  checked: boolean
  onToggle: () => void
  title: string
  proposed: string | null
  reason: string
  existing?: string
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-neutral-200 bg-white p-4 hover:border-neutral-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 h-4 w-4 cursor-pointer accent-neutral-900"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </div>
        {existing != null && (
          <div className="rounded-md bg-red-50 p-2 text-xs text-red-900 whitespace-pre-wrap">
            <span className="font-semibold">Current: </span>
            {existing}
          </div>
        )}
        {proposed != null && (
          <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-900 whitespace-pre-wrap">
            <span className="font-semibold">Proposed: </span>
            {proposed}
          </div>
        )}
        <div className="text-xs italic text-neutral-500">Because: {reason}</div>
      </div>
    </label>
  )
}
