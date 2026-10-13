import type { MentorLesson } from '../../shared/types/workspace'

export const GENERAL_THEME = 'General'

export type ThemeGroup = { theme: string; lessons: MentorLesson[] }

// Largest group first; ties by name. Lessons inside a group are newest first.
export function groupLessonsByTheme(lessons: MentorLesson[]): ThemeGroup[] {
  const groups = new Map<string, MentorLesson[]>()
  for (const lesson of lessons) {
    const theme = lesson.theme.trim() || GENERAL_THEME
    groups.set(theme, [...(groups.get(theme) ?? []), lesson])
  }
  return [...groups.entries()]
    .map(([theme, items]) => ({
      theme,
      lessons: [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }))
    .sort((a, b) => b.lessons.length - a.lessons.length || a.theme.localeCompare(b.theme))
}
