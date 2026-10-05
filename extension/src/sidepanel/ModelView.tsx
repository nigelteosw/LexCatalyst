import { useEffect, useState } from 'react'
import {
  type BirdieSettings,
  listOpenRouterModels,
  type OpenRouterModel,
  removeOpenRouterKey,
  saveBirdieSettings,
} from '../lib/api'
import { filterModels } from '../lib/models'

type Props = { settings: BirdieSettings | null; onChange: (s: BirdieSettings) => void; onClose: () => void }

export function ModelView({ settings, onChange, onClose }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(settings?.openRouterModel ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasKey = settings?.hasOpenRouterKey ?? false

  useEffect(() => {
    listOpenRouterModels()
      .then(setModels)
      .catch((err) => setError(String(err)))
  }, [])

  async function run(action: () => Promise<BirdieSettings>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await action())
      setApiKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Birdie model</h2>
        <button className="text-xs underline" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Without your own OpenRouter key, Birdie uses the firm's DeepSeek model. With a key, prompts (including text
        you share) go to OpenRouter and the provider of the model you pick. This setting is shared with the
        LexCatalyst web app.
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-medium">OpenRouter API key</span>
        <input
          type="password"
          className="w-full rounded-md border border-stone-300 p-2"
          placeholder={hasKey ? `Key saved (…${settings?.keyLast4})` : 'sk-or-…'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          className="rounded-md bg-stone-900 px-3 py-1 text-white disabled:opacity-50"
          disabled={busy || (!apiKey && selected === (settings?.openRouterModel ?? null))}
          onClick={() => void run(() => saveBirdieSettings({ apiKey: apiKey || undefined, model: selected }))}
        >
          Save
        </button>
        {hasKey && (
          <button className="text-xs underline" disabled={busy} onClick={() => void run(removeOpenRouterKey)}>
            Remove key
          </button>
        )}
      </div>
      <input
        className="w-full rounded-md border border-stone-300 p-2 disabled:opacity-50"
        placeholder={hasKey || apiKey ? 'Search models' : 'Add a key to choose a model'}
        disabled={!hasKey && !apiKey}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {filterModels(models, query)
          .slice(0, 100)
          .map((model) => (
            <li key={model.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-stone-100">
                <input
                  type="radio"
                  name="model"
                  disabled={!hasKey && !apiKey}
                  checked={selected === model.id}
                  onChange={() => setSelected(model.id)}
                />
                <span className="truncate">{model.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-stone-400">{model.id}</span>
              </label>
            </li>
          ))}
      </ul>
      {error && <p className="text-red-600">{error}</p>}
    </section>
  )
}
