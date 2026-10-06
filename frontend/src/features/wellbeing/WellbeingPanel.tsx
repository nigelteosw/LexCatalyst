import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Check,
  ClipboardList,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createSurveyQuestion,
  deleteSurveyQuestion,
  getSurveyResults,
  listSurveyQuestions,
  submitSurveyResponses,
  updateSurveyQuestion,
} from '../../shared/api/api'
import type { CurrentUser, SurveyCategory, SurveyQuestion } from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { FeatureHelp } from '../../shared/ui/FeatureHelp'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const WELLBEING_HELP: HelpContent = {
  intro: 'A weekly pulse check to help the firm track team health — workload, mental wellbeing, team dynamics, and learning — anonymously.',
  steps: [
    {
      emoji: '📝',
      title: 'Complete your weekly check-in',
      body: 'A short set of questions appears each week. Rate each item on a simple scale. It takes under two minutes and resets every Monday.',
    },
    {
      emoji: '🔒',
      title: 'Your answers are private',
      body: 'Individual responses are never shown to colleagues. Only your own ratings are visible to you. Partners and admins see team-level averages only.',
    },
    {
      emoji: '📊',
      title: 'Partners see team trends',
      body: 'The Results tab (partners and admins only) shows weekly averages across all four categories so leadership can spot burnout risk or engagement drops early.',
    },
    {
      emoji: '❓',
      title: 'Questions are managed by admins',
      body: 'Partners and admins can add, edit, enable, or disable questions from the Questions tab. Changes take effect from the next weekly cycle.',
    },
  ],
  roles: [
    {
      label: 'Partner / Admin',
      tier: 'top',
      abilities: [
        'View team-level aggregated results and trends',
        'Add, edit, and toggle survey questions on or off',
        'See completion rates across the team',
      ],
    },
    {
      label: 'All team members',
      tier: 'base',
      abilities: [
        'Submit a weekly check-in (one submission per week)',
        'View your own past responses',
        'Update your response any time during the week',
      ],
    },
  ],
  tips: [
    'The check-in resets every Monday — you can update your response any time before the week ends.',
    'Skipping a week is fine. There is no pressure to respond every cycle.',
  ],
}

type WellbeingPanelProps = {
  currentUser: CurrentUser | null
}

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
      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-14 lg:px-12 lg:pt-20">
        <div className="mx-auto max-w-5xl">
          <header>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-4xl tracking-tight text-neutral-950">Wellbeing</h1>
              <FeatureHelp title="Wellbeing" content={WELLBEING_HELP} />
            </div>
            <p className="mt-3 max-w-xl text-body leading-relaxed text-neutral-500">
              Weekly team check-in
            </p>
          </header>
          <nav aria-label="Wellbeing sections" className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-b border-neutral-200 pb-3">
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
          <div className="mt-6">
            {visibleTab === 'survey' && <SurveyTab />}
            {visibleTab === 'results' && <ResultsTab />}
            {visibleTab === 'manage' && <ManageQuestionsTab />}
          </div>
        </div>
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
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 py-1 text-body transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a] ${
        active ? 'text-[#1e3a8a]' : 'text-neutral-500 hover:text-neutral-800'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function SurveyTab() {
  const queryClient = useQueryClient()
  const questionsQuery = useQuery({
    queryKey: ['surveyQuestions', 'active'],
    queryFn: () => listSurveyQuestions(true),
  })

  const questions = questionsQuery.data ?? []
  const [scores, setScores] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitMutation = useMutation({
    mutationFn: () =>
      submitSurveyResponses(
        questions.map((question) => ({
          questionId: question.id,
          score: scores[question.id] ?? 3,
        })),
      ),
    onMutate: () => setError(null),
    onSuccess: () => {
      setSubmitted(true)
      queryClient.invalidateQueries({ queryKey: ['surveyResults'] })
    },
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
      <div className="rounded-xl border border-dashed border-black/15 bg-white p-8 text-center">
        <ClipboardList size={24} className="mx-auto text-[#8a8a84]" />
        <p className="mt-3 text-sm text-[#6f6f69]">No survey questions yet.</p>
        <p className="mt-1 text-xs text-[#76766f]">A partner can add questions in the Manage tab.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-[#2d9e6b]/30 bg-[#e8f5ee] p-8 text-center">
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
      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
        <div>
          <h3 className="font-serif text-xl text-neutral-900">Purpose</h3>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            This short questionnaire is designed to help the organisation identify workload pressure, burnout risk, team frictions, and barriers to learning and growth. It is not a clinical diagnosis and should not be used to evaluate individual performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 border-t border-black/5">
          <p className="text-meta font-medium text-[#0f0f0f]">
            Recall period: <span className="font-normal text-[#5a5a56]">Past 2 weeks</span>
          </p>
          <div className="flex items-center gap-2">
            <ShieldCheck size={13} className="text-[#1e3a8a]" />
            <p className="text-meta text-[#1e3a8a]">
              Anonymous responses (redacted contributor list)
            </p>
          </div>
        </div>
      </div>

      {Object.entries(byCategory).map(([category, qs]) => (
        <section key={category} className="border-b border-neutral-200 pb-6">
          <h3 className="mb-4 border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900">
            {categoryLabels[category as SurveyCategory] ?? category}
          </h3>
          <div className="space-y-5">
            {qs.map((q) => (
              <label key={q.id} className="block">
                <span className="text-sm text-[#171717]">{q.text}</span>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-label text-[#8a8a84]">Strongly disagree</span>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setScores((s) => ({ ...s, [q.id]: n }))}
                        className={`h-5 w-5 rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a] ${
                          (scores[q.id] ?? 3) === n
                            ? 'border-[#1e3a8a] bg-[#1e3a8a]'
                            : 'border-neutral-300 hover:border-[#1e3a8a]'
                        }`}
                        aria-label={`Score ${n}`}
                      />
                    ))}
                  </div>
                  <span className="text-label text-[#8a8a84]">Strongly agree</span>
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
        className="h-10 w-full rounded-lg bg-[#1e3a8a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#172e6e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a] disabled:opacity-50 sm:w-auto"
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
      <div className="rounded-xl border border-dashed border-black/15 bg-white p-8 text-center">
        <p className="text-sm text-[#6f6f69]">No survey data is available.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#1e3a8a]" />
        <p className="text-xs leading-5 text-[#1e3a8a]">
          Current week starting{' '}
          {new Date(resultsQuery.data.currentWeekOf).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
          .{' '}
          {resultsQuery.data.currentCohortSize === null
            ? `Results stay hidden until at least ${resultsQuery.data.minimumCohortSize} people respond.`
            : `${resultsQuery.data.currentCohortSize} people are included in this anonymous cohort.`}
        </p>
      </div>

      <div>
        <h3 className="font-serif text-xl text-neutral-900">Question trends</h3>
        <p className="mt-0.5 text-meta text-[#8c8c86]">
          Cohort averages normalized so higher scores always mean greater concern
        </p>
      </div>

      {resultsQuery.data.questions.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/15 bg-white p-8 text-center">
          <p className="text-sm text-[#6f6f69]">No survey questions yet.</p>
        </div>
      )}
      {resultsQuery.data.questions.map((q) => (
        <section key={q.questionId} className="border-b border-neutral-200 pb-6">
          <div className="mb-1 text-label font-semibold uppercase tracking-[0.08em] text-[#76766f]">
            {categoryLabels[q.category as SurveyCategory] ?? q.category}
          </div>
          <h3 className="mb-4 border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900">{q.questionText}</h3>
          {q.weeks.length === 0 ? (
            <p className="text-xs text-[#76766f]">No responses yet.</p>
          ) : (
            <div className="space-y-3">
              {q.weeks.map((w) => (
                <div key={w.weekOf} className="flex items-center gap-4">
                  <span className="w-20 shrink-0 text-meta text-[#8c8c86]">
                    {new Date(w.weekOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="flex-1 overflow-hidden rounded-full bg-[#eeecea] h-2">
                    <div
                      className="h-full rounded-full bg-[#1e3a8a]"
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
    queryKey: ['surveyQuestions', 'all'],
    queryFn: () => listSurveyQuestions(false),
  })
  const [isAdding, setIsAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [newCategory, setNewCategory] = useState<SurveyCategory>('workload')
  const [newReverseScored, setNewReverseScored] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editCategory, setEditCategory] = useState<SurveyCategory>('workload')
  const [editReverseScored, setEditReverseScored] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      createSurveyQuestion({
        text: newText,
        category: newCategory,
        reverseScored: newReverseScored,
      }),
    onSuccess: () => {
      setNewText('')
      setNewReverseScored(false)
      setIsAdding(false)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['surveyQuestions'] })
    },
    onError: (caughtError) => setError(getErrorMessage(caughtError)),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      text,
      category,
      isActive,
      reverseScored,
    }: {
      id: string
      text?: string
      category?: SurveyCategory
      isActive?: boolean
      reverseScored?: boolean
    }) => updateSurveyQuestion(id, { text, category, isActive, reverseScored }),
    onSuccess: () => {
      setEditingId(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['surveyQuestions'] })
    },
    onError: (caughtError) => setError(getErrorMessage(caughtError)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSurveyQuestion(id),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['surveyQuestions'] })
    },
    onError: (caughtError) => setError(getErrorMessage(caughtError)),
  })

  const questions = questionsQuery.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-serif text-xl text-neutral-900">Survey questions</h3>
        <button
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#1e3a8a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#172e6e]"
          onClick={() => setIsAdding(true)}
          type="button"
        >
          <Plus size={13} />
          Add question
        </button>
      </div>

      {isAdding && (
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
          <div className="text-label font-semibold uppercase tracking-[0.08em] text-[#76766f]">
            New question
          </div>
          <input
            autoFocus
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
            onChange={(e) => setNewText(e.target.value)}
            placeholder="e.g. I feel supported by my team"
            value={newText}
          />
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs"
              onChange={(e) => setNewCategory(e.target.value as SurveyCategory)}
              value={newCategory}
            >
              {Object.entries(categoryLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-[#5a5a56]">
            <input
              checked={newReverseScored}
              onChange={(event) => setNewReverseScored(event.target.checked)}
              type="checkbox"
            />
            Positive statement (reverse score in reports)
          </label>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-3 py-2 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
              onClick={() => setIsAdding(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-[#1e3a8a] px-3 py-2 text-xs text-white disabled:bg-[#aaa9a3]"
              disabled={!newText.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              type="button"
            >
              {createMutation.isPending ? 'Adding...' : 'Add question'}
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
        <div className="divide-y divide-neutral-200/70">
          {questions.map((q) => (
            <div
              key={q.id}
              className={`py-4 transition-colors ${
                q.isActive ? '' : 'opacity-60'
              }`}
            >
              {editingId === q.id ? (
                <div className="space-y-3">
                  <input
                    autoFocus
                    className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/30"
                    onChange={(e) => setEditText(e.target.value)}
                    value={editText}
                  />
                  <div className="flex items-center gap-2">
                    <select
                      className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs"
                      onChange={(e) => setEditCategory(e.target.value as SurveyCategory)}
                      value={editCategory}
                    >
                      {Object.entries(categoryLabels).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#5a5a56]">
                    <input
                      checked={editReverseScored}
                      onChange={(event) => setEditReverseScored(event.target.checked)}
                      type="checkbox"
                    />
                    Positive statement (reverse score in reports)
                  </label>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg px-3 py-1.5 text-xs text-[#5a5a56] hover:bg-[#f4f3ef]"
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-lg bg-[#1e3a8a] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      disabled={!editText.trim() || updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: q.id,
                          text: editText,
                          category: editCategory,
                          reverseScored: editReverseScored,
                        })
                      }
                      type="button"
                    >
                      Save changes
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#0f0f0f]">{q.text}</p>
                    <p className="mt-0.5 text-label text-[#76766f]">
                      {categoryLabels[q.category as SurveyCategory] ?? q.category}
                      {' · '}
                      {q.reverseScored ? 'Reverse scored' : 'Direct scored'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-meta font-medium transition-colors ${
                        q.isActive
                          ? 'bg-[#e8f5ee] text-[#1a6b4a] hover:bg-[#d0edde]'
                          : 'bg-[#f4f3ef] text-[#6f6f69] hover:bg-[#eeecea]'
                      }`}
                      disabled={updateMutation.isPending}
                      onClick={() => updateMutation.mutate({ id: q.id, isActive: !q.isActive })}
                      type="button"
                    >
                      {q.isActive ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-lg text-[#8c8c86] hover:bg-[#f4f3ef] hover:text-[#5a5a56]"
                      onClick={() => {
                        setEditingId(q.id)
                        setEditText(q.text)
                        setEditCategory(q.category as SurveyCategory)
                        setEditReverseScored(q.reverseScored)
                      }}
                      title="Edit question"
                      type="button"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="grid h-8 w-8 place-items-center rounded-lg text-[#8c8c86] hover:bg-red-50 hover:text-red-600"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm('Delete this question and all its historical responses?')) {
                          deleteMutation.mutate(q.id)
                        }
                      }}
                      title="Delete question"
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
