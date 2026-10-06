import type { ReactNode } from 'react'

export type StatusTone = 'accent' | 'danger' | 'neutral' | 'success' | 'warning'

const toneClasses: Record<StatusTone, string> = {
  accent: 'bg-accent-tint text-accent',
  danger: 'bg-danger-tint text-danger',
  neutral: 'bg-fill text-ink-secondary',
  success: 'bg-success-tint text-success',
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
    <span className={`t-label inline-block whitespace-nowrap rounded-md px-2 py-0.5 first-letter:uppercase ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}
