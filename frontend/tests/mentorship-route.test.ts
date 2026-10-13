import { expect, test } from 'bun:test'
import { parseWorkspacePath } from '../src/app/routes'

test('/mentorship opens my view and /mentorship/:menteeId opens a mentee', () => {
  expect(parseWorkspacePath('/mentorship').current).toEqual({ view: 'mentorship', menteeId: null })
  expect(parseWorkspacePath('/mentorship/abc-123').current).toEqual({ view: 'mentorship', menteeId: 'abc-123' })
  expect(parseWorkspacePath('/mentorship').isKnownRoute).toBe(true)
})
