import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createGuidance,
  distillMentorLessons,
  getClassStatus,
  getCurrentUser,
  getMenteeThemes,
  getMentorshipMe,
  listMentorFeedback,
  listMentorLessons,
} from '../../shared/api/api'
import type { MentorFeedback, MentorLesson, ThemeSummary } from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { Button } from '../../shared/ui/Button'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import { useWorkspaceNavigation } from '../../app/routes'
import { groupLessonsByTheme } from './themes'

const MAX_NOTE = 4000

export function MentorshipPage({ menteeId }: { menteeId: string | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelHeader title="Mentorship" description="Feedback from your mentors, lessons from it, and the themes that keep coming up." />
      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        {menteeId ? <MenteeDetail menteeId={menteeId} /> : <MyView />}
      </div>
    </div>
  )
}

function MyView() {
  const { selectMentorship } = useWorkspaceNavigation()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['mentorship', 'me'], queryFn: getMentorshipMe })
  const currentUser = useQuery({ queryKey: ['currentUser'], queryFn: getCurrentUser })
  const feedback = useQuery({
    queryKey: ['mentorship', 'feedback', 'mine'],
    queryFn: () => listMentorFeedback({ audience: 'mentee' }),
  })
  const lessons = useQuery({ queryKey: ['mentorship', 'lessons', 'mine'], queryFn: () => listMentorLessons() })

  const myId = currentUser.data?.id
  const fromMentors = (feedback.data ?? []).filter((row) => row.menteeUserId === myId)
  const hasFeedback = fromMentors.length > 0
  const distil = useMutation({
    mutationFn: () => distillMentorLessons({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mentorship', 'lessons'] }),
  })

  return (
    <div className="space-y-8 pt-4">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-serif text-2xl text-ink">From my mentors</h2>
          <Button variant="secondary" disabled={distil.isPending || !hasFeedback} onClick={() => distil.mutate()}>
            {distil.isPending ? 'Distilling…' : hasFeedback ? 'Distil new lessons' : 'Nothing new'}
          </Button>
        </div>
        {distil.isError && <ErrorBanner className="mb-3" message={getErrorMessage(distil.error)} />}
        <FeedbackList rows={fromMentors} empty="No feedback from your mentors yet." />
      </section>

      <section>
        <h2 className="mb-3 font-serif text-2xl text-ink">My lessons</h2>
        <LessonsByTheme lessons={lessons.data ?? []} empty="Lessons appear here once you distil your mentors' feedback." />
      </section>

      {(me.data?.mentees.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-3 font-serif text-2xl text-ink">My mentees</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {me.data?.mentees.map((mentee) => (
              <MenteeCard key={mentee.userId} userId={mentee.userId} name={mentee.name} onOpen={() => selectMentorship(mentee.userId)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function MenteeCard({ userId, name, onOpen }: { userId: string; name: string; onOpen: () => void }) {
  const themes = useQuery({ queryKey: ['mentorship', 'themes', userId], queryFn: () => getMenteeThemes(userId) })
  return (
    <button type="button" onClick={onOpen} className="rounded-lg border border-line bg-white p-4 text-left hover:bg-accent-tint">
      <span className="block font-medium text-ink">{name}</span>
      <ThemeChips themes={themes.data ?? []} />
    </button>
  )
}

function MenteeDetail({ menteeId }: { menteeId: string }) {
  const { selectMentorship } = useWorkspaceNavigation()
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['classStatus'], queryFn: getClassStatus })
  const me = useQuery({ queryKey: ['mentorship', 'me'], queryFn: getMentorshipMe })
  const feedback = useQuery({
    queryKey: ['mentorship', 'feedback', menteeId],
    queryFn: () => listMentorFeedback({ menteeId }),
  })
  const lessons = useQuery({
    queryKey: ['mentorship', 'lessons', menteeId],
    queryFn: () => listMentorLessons(menteeId),
  })
  const themes = useQuery({ queryKey: ['mentorship', 'themes', menteeId], queryFn: () => getMenteeThemes(menteeId) })

  const mentee = me.data?.mentees.find((m) => m.userId === menteeId)
  const canWriteTeam = status.data?.status === 'active' && (status.data.role === 'owner' || status.data.role === 'mentor')
  const distil = useMutation({
    mutationFn: () => distillMentorLessons({ menteeUserId: menteeId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mentorship', 'lessons', menteeId] }),
  })

  if (me.isSuccess && !mentee) {
    return (
      <div className="pt-6">
        <ErrorBanner message="You don't have access to this mentee." />
        <Button className="mt-4" variant="secondary" onClick={() => selectMentorship()}>Back to my mentorship</Button>
      </div>
    )
  }

  return (
    <div className="space-y-8 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-ink">{mentee?.name ?? 'Mentee'}</h2>
        <Button variant="secondary" onClick={() => selectMentorship()}>Back</Button>
      </div>

      <ThemeChips themes={themes.data ?? []} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">Feedback</h3>
          <Button variant="secondary" disabled={distil.isPending} onClick={() => distil.mutate()}>
            {distil.isPending ? 'Distilling…' : 'Distil new lessons'}
          </Button>
        </div>
        {distil.isError && <ErrorBanner className="mb-3" message={getErrorMessage(distil.error)} />}
        <FeedbackList rows={feedback.data ?? []} empty="No feedback for this mentee yet." />
      </section>

      <section>
        <h3 className="mb-3 text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">Lessons</h3>
        <LessonsByTheme lessons={lessons.data ?? []} empty="No lessons yet." />
      </section>

      <GuidanceComposer menteeId={menteeId} canWriteTeam={canWriteTeam} />
    </div>
  )
}

function GuidanceComposer({ menteeId, canWriteTeam }: { menteeId: string; canWriteTeam: boolean }) {
  const queryClient = useQueryClient()
  const [audience, setAudience] = useState<'mentee' | 'team'>('mentee')
  const [note, setNote] = useState('')
  const [anchorQuote, setAnchorQuote] = useState('')
  const save = useMutation({
    mutationFn: () =>
      createGuidance({
        audience,
        menteeUserId: audience === 'mentee' ? menteeId : undefined,
        note: note.trim(),
        anchorQuote: anchorQuote.trim() || undefined,
      }),
    onSuccess: () => {
      setNote('')
      setAnchorQuote('')
      queryClient.invalidateQueries({ queryKey: ['mentorship', 'feedback'] })
    },
  })

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h3 className="mb-3 font-serif text-xl text-ink">Give guidance</h3>
      {canWriteTeam && (
        <fieldset className="mb-3 flex gap-4 text-sm">
          <legend className="sr-only">Who this is for</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="guidance-audience" checked={audience === 'mentee'} onChange={() => setAudience('mentee')} />
            This mentee
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="guidance-audience" checked={audience === 'team'} onChange={() => setAudience('team')} />
            Whole team
          </label>
        </fieldset>
      )}
      <label className="mb-2 block text-sm text-ink-secondary" htmlFor="guidance-anchor">Passage (optional)</label>
      <input
        id="guidance-anchor"
        value={anchorQuote}
        maxLength={MAX_NOTE}
        onChange={(event) => setAnchorQuote(event.target.value)}
        className="mb-3 w-full rounded-md border border-line px-3 py-2 text-sm"
      />
      <label className="mb-2 block text-sm text-ink-secondary" htmlFor="guidance-note">Guidance</label>
      <textarea
        id="guidance-note"
        value={note}
        maxLength={MAX_NOTE}
        rows={4}
        onChange={(event) => setNote(event.target.value)}
        className="mb-3 w-full rounded-md border border-line px-3 py-2 text-sm"
      />
      {save.isError && <ErrorBanner className="mb-3" message={getErrorMessage(save.error)} />}
      <Button variant="primary" disabled={save.isPending || !note.trim()} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save guidance'}
      </Button>
    </section>
  )
}

function FeedbackList({ rows, empty }: { rows: MentorFeedback[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-secondary">{empty}</p>
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-line bg-white p-3">
          <p className="text-xs text-ink-secondary">
            {row.audience === 'team' ? 'Team guidance' : row.source === 'guidance' ? 'Guidance' : 'Review feedback'} · {row.authorName}
          </p>
          {row.anchorQuote && <p className="mt-1 text-sm italic text-ink-secondary">“{row.anchorQuote}”</p>}
          <p className="mt-1 text-sm text-ink">{row.note}</p>
          {row.suggestedText && <p className="mt-1 text-sm text-accent">Suggested: {row.suggestedText}</p>}
        </li>
      ))}
    </ul>
  )
}

function LessonsByTheme({ lessons, empty }: { lessons: MentorLesson[]; empty: string }) {
  const groups = groupLessonsByTheme(lessons)
  if (groups.length === 0) return <p className="text-sm text-ink-secondary">{empty}</p>
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.theme}>
          <h4 className="mb-2 text-sm font-semibold text-accent">{group.theme} ({group.lessons.length})</h4>
          <ul className="space-y-2">
            {group.lessons.map((lesson) => (
              <li key={lesson.id} className="rounded-md border border-line bg-white p-3">
                <p className="text-sm font-medium text-ink">{lesson.title}</p>
                <p className="mt-1 text-sm text-ink-secondary">{lesson.body}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ThemeChips({ themes }: { themes: ThemeSummary[] }) {
  if (themes.length === 0) return <p className="mt-1 text-xs text-ink-secondary">No themes yet</p>
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {themes.slice(0, 3).map((t) => (
        <span key={t.theme} className="rounded-full bg-accent-tint px-2 py-0.5 text-xs text-accent">
          {t.theme} · {t.count}
        </span>
      ))}
    </div>
  )
}
