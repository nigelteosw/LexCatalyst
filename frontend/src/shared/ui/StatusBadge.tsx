import type { ReactNode } from 'react'

type StatusTone = 'danger' | 'neutral' | 'success' | 'warning'

const toneClasses: Record<StatusTone, string> = {
  danger: 'border-red-200 bg-red-50 text-red-700',
  neutral: 'border-neutral-200 bg-neutral-100 text-neutral-600',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: StatusTone
}) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}
