// Dates read day-first (6 Oct 2026) regardless of browser locale, as Singapore practice expects.
const LOCALE = 'en-GB'

function parse(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "6 Oct", or "6 Oct 2025" when not in the current year. */
export function formatShortDate(value: string | Date, now: Date = new Date()): string {
  const date = parse(value)
  if (!date) return '—'
  return date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** "6 October 2026" */
export function formatLongDate(value: string | Date): string {
  const date = parse(value)
  return date ? date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

/** "6 Oct 2026, 17:28" */
export function formatDateTime(value: string | Date): string {
  const date = parse(value)
  if (!date) return 'recently'
  return date.toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Whole days from today (local) to a due date; negative = overdue. */
export function daysUntil(dateString: string, now: Date = new Date()): number {
  const due = new Date(dateString)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  return Math.round((startOfDue - startOfToday) / 86_400_000)
}

export function dueLabel(days: number): string {
  if (days < 0) return `Overdue ${-days}d`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days}d`
}

export type DueTone = 'overdue' | 'soon' | 'normal'

/** Overdue, due within two days, or neither. */
export function dueTone(days: number): DueTone {
  if (days < 0) return 'overdue'
  if (days <= 2) return 'soon'
  return 'normal'
}
