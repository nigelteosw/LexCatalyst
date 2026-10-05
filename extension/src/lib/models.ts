import type { OpenrouterModel } from './api'

export function filterModels(models: OpenrouterModel[], query: string): OpenrouterModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
}
