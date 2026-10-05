import type { ActionPriority, ActionStatus, CurrentUser, FirmUser } from '../../shared/types/workspace'

export const statusColumns: Array<{ id: ActionStatus; label: string }> = [
  { id: 'pending', label: 'To do' },
  { id: 'in_progress', label: 'Drafting' },
  { id: 'review', label: 'Internal review' },
  { id: 'with_client', label: 'With client / counterparty' },
  { id: 'done', label: 'Done' },
]

export const priorityColors: Record<ActionPriority, string> = {
  low: 'bg-neutral-100 text-neutral-500',
  medium: 'bg-neutral-100 text-neutral-600',
  high: 'bg-neutral-100 text-[#9f1239]',
}

export const statusColors: Record<ActionStatus, string> = {
  pending: 'bg-neutral-400',
  in_progress: 'bg-[#647a9b]',
  review: 'bg-[#7d7893]',
  with_client: 'bg-[#64858a]',
  done: 'bg-[#638578]',
}

export function isManager(user: CurrentUser | null) {
  return !!user && (user.isAdmin || user.firmRole === 'partner' || user.firmRole === 'senior_associate')
}

export function userLabel(u: FirmUser) {
  return u.fullName?.trim() ? u.fullName : u.email
}
