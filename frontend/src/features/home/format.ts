export function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
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
