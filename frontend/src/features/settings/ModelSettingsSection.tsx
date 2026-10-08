import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  clearOpenrouterKey,
  updateLlmSettings,
  verifyOpenrouterKey,
} from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import {
  formatContext,
  formatPrice,
  shortModelName,
  useLlmSettings,
  useOpenrouterModels,
} from '../../shared/lib/llm'
import type { LlmKeyStatus, LlmSettings, LlmTier } from '../../shared/types/workspace'
import { ModelCatalogDialog } from './ModelCatalogDialog'

const TIER_LABELS: Record<LlmTier, string> = { high: 'High', mid: 'Mid' }
const TIER_HINTS: Record<LlmTier, string> = {
  high: 'Best quality. Used for drafting, review and memory consolidation by default.',
  mid: 'Faster and cheaper. Used for chat, search and most other features by default.',
}
const MAX_FAVOURITES = 12

const KEY_STATUS: Record<LlmKeyStatus, { label: string; tone: string }> = {
  valid: { label: 'Valid', tone: 'bg-emerald-50 text-emerald-800' },
  invalid: { label: 'Rejected by OpenRouter', tone: 'bg-red-50 text-red-700' },
  unchecked: { label: 'Not checked yet', tone: 'bg-amber-50 text-amber-800' },
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

export function ModelSettingsSection() {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [replacingKey, setReplacingKey] = useState(false)
  const [pickerTier, setPickerTier] = useState<LlmTier | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const settingsQuery = useLlmSettings()
  const settings = settingsQuery.data
  const modelsQuery = useOpenrouterModels()
  const models = modelsQuery.data ?? []

  function onSaved(saved: LlmSettings, text: string) {
    queryClient.setQueryData(['llmSettings'], saved)
    setMessage({ tone: 'ok', text })
  }
  const onError = (error: unknown) => setMessage({ tone: 'error', text: getErrorMessage(error) })

  const saveKeyMutation = useMutation({
    mutationFn: (key: string) => updateLlmSettings({ openrouterApiKey: key }),
    onSuccess: (saved) => {
      setApiKey('')
      setReplacingKey(false)
      onSaved(
        saved,
        saved.keyStatus === 'unchecked'
          ? 'Key saved. OpenRouter could not be reached to check it; use Check key later.'
          : 'Key saved and checked.',
      )
    },
    onError,
  })

  const verifyMutation = useMutation({
    mutationFn: verifyOpenrouterKey,
    onSuccess: (saved) =>
      onSaved(
        saved,
        saved.keyStatus === 'valid'
          ? 'Key is valid.'
          : saved.keyStatus === 'invalid'
            ? 'OpenRouter rejected this key. Replace it to keep using AI features.'
            : 'OpenRouter could not be reached. Try again shortly.',
      ),
    onError,
  })

  const removeKeyMutation = useMutation({
    mutationFn: clearOpenrouterKey,
    onSuccess: (saved) => onSaved(saved, 'Key removed.'),
    onError,
  })

  const modelMutation = useMutation({
    mutationFn: ({ tier, model }: { tier: LlmTier; model: string | null }) =>
      updateLlmSettings(tier === 'high' ? { modelHigh: model } : { modelMid: model }),
    onSuccess: (saved, { tier }) => onSaved(saved, `${TIER_LABELS[tier]} model updated.`),
    onError,
  })

  const favouriteMutation = useMutation({
    mutationFn: (favouriteModels: string[]) => updateLlmSettings({ favouriteModels }),
    onSuccess: (saved) => queryClient.setQueryData(['llmSettings'], saved),
    onError,
  })

  const tierMutation = useMutation({
    mutationFn: (featureTiers: Record<string, LlmTier>) => updateLlmSettings({ featureTiers }),
    onSuccess: (saved) => onSaved(saved, 'Feature tiers saved.'),
    onError,
  })

  const keyTooShort = apiKey.length > 0 && apiKey.trim().length < 10
  const keyLooksWrong = apiKey.trim().length >= 10 && !apiKey.trim().startsWith('sk-or-')
  const canSaveKey = apiKey.trim().length >= 10 && !keyLooksWrong && !saveKeyMutation.isPending
  const keyBusy = saveKeyMutation.isPending || verifyMutation.isPending || removeKeyMutation.isPending

  function setTier(featureKey: string, tier: LlmTier) {
    if (!settings) return
    tierMutation.mutate({ ...settings.featureTiers, [featureKey]: tier })
  }

  function resetTiers() {
    if (!settings) return
    tierMutation.mutate(Object.fromEntries(settings.features.map((f) => [f.key, f.defaultTier])))
  }

  // Picking the environment default stores "no override", so the default keeps following config.
  function pickModel(tier: LlmTier, id: string) {
    const isDefault = settings ? id === settings.defaultModels[tier] : false
    modelMutation.mutate({ tier, model: isDefault ? null : id })
    setPickerTier(null)
  }

  function toggleFavourite(id: string) {
    if (!settings) return
    const current = settings.favouriteModels
    if (current.includes(id)) {
      favouriteMutation.mutate(current.filter((m) => m !== id))
    } else if (current.length >= MAX_FAVOURITES) {
      setMessage({ tone: 'error', text: `You can star up to ${MAX_FAVOURITES} models. Unstar one first.` })
    } else {
      favouriteMutation.mutate([id, ...current])
    }
  }

  const modelLookup = (id: string) => models.find((m) => m.id === id)
  const showKeyForm = !settings?.hasKey || settings.keySource === 'demo' || replacingKey
  const status = settings?.keyStatus ?? null
  const verifiedAt = formatDate(settings?.keyVerifiedAt ?? null)

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-[#0f0f0f]">AI models</h3>

      {/* Key */}
      <section aria-label="OpenRouter key" className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold text-[#0f0f0f]">OpenRouter key</h4>
          {settings?.keySource === 'user' && status && (
            <span className={`rounded-full px-2 py-0.5 text-meta font-medium ${KEY_STATUS[status].tone}`}>
              {KEY_STATUS[status].label}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-5 text-[#6f6f69]">
          {settings?.keySource === 'user'
            ? `Using your key ${settings.keyLabel ? `(${settings.keyLabel})` : `ending …${settings.keyLast4}`}.`
            : settings?.keySource === 'demo'
              ? 'Using the demo key. Add your own key to be billed to your account.'
              : 'No key yet. Add one to use LexChat, Birdie and the other AI features.'}
          {verifiedAt && settings?.keySource === 'user' && ` Last checked ${verifiedAt}.`}
        </p>
        <p className="mt-1 text-meta leading-4 text-[#8c8c86]">
          Your key is encrypted on the server and never shown again. It is only used to call OpenRouter.
        </p>

        {settings?.keySource === 'user' && !showKeyForm && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex h-8 items-center rounded-lg border border-black/15 bg-white px-3 text-xs font-medium text-[#0f0f0f] disabled:opacity-50"
              disabled={keyBusy}
              onClick={() => verifyMutation.mutate()}
              type="button"
            >
              {verifyMutation.isPending ? 'Checking…' : 'Check key'}
            </button>
            <button
              className="inline-flex h-8 items-center rounded-lg border border-black/15 bg-white px-3 text-xs font-medium text-[#0f0f0f] disabled:opacity-50"
              disabled={keyBusy}
              onClick={() => setReplacingKey(true)}
              type="button"
            >
              Replace key
            </button>
            <button
              className="inline-flex h-8 items-center rounded-lg border border-red-100 bg-white px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={keyBusy}
              onClick={() => removeKeyMutation.mutate()}
              type="button"
            >
              Remove key
            </button>
          </div>
        )}

        {showKeyForm && (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (canSaveKey) saveKeyMutation.mutate(apiKey.trim())
            }}
          >
            <label className="block">
              <span className="text-xs font-medium text-[#0f0f0f]">OpenRouter API key</span>
              <input
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-lg border border-black/15 bg-white px-3 text-xs outline-none focus:border-black/40"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-…"
                spellCheck={false}
                type="password"
                value={apiKey}
              />
              {keyTooShort && <span className="mt-1 block text-meta text-red-600">That key looks too short.</span>}
              {keyLooksWrong && (
                <span className="mt-1 block text-meta text-red-600">OpenRouter keys start with sk-or-.</span>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center rounded-lg bg-[#0f0f0f] px-4 text-xs font-medium text-white disabled:opacity-40"
                disabled={!canSaveKey}
                type="submit"
              >
                {saveKeyMutation.isPending ? 'Checking and saving…' : 'Save key'}
              </button>
              {replacingKey && (
                <button
                  className="inline-flex h-9 items-center rounded-lg border border-black/15 bg-white px-4 text-xs font-medium text-[#0f0f0f]"
                  onClick={() => {
                    setReplacingKey(false)
                    setApiKey('')
                  }}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}

        <p className="mt-3 text-meta leading-4 text-[#8c8c86]">
          All AI features send prompts, including document excerpts, Knowledge Bank entries and reviewer feedback,
          to OpenRouter and the model provider behind the model you choose.
        </p>
        {message && (
          <p
            className={`mt-2 text-xs ${message.tone === 'ok' ? 'text-[#1a6b4a]' : 'text-red-600'}`}
            role="status"
          >
            {message.text}
          </p>
        )}
      </section>

      {/* Tier models */}
      {settings && (
        <section aria-label="Tier models" className="mt-6 border-t border-black/10 pt-4">
          <h4 className="text-xs font-semibold text-[#0f0f0f]">Models</h4>
          <ul className="mt-3 space-y-2">
            {(['high', 'mid'] as const).map((tier) => {
              const id = settings.models[tier]
              const info = modelLookup(id)
              const isDefault = !settings.customModels[tier]
              return (
                <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 p-3" key={tier}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#0f0f0f]">{TIER_LABELS[tier]}</span>
                      {isDefault && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-meta text-[#6f6f69]">default</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[#0f0f0f]">
                      {shortModelName(id, info?.name)}
                    </p>
                    <p className="truncate text-meta text-[#8c8c86]">
                      {id}
                      {info
                        ? ` · ${formatContext(info.contextLength)} · ${formatPrice(info.promptPricePerMillion)} in / ${formatPrice(info.completionPricePerMillion)} out`
                        : ''}
                    </p>
                    <p className="mt-0.5 text-meta text-[#8c8c86]">{TIER_HINTS[tier]}</p>
                  </div>
                  <button
                    className="inline-flex h-8 shrink-0 items-center rounded-lg border border-black/15 bg-white px-3 text-xs font-medium text-[#0f0f0f] disabled:opacity-50"
                    disabled={modelMutation.isPending}
                    onClick={() => setPickerTier(tier)}
                    type="button"
                  >
                    Change model
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Feature tiers */}
      {settings && (
        <div className="mt-6 border-t border-black/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-[#0f0f0f]">Feature models</h4>
            <button
              className="text-meta font-medium text-[#6f6f69] underline hover:text-[#0f0f0f] disabled:opacity-40"
              disabled={tierMutation.isPending}
              onClick={resetTiers}
              type="button"
            >
              Reset to defaults
            </button>
          </div>
          <p className="mt-1 text-meta text-[#8c8c86]">
            Choose which tier each feature uses. LexChat and Birdie can also be switched per prompt.
          </p>
          <ul className="mt-3 divide-y divide-black/5">
            {settings.features.map((feature) => {
              const active = settings.featureTiers[feature.key] ?? feature.defaultTier
              const resolved = settings.resolved[feature.key]
              return (
                <li className="flex flex-wrap items-center justify-between gap-3 py-2" key={feature.key}>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-[#0f0f0f]">{feature.label}</span>
                    {resolved && (
                      <span className="block truncate text-meta text-[#8c8c86]">
                        Uses {shortModelName(resolved.model, modelLookup(resolved.model)?.name)}
                      </span>
                    )}
                  </div>
                  <div
                    aria-label={`${feature.label} tier`}
                    className="inline-flex rounded-lg bg-neutral-100 p-0.5"
                    role="group"
                  >
                    {(['high', 'mid'] as const).map((tier) => (
                      <button
                        aria-pressed={active === tier}
                        className={`rounded-md px-3 py-1 text-meta font-medium ${
                          active === tier ? 'bg-white text-[#0f0f0f] shadow-sm' : 'text-[#6f6f69]'
                        }`}
                        disabled={tierMutation.isPending}
                        key={tier}
                        onClick={() => setTier(feature.key, tier)}
                        type="button"
                      >
                        {TIER_LABELS[tier]}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {settings && pickerTier && (
        <ModelCatalogDialog
          busy={modelMutation.isPending || favouriteMutation.isPending}
          currentId={settings.models[pickerTier]}
          defaultId={settings.defaultModels[pickerTier]}
          favourites={settings.favouriteModels}
          isLoading={modelsQuery.isLoading}
          models={models}
          onClose={() => setPickerTier(null)}
          onPick={(id) => pickModel(pickerTier, id)}
          onToggleFavourite={toggleFavourite}
          title={`${TIER_LABELS[pickerTier]} tier model`}
        />
      )}
    </div>
  )
}
