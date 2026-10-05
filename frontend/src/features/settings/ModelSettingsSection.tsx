import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clearOpenrouterKey, updateLlmSettings } from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import { useLlmSettings, useOpenrouterModels } from '../../shared/lib/llm'
import type { LlmTier } from '../../shared/types/workspace'

const TIER_LABELS: Record<LlmTier, string> = { high: 'High', mid: 'Mid' }

export function ModelSettingsSection() {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [drafts, setDrafts] = useState<{ high?: string; mid?: string }>({})
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const settingsQuery = useLlmSettings()
  const settings = settingsQuery.data
  const modelsQuery = useOpenrouterModels()
  const models = modelsQuery.data ?? []

  function onSaved(saved: NonNullable<typeof settings>, text: string) {
    queryClient.setQueryData(['llmSettings'], saved)
    setMessage({ tone: 'ok', text })
  }
  const onError = (error: unknown) => setMessage({ tone: 'error', text: getErrorMessage(error) })

  const saveMutation = useMutation({
    mutationFn: () =>
      updateLlmSettings({
        openrouterApiKey: apiKey.trim() || undefined,
        modelHigh: drafts.high !== undefined ? drafts.high.trim() || null : undefined,
        modelMid: drafts.mid !== undefined ? drafts.mid.trim() || null : undefined,
      }),
    onSuccess: (saved) => {
      setApiKey('')
      setDrafts({})
      onSaved(saved, 'Model settings saved.')
    },
    onError,
  })

  const tierMutation = useMutation({
    mutationFn: (featureTiers: Record<string, LlmTier>) => updateLlmSettings({ featureTiers }),
    onSuccess: (saved) => onSaved(saved, 'Feature tiers saved.'),
    onError,
  })

  const removeMutation = useMutation({
    mutationFn: clearOpenrouterKey,
    onSuccess: (saved) => onSaved(saved, 'Key removed.'),
    onError,
  })

  const keyTooShort = apiKey.length > 0 && apiKey.trim().length < 10
  const dirty = apiKey.trim().length >= 10 || drafts.high !== undefined || drafts.mid !== undefined
  const canSave = dirty && !keyTooShort && !saveMutation.isPending

  function setTier(featureKey: string, tier: LlmTier) {
    if (!settings) return
    tierMutation.mutate({ ...settings.featureTiers, [featureKey]: tier })
  }

  function resetTiers() {
    if (!settings) return
    tierMutation.mutate(Object.fromEntries(settings.features.map((f) => [f.key, f.defaultTier])))
  }

  const keyStatus =
    settings?.keySource === 'user'
      ? `Using your OpenRouter key (…${settings.keyLast4}).`
      : settings?.keySource === 'demo'
        ? 'Using the demo OpenRouter key. Add your own key to be billed to your account.'
        : 'No OpenRouter key yet. Add one to use LexChat, Birdie and the other AI features.'

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-[#0f0f0f]">AI models</h3>
      <p className="mt-1 text-xs leading-5 text-[#6f6f69]">{keyStatus}</p>
      {settings?.keySource === 'demo' && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          Using demo key
        </p>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) saveMutation.mutate()
        }}
      >
        <label className="block">
          <span className="text-xs font-medium text-[#0f0f0f]">OpenRouter API key</span>
          <input
            autoComplete="off"
            className="mt-1 h-9 w-full rounded-lg border border-black/15 bg-white px-3 text-xs outline-none focus:border-black/40"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={settings?.keySource === 'user' ? 'Enter a new key to replace the saved one' : 'sk-or-…'}
            spellCheck={false}
            type="password"
            value={apiKey}
          />
          {keyTooShort && (
            <span className="mt-1 block text-[11px] text-red-600">That key looks too short.</span>
          )}
        </label>

        {(['high', 'mid'] as const).map((tier) => (
          <label className="block" key={tier}>
            <span className="text-xs font-medium text-[#0f0f0f]">{TIER_LABELS[tier]} tier model</span>
            <input
              autoComplete="off"
              className="mt-1 h-9 w-full rounded-lg border border-black/15 bg-white px-3 text-xs outline-none focus:border-black/40"
              list={`openrouter-models-${tier}`}
              onChange={(event) => setDrafts((d) => ({ ...d, [tier]: event.target.value }))}
              placeholder={modelsQuery.isLoading ? 'Loading models…' : `Search models, e.g. ${settings?.models[tier] ?? ''}`}
              spellCheck={false}
              type="text"
              value={drafts[tier] ?? settings?.customModels[tier] ?? ''}
            />
            <datalist id={`openrouter-models-${tier}`}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.promptPricePerMillion != null ? ` · $${m.promptPricePerMillion}/M in` : ''}
                </option>
              ))}
            </datalist>
            <span className="mt-1 block text-[11px] text-[#8c8c86]">
              Any OpenRouter model id. Leave blank for the default ({settings?.models[tier] ?? '…'}). Models
              used by LexChat must support tool calling.
            </span>
          </label>
        ))}

        <p className="text-[11px] leading-4 text-[#8c8c86]">
          All AI features send prompts — including document excerpts, Knowledge Bank entries and reviewer
          feedback — to OpenRouter and the model provider behind the model you choose.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="inline-flex h-9 items-center rounded-lg bg-[#0f0f0f] px-4 text-xs font-medium text-white disabled:opacity-40"
            disabled={!canSave}
            type="submit"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          {settings?.keySource === 'user' && (
            <button
              className="inline-flex h-9 items-center rounded-lg border border-red-100 bg-white px-4 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
              type="button"
            >
              Remove key
            </button>
          )}
          {message && (
            <span
              className={`text-xs ${message.tone === 'ok' ? 'text-[#1a6b4a]' : 'text-red-600'}`}
              role="status"
            >
              {message.text}
            </span>
          )}
        </div>
      </form>

      {settings && (
        <div className="mt-6 border-t border-black/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-[#0f0f0f]">Feature tiers</h4>
            <button
              className="text-[11px] font-medium text-[#6f6f69] underline hover:text-[#0f0f0f] disabled:opacity-40"
              disabled={tierMutation.isPending}
              onClick={resetTiers}
              type="button"
            >
              Reset to defaults
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[#8c8c86]">
            Choose which tier each feature uses. LexChat and Birdie can also be switched per prompt.
          </p>
          <ul className="mt-3 divide-y divide-black/5">
            {settings.features.map((feature) => {
              const active = settings.featureTiers[feature.key] ?? feature.defaultTier
              return (
                <li className="flex items-center justify-between gap-3 py-2" key={feature.key}>
                  <span className="text-xs text-[#0f0f0f]">{feature.label}</span>
                  <div
                    aria-label={`${feature.label} tier`}
                    className="inline-flex rounded-lg bg-neutral-100 p-0.5"
                    role="group"
                  >
                    {(['high', 'mid'] as const).map((tier) => (
                      <button
                        aria-pressed={active === tier}
                        className={`rounded-md px-3 py-1 text-[11px] font-medium ${
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
    </div>
  )
}
