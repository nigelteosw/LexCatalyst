import { expect, test } from 'bun:test'
import { sortActionItems } from '../src/features/actions/sort'
import type { ActionItem } from '../src/shared/types/workspace'
const make = (id: string, title: string, status: ActionItem['status'], dueDate?: string): ActionItem => ({ id, title, status, dueDate, priority: 'medium', tags: [], assignerId: 'u1', createdAt: '', updatedAt: '' })
const items = [make('a', 'Zulu', 'done'), make('b', 'alpha', 'pending', '2026-10-12'), make('c', 'Beta', 'review', '2026-10-06')]
test('sorts task titles naturally without mutating input', () => {
  expect(sortActionItems(items, 'task', 'asc').map(item => item.id)).toEqual(['b', 'c', 'a'])
  expect(sortActionItems(items, 'task', 'desc').map(item => item.id)).toEqual(['a', 'c', 'b'])
  expect(items.map(item => item.id)).toEqual(['a', 'b', 'c'])
})
test('sorts statuses in workflow order', () => {
  expect(sortActionItems(items, 'status', 'asc').map(item => item.id)).toEqual(['b', 'c', 'a'])
})
test('due sorting keeps undated tasks last in both directions', () => {
  expect(sortActionItems(items, 'due', 'asc').map(item => item.id)).toEqual(['c', 'b', 'a'])
  expect(sortActionItems(items, 'due', 'desc').map(item => item.id)).toEqual(['b', 'c', 'a'])
})

test('assignee sorting uses names or email and keeps unassigned last', () => {
  const assigned = [items[0], { ...items[1], assignee: { id: 'u2', email: 'z@example.test', fullName: 'Zoe' } }, { ...items[2], assignee: { id: 'u3', email: 'amy@example.test' } }]
  expect(sortActionItems(assigned, 'assignee', 'asc').map(item => item.id)).toEqual(['c', 'b', 'a'])
  expect(sortActionItems(assigned, 'assignee', 'desc').map(item => item.id)).toEqual(['b', 'c', 'a'])
})
