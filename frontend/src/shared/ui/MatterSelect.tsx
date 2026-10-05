import type { Matter } from '../types/workspace'

export function MatterSelect({
  matters,
  value,
  onChange,
  label = 'Matter',
  tone = 'light',
  className = '',
}: {
  matters: Matter[]
  value: string | null
  onChange: (matterId: string | null) => void
  label?: string
  tone?: 'light' | 'dark'
  className?: string
}) {
  const toneClass =
    tone === 'dark'
      ? 'border-white/10 bg-white/[0.06] text-white/80'
      : 'border-neutral-200 bg-white text-neutral-800'
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full truncate rounded-lg border px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${toneClass} ${className}`}
    >
      <option value="">General</option>
      {matters.map((m) => (
        <option key={m.id} value={m.id}>
          {m.caseNumber} · {m.title}
        </option>
      ))}
    </select>
  )
}
