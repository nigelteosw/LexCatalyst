import { useEffect, useMemo, useRef, useState } from 'react'
import { filterModels } from '../lib/models'
import { fetchOpenrouterModels, type LlmSettings, type LlmTier, type ModelChoice, type OpenrouterModel } from '../lib/api'

// Mirrors frontend/src/shared/ui/ModelPicker.tsx (the extension is a separate bundle).

const TIERS: { tier: LlmTier; label: string }[] = [
  { tier: 'high', label: 'High' },
  { tier: 'mid', label: 'Mid' },
]
const STORAGE_KEY = 'lex.birdie.tier'

export function shortModelName(id: string, name?: string): string {
  return (name ?? id).replace(/^[^:]+:\s*/, '').replace(/^[^/]+\//, '').replace(/^Claude\s+/i, '')
}

export function loadSavedChoice(): ModelChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'high' || raw === 'mid') return { tier: raw }
    if (raw && raw.startsWith('model:')) return { model: raw.slice(6) }
  } catch {
    // storage unavailable
  }
  return null
}

export function saveChoice(choice: ModelChoice | null): void {
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, choice.tier ?? `model:${choice.model}`)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage unavailable
  }
}

export function ModelPicker({
  choice,
  settings,
  onChange,
}: {
  choice: ModelChoice
  settings: LlmSettings
  onChange: (choice: ModelChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [models, setModels] = useState<OpenrouterModel[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || models) return
    fetchOpenrouterModels().then(setModels).catch(() => setModels([]))
  }, [open, models])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const matches = useMemo(() => {
    return filterModels(models ?? [], query).slice(0, 40)
  }, [models, query])

  if (!settings.hasKey) {
    return <span className="text-[11px] text-amber-700">Add your OpenRouter key in Settings (LexCatalyst web app)</span>
  }

  const modelId = choice.model ?? settings.models[choice.tier ?? 'mid']
  const label = choice.tier ? (choice.tier === 'high' ? 'High' : 'Mid') : 'Custom'
  const nameOf = (id: string) => shortModelName(id, models?.find((m) => m.id === id)?.name)

  function pick(next: ModelChoice) {
    onChange(next)
    setOpen(false)
    setSearching(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2 text-xs"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium">{label}</span>
        <span className="max-w-[9rem] truncate text-stone-500">{nameOf(modelId)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-10 mb-1 w-60 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
          {TIERS.map(({ tier, label: tierLabel }) => (
            <button
              type="button"
              key={tier}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-stone-100"
              onClick={() => pick({ tier })}
            >
              <span className="font-medium">{tierLabel}</span>
              <span className="min-w-0 flex-1 truncate text-stone-500">{nameOf(settings.models[tier])}</span>
              {choice.tier === tier && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-stone-100" />
          {searching ? (
            <div className="p-1">
              <input
                autoFocus
                className="h-7 w-full rounded-md border border-stone-300 px-2 text-xs"
                placeholder={models ? 'Search OpenRouter models' : 'Loading models…'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ul className="mt-1 max-h-44 overflow-y-auto">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col rounded-md px-2 py-1 text-left text-xs hover:bg-stone-100"
                      onClick={() => pick({ model: m.id })}
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="truncate text-[11px] text-stone-500">
                        {m.id}
                        {m.promptPricePerMillion != null ? ` · $${m.promptPricePerMillion}/M in` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-stone-100"
              onClick={() => setSearching(true)}
            >
              Other model…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
