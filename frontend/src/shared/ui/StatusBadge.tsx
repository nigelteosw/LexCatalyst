import type { ReactNode } from 'react'

type StatusTone = 'danger' | 'neutral' | 'success' | 'warning'

const toneClasses: Record<StatusTone, string> = {
  danger: 'bg-danger-tint text-danger',
  neutral: 'bg-fill text-ink-secondary',
  success: 'bg-fill text-ink',
  warning: 'bg-warning-tint text-warning',
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: StatusTone
}) {
  return (
    <span className={`t-label inline-flex items-center rounded-md px-2 py-0.5 capitalize ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}
