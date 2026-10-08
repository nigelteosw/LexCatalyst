import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getLlmSettings, listOpenrouterModels } from '../api/api'
import type { LlmSettings, LlmTier, ModelChoice } from '../types/workspace'

export const MISSING_KEY_MESSAGE = 'Add your OpenRouter key in Settings'

export function shortModelName(id: string, name?: string): string {
  return (name ?? id).replace(/^[^:]+:\s*/, '').replace(/^[^/]+\//, '').replace(/^Claude\s+/i, '')
}

export function formatPrice(perMillion: number | null): string {
  if (perMillion == null) return '–'
  if (perMillion === 0) return 'free'
  return perMillion < 1 ? `$${perMillion.toFixed(2)}` : `$${perMillion.toFixed(perMillion < 10 ? 2 : 1)}`
}

export function formatContext(tokens: number | null): string {
  if (!tokens) return '–'
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M ctx` : `${Math.round(tokens / 1000)}k ctx`
}

export function describeModelChoice(
  choice: ModelChoice,
  settings: LlmSettings | undefined,
  models: { id: string; name: string }[] | undefined,
): { label: string; modelId: string | null; modelName: string | null } {
  const modelId = choice.model ?? settings?.models[choice.tier] ?? null
  const found = modelId ? models?.find((m) => m.id === modelId) : undefined
  const modelName = modelId ? shortModelName(modelId, found?.name) : null
  const label = choice.tier ? (choice.tier === 'high' ? 'High' : 'Mid') : 'Custom'
  return { label, modelId, modelName }
}

export function useLlmSettings() {
  return useQuery({ queryKey: ['llmSettings'], queryFn: getLlmSettings })
}

export function useOpenrouterModels(enabled = true) {
  return useQuery({
    queryKey: ['openrouterModels'],
    queryFn: listOpenrouterModels,
    staleTime: 60 * 60 * 1000,
    enabled,
  })
}

function readSaved(storageKey: string): ModelChoice | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === 'high' || raw === 'mid') return { tier: raw }
    if (raw && raw.startsWith('model:')) return { model: raw.slice(6) }
  } catch {
    // storage unavailable
  }
  return null
}

/**
 * Per-surface model choice. Starts from the user's Settings tier for `featureKey`;
 * a per-prompt override is remembered in localStorage under `storageKey`.
 */
export function useModelChoice(storageKey: string, featureKey: string) {
  const settingsQuery = useLlmSettings()
  const [override, setOverride] = useState<ModelChoice | null>(() => readSaved(storageKey))
  const settings = settingsQuery.data
  const defaultTier: LlmTier = settings?.featureTiers[featureKey] ?? 'mid'
  const choice: ModelChoice = override ?? { tier: defaultTier }

  const setChoice = useCallback(
    (next: ModelChoice) => {
      setOverride(next)
      try {
        localStorage.setItem(storageKey, next.tier ?? `model:${next.model}`)
      } catch {
        // storage unavailable
      }
    },
    [storageKey],
  )

  const needsKey = settingsQuery.isSuccess && !settings?.hasKey
  return { choice, setChoice, settings, needsKey }
}
