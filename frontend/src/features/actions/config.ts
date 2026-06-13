import type { ActionPriority, ActionStatus, CurrentUser, FirmUser } from '../../shared/types/workspace'

export const statusColumns: Array<{ id: ActionStatus; label: string }> = [
  { id: 'pending', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export const priorityColors: Record<ActionPriority, string> = {
  low: 'bg-[#f4f3ef] text-[#6f6f69]',
  medium: 'bg-[#fef3dc] text-[#8a5a00]',
  high: 'bg-[#fdeeed] text-[#8a1f1f]',
}

export function isManager(user: CurrentUser | null) {
  return !!user && (user.isAdmin || user.firmRole === 'partner' || user.firmRole === 'senior_associate')
}

export function userLabel(u: FirmUser) {
  return u.fullName?.trim() ? u.fullName : u.email
}
