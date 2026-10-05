import type { BirdieSettings, OpenRouterModel } from './api'

export function filterModels(models: OpenRouterModel[], query: string): OpenRouterModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
}

export function modelLabel(settings: BirdieSettings | null): string {
  return settings?.hasOpenRouterKey && settings.effectiveModel ? settings.effectiveModel : 'DeepSeek (firm default)'
}

export function providerDisclosure(settings: BirdieSettings | null): string {
  if (!settings?.hasOpenRouterKey || !settings.effectiveModel) return 'Text you share is sent to DeepSeek.'
  return `Text you share is sent to OpenRouter → ${settings.effectiveModel.split('/')[0]}.`
}
