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
      : 'border-line-strong bg-card text-ink'
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`t-body w-full truncate rounded-md border px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${toneClass} ${className}`}
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
