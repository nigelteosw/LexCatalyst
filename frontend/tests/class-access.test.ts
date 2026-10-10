import { expect, test } from 'bun:test'
import { formatClassCodeInput, isWorkspaceReady } from '../src/features/classes/classState'
import { parseWorkspacePath } from '../src/app/routes'

test('formats a pasted six-digit class code with its separator', () => {
  expect(formatClassCodeInput('000123')).toBe('000-123')
  expect(formatClassCodeInput('000-123')).toBe('000-123')
  expect(formatClassCodeInput(' 000 123 ')).toBe('000-123')
})

test('only active membership opens the workspace', () => {
  expect(isWorkspaceReady({ status: 'active', classId: 'c1', name: 'Autumn', role: 'member' })).toBe(true)
  expect(isWorkspaceReady({ status: 'pending' })).toBe(false)
  expect(isWorkspaceReady({ status: 'none' })).toBe(false)
})

test('team management has its own workspace route', () => {
  expect(parseWorkspacePath('/team').current.view).toBe('team')
})
