import { Folder } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { listDocuments, listKnowledgeBankEntryPage } from '../../shared/api/api'
import type { Matter } from '../../shared/types/workspace'

/**
 * Composer chip showing the matter a chat is scoped to and how many sources
 * (documents + Knowledge Bank entries) it can draw on. A transparent native
 * select sits on top so the chip stays a standard, accessible control.
 */
export function MatterChip({
  matters,
  value,
  onChange,
}: {
  matters: Matter[]
  value: string | null
  onChange: (matterId: string | null) => void
}) {
  const matter = matters.find((m) => m.id === value) ?? null
  const docs = useQuery({ queryKey: ['documents'], queryFn: listDocuments, staleTime: 30_000 })
  const entries = useQuery({
    queryKey: ['kbEntries', 'matter', value],
    queryFn: () => listKnowledgeBankEntryPage({ matterId: value ?? undefined, limit: 100, offset: 0 }),
    enabled: !!value,
    staleTime: 30_000,
  })
  const docCount = (docs.data ?? []).filter((d) => (d.matterId ?? null) === value).length
  const sourceCount = docCount + (value ? (entries.data?.items.length ?? 0) : 0)
  const label = `${matter ? matter.caseNumber : 'General'} · ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`

  return (
    <label className="relative inline-flex h-9 max-w-[16rem] cursor-pointer items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-800 transition-colors focus-within:ring-2 focus-within:ring-slate-400 hover:bg-slate-200">
      <Folder size={15} className="shrink-0" />
      <span className="truncate">{label}</span>
      <select
        aria-label="Matter for this chat"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(e) => onChange(e.target.value || null)}
        value={value ?? ''}
      >
        <option value="">General</option>
        {matters.map((m) => (
          <option key={m.id} value={m.id}>
            {m.caseNumber} · {m.title}
          </option>
        ))}
      </select>
    </label>
  )
}
