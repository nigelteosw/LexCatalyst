import { useMemo, useState } from 'react'
import { Check, Star } from 'lucide-react'
import { Dialog } from '../../shared/ui/Dialog'
import type { OpenrouterModel } from '../../shared/api/api'
import { formatContext, formatPrice, shortModelName } from '../../shared/lib/llm'

const MAX_RESULTS = 150

type ModelCatalogDialogProps = {
  title: string
  models: OpenrouterModel[]
  isLoading: boolean
  currentId: string | null
  defaultId: string
  favourites: string[]
  busy: boolean
  onPick: (id: string) => void
  onToggleFavourite: (id: string) => void
  onClose: () => void
}

export function ModelCatalogDialog({
  title,
  models,
  isLoading,
  currentId,
  defaultId,
  favourites,
  busy,
  onPick,
  onToggleFavourite,
  onClose,
}: ModelCatalogDialogProps) {
  const [query, setQuery] = useState('')
  const [toolsOnly, setToolsOnly] = useState(false)
  const [provider, setProvider] = useState('')

  const providers = useMemo(
    () => Array.from(new Set(models.map((m) => m.provider))).sort((a, b) => a.localeCompare(b)),
    [models],
  )

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models])
  const q = query.trim().toLowerCase()

  const filtered = useMemo(
    () =>
      models.filter(
        (m) =>
          (!toolsOnly || m.supportsTools) &&
          (!provider || m.provider === provider) &&
          (!q || `${m.id} ${m.name}`.toLowerCase().includes(q)),
      ),
    [models, q, provider, toolsOnly],
  )

  const favouriteModels = favourites.map((id) => byId.get(id)).filter((m): m is OpenrouterModel => !!m)
  const shown = filtered.slice(0, MAX_RESULTS)
  const customId = query.trim()
  const offerCustom = customId.includes('/') && !byId.has(customId)

  function row(model: OpenrouterModel) {
    const selected = model.id === currentId
    const starred = favourites.includes(model.id)
    return (
      <li
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${selected ? 'bg-fill' : 'hover:bg-fill'}`}
        key={model.id}
      >
        <button
          aria-label={starred ? `Remove ${model.name} from favourites` : `Add ${model.name} to favourites`}
          aria-pressed={starred}
          className="shrink-0 p-1 text-ink-tertiary hover:text-accent disabled:opacity-40"
          disabled={busy}
          onClick={() => onToggleFavourite(model.id)}
          type="button"
        >
          <Star size={13} strokeWidth={1.5} className={starred ? 'fill-accent text-accent' : ''} />
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-40"
          disabled={busy}
          onClick={() => onPick(model.id)}
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-ink">{model.name}</span>
            <span className="block truncate text-meta text-ink-secondary">{model.id}</span>
          </span>
          <span className="hidden shrink-0 flex-col items-end text-meta text-ink-secondary sm:flex">
            <span>{formatContext(model.contextLength)}</span>
            <span>
              {formatPrice(model.promptPricePerMillion)} in · {formatPrice(model.completionPricePerMillion)} out
            </span>
          </span>
          {!model.supportsTools && (
            <span className="shrink-0 rounded bg-warning-tint px-1.5 py-0.5 text-meta text-warning" title="No tool calling">
              no tools
            </span>
          )}
          {selected && <Check size={13} strokeWidth={1.5} className="shrink-0 text-accent" />}
        </button>
      </li>
    )
  }

  return (
    <Dialog onClose={onClose} title={title} className="max-w-2xl">
      <div className="space-y-3">
        <input
          autoFocus
          aria-label="Search models"
          className="h-9 w-full rounded-lg border border-line-strong bg-card px-3 text-xs outline-none focus:border-accent"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, provider or id"
          spellCheck={false}
          value={query}
        />
        <div className="flex flex-wrap items-center gap-3 text-meta text-ink-secondary">
          <label className="inline-flex items-center gap-1.5">
            <input checked={toolsOnly} onChange={(e) => setToolsOnly(e.target.checked)} type="checkbox" />
            Supports tools (needed for LexChat)
          </label>
          <label className="inline-flex items-center gap-1.5">
            Provider
            <select
              className="h-7 rounded-md border border-line-strong bg-card px-1.5"
              onChange={(e) => setProvider(e.target.value)}
              value={provider}
            >
              <option value="">All</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto">
            {isLoading ? 'Loading models…' : `${filtered.length} model${filtered.length === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="max-h-[55dvh] overflow-y-auto">
          {!q && !provider && !toolsOnly && favouriteModels.length > 0 && (
            <section aria-label="Favourites" className="mb-2">
              <h4 className="px-2 pb-1 text-meta font-semibold uppercase tracking-wide text-ink-tertiary">
                Favourites
              </h4>
              <ul>{favouriteModels.map(row)}</ul>
            </section>
          )}
          <ul>{shown.map(row)}</ul>
          {filtered.length > MAX_RESULTS && (
            <p className="px-2 py-2 text-meta text-ink-secondary">
              Showing the first {MAX_RESULTS}. Refine the search to see more.
            </p>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="px-2 py-3 text-xs text-ink-secondary">No models match.</p>
          )}
          {offerCustom && (
            <button
              className="mt-2 w-full rounded-md border border-dashed border-line-strong px-3 py-2 text-left text-xs text-ink hover:bg-fill disabled:opacity-40"
              disabled={busy}
              onClick={() => onPick(customId)}
              type="button"
            >
              Use <span className="font-medium">{customId}</span> (not in the list)
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <button
            className="text-meta font-medium text-ink-secondary underline hover:text-ink disabled:opacity-40"
            disabled={busy || currentId === defaultId}
            onClick={() => onPick(defaultId)}
            type="button"
          >
            Reset to default ({shortModelName(defaultId, byId.get(defaultId)?.name)})
          </button>
          <button
            className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-white"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    </Dialog>
  )
}
