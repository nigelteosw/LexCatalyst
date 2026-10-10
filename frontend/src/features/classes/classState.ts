import type { ClassStatus } from '../../shared/types/workspace'

export function formatClassCodeInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 6)
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits
}

export function isWorkspaceReady(status: ClassStatus | null | undefined): boolean {
  return status?.status === 'active' && Boolean(status.classId)
}
