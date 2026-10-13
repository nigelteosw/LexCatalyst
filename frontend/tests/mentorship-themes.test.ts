import { expect, test } from 'bun:test'
import { groupLessonsByTheme } from '../src/features/mentorship/themes'
import type { MentorLesson } from '../src/shared/types/workspace'

function lesson(id: string, theme: string, createdAt: string): MentorLesson {
  return {
    id,
    title: `Title ${id}`,
    body: 'Body',
    theme,
    menteeUserId: 'mentee',
    handoffId: null,
    sourceFeedbackIds: [],
    createdAt,
  }
}

test('groups lessons by theme, largest group first, newest lesson first inside a group', () => {
  const groups = groupLessonsByTheme([
    lesson('a', 'Passive Voice', '2026-10-01T00:00:00Z'),
    lesson('b', 'Defined Terms', '2026-10-02T00:00:00Z'),
    lesson('c', 'Defined Terms', '2026-10-05T00:00:00Z'),
  ])
  expect(groups.map((g) => g.theme)).toEqual(['Defined Terms', 'Passive Voice'])
  expect(groups[0].lessons.map((l) => l.id)).toEqual(['c', 'b'])
})

test('ties are ordered by theme name', () => {
  const groups = groupLessonsByTheme([
    lesson('a', 'Zebra', '2026-10-01T00:00:00Z'),
    lesson('b', 'Apple', '2026-10-01T00:00:00Z'),
  ])
  expect(groups.map((g) => g.theme)).toEqual(['Apple', 'Zebra'])
})

test('empty input gives no groups, and a blank theme falls into General', () => {
  expect(groupLessonsByTheme([])).toEqual([])
  const groups = groupLessonsByTheme([lesson('a', '', '2026-10-01T00:00:00Z')])
  expect(groups[0].theme).toBe('General')
})
