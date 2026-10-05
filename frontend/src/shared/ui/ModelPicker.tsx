import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { describeModelChoice, shortModelName, useOpenrouterModels } from '../lib/llm'
import type { LlmSettings, LlmTier, ModelChoice } from '../types/workspace'

type ModelPickerProps = {
  choice: ModelChoice
  settings: LlmSettings | undefined
  onChange: (choice: ModelChoice) => void
  onOpenSettings?: () => void
  /** Open the menu upward (composers sit at the bottom of the screen). */
  placement?: 'up' | 'down'
  compact?: boolean
}

const TIERS: { tier: LlmTier; label: string }[] = [
  { tier: 'high', label: 'High' },
  { tier: 'mid', label: 'Mid' },
]

export function ModelPicker({
  choice,
  settings,
  onChange,
  onOpenSettings,
  placement = 'up',
  compact = false,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const modelsQuery = useOpenrouterModels(open || !!choice.model)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = modelsQuery.data ?? []
    return (q ? all.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(q)) : all).slice(0, 40)
  }, [modelsQuery.data, query])

  if (settings && !settings.hasKey) {
    return (
      <button
        className="inline-flex h-8 items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
        onClick={onOpenSettings}
        type="button"
      >
        Add OpenRouter key
      </button>
    )
  }

  const current = describeModelChoice(choice, settings, modelsQuery.data)
  const menuPos = placement === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'

  function pick(next: ModelChoice) {
    onChange(next)
    setOpen(false)
    setSearching(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Model: ${current.label} ${current.modelName ?? ''}`.trim()}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white text-xs hover:bg-neutral-50 ${
          compact ? 'h-7 px-2' : 'h-8 px-2.5'
        }`}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span className="font-medium text-neutral-800">{current.label}</span>
        {current.modelName && (
          <span className="max-w-[9rem] truncate text-neutral-500">{current.modelName}</span>
        )}
        <ChevronDown size={12} className="text-neutral-400" />
      </button>

      {open && (
        <div
          className={`absolute right-0 z-50 w-64 rounded-xl border border-black/10 bg-white p-1 shadow-lg ${menuPos}`}
          role="listbox"
        >
          {TIERS.map(({ tier, label }) => {
            const id = settings?.models[tier]
            const selected = choice.tier === tier
            return (
              <button
                aria-selected={selected}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-neutral-100"
                key={tier}
                onClick={() => pick({ tier })}
                role="option"
                type="button"
              >
                <span className="font-medium text-neutral-800">{label}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">
                  {id ? shortModelName(id, modelsQuery.data?.find((m) => m.id === id)?.name) : ''}
                </span>
                {selected && <Check size={12} className="text-[#1a6b4a]" />}
              </button>
            )
          })}
          <div className="my-1 border-t border-black/5" />
          {searching ? (
            <div className="p-1">
              <input
                autoFocus
                className="h-8 w-full rounded-lg border border-black/15 px-2 text-xs outline-none focus:border-black/40"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={modelsQuery.isLoading ? 'Loading models…' : 'Search OpenRouter models'}
                value={query}
              />
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      className="flex w-full flex-col rounded-lg px-2 py-1 text-left text-xs hover:bg-neutral-100"
                      onClick={() => pick({ model: m.id })}
                      type="button"
                    >
                      <span className="truncate text-neutral-800">{m.name}</span>
                      <span className="truncate text-[11px] text-neutral-500">
                        {m.id}
                        {m.promptPricePerMillion != null ? ` · $${m.promptPricePerMillion}/M in` : ''}
                      </span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && !modelsQuery.isLoading && (
                  <li className="px-2 py-1.5 text-[11px] text-neutral-500">No models match.</li>
                )}
              </ul>
            </div>
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100"
              onClick={() => setSearching(true)}
              type="button"
            >
              Other model…
              {choice.model && <Check size={12} className="ml-auto text-[#1a6b4a]" />}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
