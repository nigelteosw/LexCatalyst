import { useQuery } from '@tanstack/react-query'
import { getMentorshipMe, listMentorFeedback, listMentorLessons } from '../../shared/api/api'
import type { CurrentUser, MentorFeedback } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { MenteeCard } from '../mentorship/MentorshipPage'
import { formatRelative } from './format'

const FEEDBACK_LIMIT = 5
const TEAM_GUIDANCE_LIMIT = 3

function newestFirst(rows: MentorFeedback[]): MentorFeedback[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Mentorship state for the signed-in user. Shares cache keys with the Mentorship page. */
function useMentorshipMe() {
  return useQuery({ queryKey: ['mentorship', 'me'], queryFn: getMentorshipMe, staleTime: 60_000 })
}

/** Latest feedback from your mentors, and how many of those rows no lesson has distilled yet. */
export function FromMentorsSection({ currentUser }: { currentUser: CurrentUser | null }) {
  const { selectMentorship } = useWorkspaceNavigation()
  const me = useMentorshipMe()
  const hasMentor = (me.data?.mentors.length ?? 0) > 0
  const feedback = useQuery({
    queryKey: ['mentorship', 'feedback', 'mine'],
    queryFn: () => listMentorFeedback({ audience: 'mentee' }),
    enabled: hasMentor,
  })
  const lessons = useQuery({
    queryKey: ['mentorship', 'lessons', 'mine'],
    queryFn: () => listMentorLessons(),
    enabled: hasMentor,
  })

  if (!hasMentor) return null

  const mine = newestFirst((feedback.data ?? []).filter((row) => row.menteeUserId === currentUser?.id))
  const distilled = new Set((lessons.data ?? []).flatMap((lesson) => lesson.sourceFeedbackIds))
  const toDistil = mine.filter((row) => !distilled.has(row.id)).length

  return (
    <section>
      <h2 className="flex items-baseline gap-2.5 border-b border-line pb-3 font-serif text-xl text-ink">From my mentors</h2>
      {feedback.isPending ? (
        <p className="t-body py-5 text-ink-tertiary">Loading feedback…</p>
      ) : feedback.isError ? (
        <p className="t-body py-5 text-danger">Could not load feedback from your mentors.</p>
      ) : mine.length === 0 ? (
        <p className="t-body py-5 text-ink-secondary">No feedback from your mentors yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {mine.slice(0, FEEDBACK_LIMIT).map((row) => (
            <li key={row.id} className="py-3.5">
              <p className="t-meta text-ink-secondary">{row.authorName} · {formatRelative(row.createdAt)}</p>
              {row.anchorQuote && <p className="mt-1 text-sm italic text-ink-secondary">“{row.anchorQuote}”</p>}
              <p className="mt-1 line-clamp-2 text-body text-ink">{row.note}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
        <p className="t-meta text-ink-secondary">
          New lessons to distil: <span className="tabular-nums text-ink">{toDistil}</span>
        </p>
        <button className="t-meta font-medium text-accent hover:underline" onClick={() => selectMentorship()} type="button">
          Open Mentorship
        </button>
      </div>
    </section>
  )
}

/** Mentee cards with their top themes. Hidden unless the user mentors someone. */
export function MyMenteesSection() {
  const { selectMentorship } = useWorkspaceNavigation()
  const me = useMentorshipMe()
  const mentees = me.data?.mentees ?? []
  if (mentees.length === 0) return null

  return (
    <section>
      <h2 className="border-b border-line pb-3 font-serif text-xl text-ink">My mentees</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {mentees.map((mentee) => (
          <MenteeCard key={mentee.userId} userId={mentee.userId} name={mentee.name} onOpen={() => selectMentorship(mentee.userId)} />
        ))}
      </div>
    </section>
  )
}

/** The three latest guidance items written for the whole team. */
export function TeamGuidanceSection() {
  const { selectMentorship } = useWorkspaceNavigation()
  const guidance = useQuery({
    queryKey: ['mentorship', 'feedback', 'team'],
    queryFn: () => listMentorFeedback({ audience: 'team' }),
  })
  const rows = newestFirst(guidance.data ?? []).slice(0, TEAM_GUIDANCE_LIMIT)

  return (
    <section>
      <h2 className="border-b border-line pb-3 font-serif text-xl text-ink">Team guidance</h2>
      {guidance.isPending ? (
        <p className="t-body py-5 text-ink-tertiary">Loading guidance…</p>
      ) : guidance.isError ? (
        <p className="t-body py-5 text-danger">Could not load team guidance.</p>
      ) : rows.length === 0 ? (
        <p className="t-body py-5 text-ink-secondary">No team guidance yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((row) => (
            <li key={row.id} className="py-3.5">
              <p className="t-meta text-ink-secondary">{row.authorName} · {formatRelative(row.createdAt)}</p>
              <p className="mt-1 line-clamp-3 text-body text-ink">{row.note}</p>
            </li>
          ))}
        </ul>
      )}
      <button className="t-meta mt-2 font-medium text-accent hover:underline" onClick={() => selectMentorship()} type="button">
        All mentorship
      </button>
    </section>
  )
}
