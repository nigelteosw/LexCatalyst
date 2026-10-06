import { CalendarClock } from 'lucide-react'
import { daysUntil, dueLabel, dueTone, formatLongDate, formatShortDate } from '../lib/dates'

const toneClasses = {
  overdue: 'font-medium text-danger',
  soon: 'font-medium text-warning',
  normal: 'text-ink-secondary',
}

/** A due date that turns amber when close and red when missed; completed work stays neutral. */
export function DueDate({ value, done = false, className = '' }: { value: string; done?: boolean; className?: string }) {
  const days = daysUntil(value)
  const tone = done ? 'normal' : dueTone(days)
  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${toneClasses[tone]} ${className}`}
      title={`${done ? 'Was due' : dueLabel(days)} · ${formatLongDate(value)}`}
    >
      {tone !== 'normal' && <CalendarClock aria-hidden="true" size={12} strokeWidth={2} />}
      {tone === 'overdue' ? `Overdue · ${formatShortDate(value)}` : formatShortDate(value)}
    </span>
  )
}
