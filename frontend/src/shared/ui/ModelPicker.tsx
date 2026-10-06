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
  const [menuRight, setMenuRight] = useState(0)
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
        className="t-body inline-flex h-8 items-center rounded-md bg-warning-tint px-2.5 font-medium text-warning hover:bg-warning-tint/70"
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
        className={`t-body inline-flex items-center gap-1.5 rounded-md border border-line bg-card hover:bg-fill ${
          compact ? 'h-7 px-2' : 'h-8 px-2.5'
        }`}
        onClick={() => {
          setMenuRight(Math.min(0, (rootRef.current?.getBoundingClientRect().right ?? 264) - 264))
          setOpen((o) => !o)
        }}
        type="button"
      >
        <span className="font-medium text-ink">{current.label}</span>
        {current.modelName && (
          <span className="max-w-[9rem] truncate text-ink-secondary">{current.modelName}</span>
        )}
        <ChevronDown size={12} strokeWidth={1.5} className="text-ink-tertiary" />
      </button>

      {open && (
        <div
          className={`absolute z-50 max-h-[45dvh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[10px] border border-line bg-card p-1 shadow-[0_16px_48px_oklch(0.2_0.01_260/0.18)] ${menuPos}`}
          style={{ right: menuRight }}
          role="listbox"
        >
          {TIERS.map(({ tier, label }) => {
            const id = settings?.models[tier]
            const selected = choice.tier === tier
            return (
              <button
                aria-selected={selected}
                className="t-body flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-fill"
                key={tier}
                onClick={() => pick({ tier })}
                role="option"
                type="button"
              >
                <span className="font-medium text-ink">{label}</span>
                <span className="min-w-0 flex-1 truncate text-ink-secondary">
                  {id ? shortModelName(id, modelsQuery.data?.find((m) => m.id === id)?.name) : ''}
                </span>
                {selected && <Check size={12} strokeWidth={1.5} className="text-accent" />}
              </button>
            )
          })}
          <div className="my-1 border-t border-hairline" />
          {searching ? (
            <div className="p-1">
              <input
                autoFocus
                className="t-body h-8 w-full rounded-md border border-line-strong px-2 outline-none focus:border-accent"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={modelsQuery.isLoading ? 'Loading models…' : 'Search OpenRouter models'}
                value={query}
              />
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      className="t-body flex w-full flex-col rounded-md px-2 py-1 text-left hover:bg-fill"
                      onClick={() => pick({ model: m.id })}
                      type="button"
                    >
                      <span className="truncate text-ink">{m.name}</span>
                      <span className="t-meta truncate text-ink-secondary">
                        {m.id}
                        {m.promptPricePerMillion != null ? ` · $${m.promptPricePerMillion}/M in` : ''}
                      </span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && !modelsQuery.isLoading && (
                  <li className="t-meta px-2 py-1.5 text-ink-secondary">No models match.</li>
                )}
              </ul>
            </div>
          ) : (
            <button
              className="t-body flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-ink-secondary hover:bg-fill"
              onClick={() => setSearching(true)}
              type="button"
            >
              Other model…
              {choice.model && <Check size={12} strokeWidth={1.5} className="ml-auto text-accent" />}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
