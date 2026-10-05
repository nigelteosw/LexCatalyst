import type { ActionPriority, ActionStatus, CurrentUser, FirmUser } from '../../shared/types/workspace'

export const statusColumns: Array<{ id: ActionStatus; label: string }> = [
  { id: 'pending', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export const priorityColors: Record<ActionPriority, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-50 text-blue-800',
  high: 'bg-rose-700 text-white',
}

export const statusColors: Record<ActionStatus, string> = {
  pending: 'bg-slate-200 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-800',
  review: 'bg-indigo-100 text-indigo-800',
  done: 'bg-teal-100 text-teal-800',
}

export function isManager(user: CurrentUser | null) {
  return !!user && (user.isAdmin || user.firmRole === 'partner' || user.firmRole === 'senior_associate')
}

export function userLabel(u: FirmUser) {
  return u.fullName?.trim() ? u.fullName : u.email
}
