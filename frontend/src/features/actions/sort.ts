import type { ActionItem } from '../../shared/types/workspace'
import { statusColumns } from './config'

export type ActionSortKey = 'task' | 'status' | 'assignee' | 'due'
export type SortDirection = 'asc' | 'desc'

export function sortActionItems(items: ActionItem[], key: ActionSortKey, direction: SortDirection): ActionItem[] {
  const sign = direction === 'asc' ? 1 : -1
  const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
  return [...items].sort((a, b) => {
    if (key === 'task') return sign * compareText(a.title, b.title)
    if (key === 'status') return sign * (statusColumns.findIndex(column => column.id === a.status) - statusColumns.findIndex(column => column.id === b.status))
    const left = key === 'due' ? a.dueDate : a.assignee?.fullName || a.assignee?.email
    const right = key === 'due' ? b.dueDate : b.assignee?.fullName || b.assignee?.email
    if (!left && !right) return 0
    if (!left) return 1
    if (!right) return -1
    return sign * (key === 'due' ? new Date(left).getTime() - new Date(right).getTime() : compareText(left, right))
  })
}
