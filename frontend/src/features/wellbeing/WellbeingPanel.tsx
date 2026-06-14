import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ClipboardList, Plus, ShieldCheck, Users } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSurveyQuestion,
  getSurveyResults,
  listSurveyQuestions,
  submitSurveyResponse,
  updateSurveyQuestion,
} from '../../shared/api/api'
import type { CurrentUser, SurveyCategory, SurveyQuestion } from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'

type WellbeingPanelProps = {
  currentUser: CurrentUser | null
}

const CURRENT_WEEK_OF = (() => {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString()
})()

const categoryLabels: Record<SurveyCategory, string> = {
  workload: 'Workload',
  mental_health: 'Mental health',
  team_dynamics: 'Team dynamics',
  learning: 'Learning & growth',
}

export function WellbeingPanel({ currentUser }: WellbeingPanelProps) {
  const isPartner = currentUser?.isAdmin || currentUser?.firmRole === 'partner'
  const [activeTab, setActiveTab] = useState<'survey' | 'results' | 'manage'>('survey')
  const visibleTab = isPartner ? activeTab : 'survey'

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#fafaf8]">
      <header className="flex min-h-14 shrink-0 flex-col items-stretch gap-2 border-b border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-0">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0f0f0f] text-white">
            <ClipboardList size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#0f0f0f]">Wellbeing</h2>
            <p className="text-[10px] text-[#8c8c86]">Weekly team check-in</p>
          </div>
        </div>

        <nav className="flex gap-0.5 overflow-x-auto sm:ml-2">
          <TabButton active={visibleTab === 'survey'} onClick={() => setActiveTab('survey')}>
            <ClipboardList size={12} />
            My check-in
          </TabButton>
          {isPartner && (
            <TabButton active={visibleTab === 'results'} onClick={() => setActiveTab('results')}>
              <Users size={12} />
              Results
            </TabButton>
          )}
          {isPartner && (
            <TabButton active={visibleTab === 'manage'} onClick={() => setActiveTab('manage')}>
              Manage questions
            </TabButton>
          )}
        </nav>
      </header>

      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-7">
        {visibleTab === 'survey' && <SurveyTab />}
        {visibleTab === 'results' && <ResultsTab />}
        {visibleTab === 'manage' && <ManageQuestionsTab />}
      </div>
    </section>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        active ? 'bg-[#0f0f0f] text-white' : 'text-[#6f6f69] hover:bg-[#f4f3ef]'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function SurveyTab() {
  const questionsQuery = useQuery({
    queryKey: ['surveyQuestions'],
    queryFn: () => listSurveyQuestions(true),
  })

  const questions = questionsQuery.data ?? []
  const [scores, setScores] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitMutation = useMutation({
    mutationFn: async () => {
      for (const question of questions) {
        const score = scores[question.id] ?? 3
        await submitSurveyResponse({ questionId: question.id, score, weekOf: CURRENT_WEEK_OF })
      }
    },
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not submit'),
  })

  if (questionsQuery.isLoading) {
    return <p className="text-sm text-[#8c8c86]">Loading questions...</p>
  }

  if (questionsQuery.isError) {
    return (
      <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-sm text-[#8a1f1f]">
        {questionsQuery.error.message}
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-black/15 bg-white p-8 text-center">
        <ClipboardList size={24} className="mx-auto text-[#aaa9a3]" />
        <p className="mt-3 text-sm text-[#6f6f69]">No survey questions yet.</p>
        <p className="mt-1 text-xs text-[#9a9a94]">A partner can add questions in the Manage tab.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="rounded-[14px] border border-[#2d9e6b]/30 bg-[#e8f5ee] p-8 text-center">
        <Check size={28} className="mx-auto text-[#1a6b4a]" />
        <p className="mt-3 text-base font-semibold text-[#1a6b4a]">Check-in submitted</p>
        <p className="mt-1 text-xs text-[#2d9e6b]">
          Your responses are saved for this week. Submitting again will update them.
        </p>
      </div>
    )
  }

  const byCategory = questions.reduce<Record<string, SurveyQuestion[]>>((acc, q) => {
    if (!acc[q.category]) acc[q.category] = []
    acc[q.category].push(q)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-black/8 bg-white px-4 py-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#4a3db0]" />
        <p className="text-xs leading-5 text-[#5a5a56]">
          Partners can see completion and average scores for each user so they can follow up on workload and support needs.
        </p>
      </div>

      {Object.entries(byCategory).map(([category, qs]) => (
        <section key={category} className="rounded-[14px] border border-black/10 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-[#0f0f0f]">
            {categoryLabels[category as SurveyCategory] ?? category}
          </h3>
          <div className="space-y-5">
            {qs.map((q) => (
              <label key={q.id} className="block">
                <div className="flex items-center justify-between gap-4 text-sm text-[#171717]">
                  <span>{q.text}</span>
                  <span className="shrink-0 font-serif text-lg italic text-[#5a5a56]">
                    {scores[q.id] ?? '–'}/5
                  </span>
                </div>
                <input
                  className="mt-2 h-1.5 w-full cursor-pointer accent-[#1a6b4a]"
                  max="5"
                  min="1"
                  onChange={(e) => setScores((s) => ({ ...s, [q.id]: Number(e.target.value) }))}
                  type="range"
                  value={scores[q.id] ?? 3}
                />
                <div className="mt-1 flex justify-between text-[10px] text-[#aaa9a3]">
                  <span>Strongly disagree</span>
                  <span>Strongly agree</span>
                </div>
              </label>
            ))}
          </div>
        </section>
      ))}

      {error && (
        <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-xs text-[#8a1f1f]">{error}</div>
      )}

      <button
        className="w-full rounded-[10px] bg-[#0f0f0f] px-4 py-3 text-sm font-medium text-white disabled:bg-[#aaa9a3]"
        disabled={submitMutation.isPending}
        onClick={() => submitMutation.mutate()}
        type="button"
      >
        {submitMutation.isPending ? 'Submitting...' : 'Submit weekly check-in'}
      </button>
    </div>
  )
}

function ResultsTab() {
  const resultsQuery = useQuery({
    queryKey: ['surveyResults'],
    queryFn: getSurveyResults,
  })

  if (resultsQuery.isLoading) return <p className="text-sm text-[#8c8c86]">Loading results...</p>
  if (resultsQuery.isError) {
    return (
      <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-sm text-[#8a1f1f]">
        {resultsQuery.error.message}
      </div>
    )
  }
  if (!resultsQuery.data) {
    return (
      <div className="rounded-[14px] border border-dashed border-black/15 bg-white p-8 text-center">
        <p className="text-sm text-[#6f6f69]">No survey data is available.</p>
      </div>
    )
  }

  const completedUsers = resultsQuery.data.users.filter(
    (user) => user.questionCount > 0 && user.responseCount >= user.questionCount,
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-[#4a3db0]/15 bg-[#eeecff] px-4 py-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#4a3db0]" />
        <p className="text-xs leading-5 text-[#4a3db0]">
          Current week starting{' '}
          {new Date(resultsQuery.data.currentWeekOf).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
          . {completedUsers} of {resultsQuery.data.users.length} users completed every active question.
        </p>
      </div>

      <section className="overflow-hidden rounded-[14px] border border-black/10 bg-white">
        <div className="flex items-center justify-between border-b border-black/8 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[#0f0f0f]">Team dashboard</h3>
            <p className="mt-0.5 text-[11px] text-[#8c8c86]">Every firm user, including missing check-ins</p>
          </div>
          <span className="rounded-full bg-[#f4f3ef] px-2.5 py-1 text-[11px] font-medium text-[#5a5a56]">
            {resultsQuery.data.users.length} users
          </span>
        </div>

        {resultsQuery.data.users.length === 0 ? (
          <p className="px-5 py-6 text-sm text-[#8c8c86]">No users found.</p>
        ) : (
          <div className="divide-y divide-black/8">
            {resultsQuery.data.users.map((user) => {
              const isComplete = user.questionCount > 0 && user.responseCount >= user.questionCount
              const isPartial = user.responseCount > 0 && !isComplete
              const statusLabel = isComplete ? 'Complete' : isPartial ? 'Partial' : 'Not submitted'
              const statusClass = isComplete
                ? 'bg-[#e8f5ee] text-[#1a6b4a]'
                : isPartial
                  ? 'bg-[#fff4d6] text-[#8a5a00]'
                  : 'bg-[#f4f3ef] text-[#777770]'

              return (
                <div
                  key={user.userId}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_120px_110px] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#171717]">
                      {user.fullName || user.email}
                    </p>
                    <p className="truncate text-[11px] text-[#8c8c86]">
                      {user.fullName ? user.email : user.firmRole.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="text-xs text-[#5a5a56] sm:text-right">
                    {user.averageScore === null ? 'No score' : `${user.averageScore.toFixed(1)}/5 average`}
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass}`}>
                      {statusLabel}
                    </span>
                    <span className="text-[10px] text-[#9a9a94]">
                      {user.responseCount}/{user.questionCount}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div>
        <h3 className="text-sm font-semibold text-[#0f0f0f]">Question trends</h3>
        <p className="mt-0.5 text-[11px] text-[#8c8c86]">Weekly averages across submitted responses</p>
      </div>

      {resultsQuery.data.questions.length === 0 && (
        <div className="rounded-[14px] border border-dashed border-black/15 bg-white p-8 text-center">
          <p className="text-sm text-[#6f6f69]">No survey questions yet.</p>
        </div>
      )}
      {resultsQuery.data.questions.map((q) => (
        <section key={q.questionId} className="rounded-[14px] border border-black/10 bg-white p-5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9a94]">
            {categoryLabels[q.category as SurveyCategory] ?? q.category}
          </div>
          <h3 className="mb-4 text-sm font-semibold text-[#0f0f0f]">{q.questionText}</h3>
          {q.weeks.length === 0 ? (
            <p className="text-xs text-[#9a9a94]">No responses yet.</p>
          ) : (
            <div className="space-y-3">
              {q.weeks.map((w) => (
                <div key={w.weekOf} className="flex items-center gap-4">
                  <span className="w-20 shrink-0 text-[11px] text-[#8c8c86]">
                    {new Date(w.weekOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="flex-1 overflow-hidden rounded-full bg-[#eeecea] h-2">
                    <div
                      className="h-full rounded-full bg-[#4aa073]"
                      style={{ width: `${(w.avgScore / 5) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-[#5a5a56]">
                    {w.avgScore.toFixed(1)}/5 ({w.responseCount})
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function ManageQuestionsTab() {
  const queryClient = useQueryClient()
  const questionsQuery = useQuery({
    queryKey: ['surveyQuestions'],
    queryFn: () => listSurveyQuestions(false),
  })
  const [isAdding, setIsAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [newCategory, setNewCategory] = useState<SurveyCategory>('workload')
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createSurveyQuestion({ text: newText, category: newCategory }),
    onSuccess: () => {
      setNewText('')
      setIsAdding(false)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['surveyQuestions'] })
    },
    onError: (caughtError) => setError(getErrorMessage(caughtError)),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateSurveyQuestion(id, { isActive }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['surveyQuestions'] })
    },
    onError: (caughtError) => setError(getErrorMessage(caughtError)),
  })

  const questions = questionsQuery.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#0f0f0f]">Survey questions</h3>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0f0f0f] px-3 text-xs font-medium text-white hover:bg-[#333]"
          onClick={() => setIsAdding(true)}
          type="button"
        >
          <Plus size={13} />
          Add question
        </button>
      </div>

      {isAdding && (
        <div className="rounded-[14px] border border-black/10 bg-white p-4 space-y-3">
          <input
            autoFocus
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Question text"
            value={newText}
          />
          <select
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
            onChange={(e) => setNewCategory(e.target.value as SurveyCategory)}
            value={newCategory}
          >
            {Object.entries(categoryLabels).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-3 py-2 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
              onClick={() => setIsAdding(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-[#0f0f0f] px-3 py-2 text-xs text-white disabled:bg-[#aaa9a3]"
              disabled={!newText.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              type="button"
            >
              {createMutation.isPending ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {(error || questionsQuery.isError) && (
        <div className="rounded-lg bg-[#fdeeed] px-3 py-2 text-xs text-[#8a1f1f]">
          {error ?? getErrorMessage(questionsQuery.error)}
        </div>
      )}

      {questionsQuery.isLoading ? (
        <p className="text-sm text-[#8c8c86]">Loading questions...</p>
      ) : questions.length === 0 && !isAdding ? (
        <p className="text-sm text-[#8c8c86]">No questions yet. Add the first one.</p>
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <div
              key={q.id}
              className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 ${
                q.isActive ? 'border-black/10 bg-white' : 'border-black/8 bg-[#f8f8f6] opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#0f0f0f]">{q.text}</p>
                <p className="mt-0.5 text-[10px] text-[#9a9a94]">
                  {categoryLabels[q.category as SurveyCategory] ?? q.category}
                </p>
              </div>
              <button
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  q.isActive
                    ? 'bg-[#e8f5ee] text-[#1a6b4a] hover:bg-[#d0edde]'
                    : 'bg-[#f4f3ef] text-[#6f6f69] hover:bg-[#eeecea]'
                }`}
                disabled={toggleMutation.isPending}
                onClick={() => toggleMutation.mutate({ id: q.id, isActive: !q.isActive })}
                type="button"
              >
                {q.isActive ? 'Active' : 'Inactive'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
