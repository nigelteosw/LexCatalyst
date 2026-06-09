import { useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ClipboardList,
  LockKeyhole,
  ShieldCheck,
  Users,
} from 'lucide-react'

const moods = [
  { label: 'Struggling', emoji: '😔' },
  { label: 'Getting by', emoji: '😐' },
  { label: 'Okay', emoji: '🙂' },
  { label: 'Good', emoji: '😊' },
  { label: 'Thriving', emoji: '🔥' },
]

const weeklyStats = [
  { value: '47h', label: 'This week' },
  { value: '6', label: 'Days since last day off' },
  { value: '8.2', label: 'Avg hrs sleep (est.)' },
  { value: '2', label: 'Disconnection violations' },
]

const indicators = [
  { label: 'Work-life boundary quality', value: 55, color: 'bg-[#8a5a00]' },
  { label: 'Sense of professional purpose', value: 78, color: 'bg-[#4aa073]' },
  { label: 'Learning and growth', value: 82, color: 'bg-[#4aa073]' },
  { label: 'Psychological safety in team', value: 65, color: 'bg-[#4aa073]' },
  { label: 'Clarity on progression criteria', value: 88, color: 'bg-[#4aa073]' },
  { label: 'Workload sustainability', value: 42, color: 'bg-[#8a2621]' },
]

const firmSignals = [
  { value: '23%', label: 'of juniors flagged workload concerns' },
  { value: '67%', label: 'feel progression criteria are clear' },
  { value: '41%', label: 'received a late-night message this week' },
]

const weeklyQuestions = [
  { id: 'workload', label: 'My workload felt manageable' },
  { id: 'support', label: 'I felt supported by my team' },
  { id: 'recovery', label: 'I had enough time to disconnect and recover' },
] as const

const seniorityData = [
  { level: 'Associates', respondents: 58, stress: 72, feedback: 58 },
  { level: 'Senior associates', respondents: 32, stress: 65, feedback: 64 },
  { level: 'Partners', respondents: 18, stress: 48, feedback: 72 },
  { level: 'Equity partners', respondents: 12, stress: 39, feedback: 76 },
]

const totalRespondents = seniorityData.reduce((total, group) => total + group.respondents, 0)
const weightedAverage = (field: 'stress' | 'feedback') =>
  Math.round(
    seniorityData.reduce((total, group) => total + group[field] * group.respondents, 0) /
      totalRespondents,
  )

export function WellbeingPanel() {
  const [activeDashboard, setActiveDashboard] = useState<'personal' | 'hr'>('personal')
  const [selectedMood, setSelectedMood] = useState('Struggling')
  const [isConversationGuideOpen, setIsConversationGuideOpen] = useState(false)
  const [weeklyAnswers, setWeeklyAnswers] = useState({
    workload: 3,
    support: 3,
    recovery: 3,
  })
  const [isWeeklySubmitted, setIsWeeklySubmitted] = useState(false)

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#fafaf8]">
      <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 lg:px-8">
        <div className="space-y-6">
          <header>
            <div className="flex items-center gap-2">
              <h2 className="text-[22px] font-semibold tracking-[-0.025em] text-[#0f0f0f]">
                {activeDashboard === 'personal' ? 'Wellbeing dashboard' : 'Firm wellbeing overview'}
              </h2>
              {activeDashboard === 'personal' ? (
                <LockKeyhole size={15} className="text-[#9a9a94]" aria-hidden="true" />
              ) : (
                <span className="rounded-full bg-[#eeecff] px-2 py-0.5 text-[10px] font-medium text-[#4a3db0]">
                  Mock HR view
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#8c8c86]">
              {activeDashboard === 'personal'
                ? 'Private to you — not visible to supervisors or the firm'
                : 'Illustrative anonymised aggregates for workforce planning'}
            </p>
          </header>

          <div
            className="inline-flex rounded-[10px] border border-black/10 bg-white p-1"
            role="tablist"
            aria-label="Wellbeing dashboard views"
          >
            <button
              aria-selected={activeDashboard === 'personal'}
              className={`inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-xs font-medium transition-colors ${
                activeDashboard === 'personal'
                  ? 'bg-[#0f0f0f] text-white'
                  : 'text-[#6f6f69] hover:bg-[#f4f3ef]'
              }`}
              onClick={() => setActiveDashboard('personal')}
              role="tab"
              type="button"
            >
              <LockKeyhole size={13} />
              My wellbeing
            </button>
            <button
              aria-selected={activeDashboard === 'hr'}
              className={`inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-xs font-medium transition-colors ${
                activeDashboard === 'hr'
                  ? 'bg-[#0f0f0f] text-white'
                  : 'text-[#6f6f69] hover:bg-[#f4f3ef]'
              }`}
              onClick={() => setActiveDashboard('hr')}
              role="tab"
              type="button"
            >
              <Users size={13} />
              HR overview
            </button>
          </div>

          {activeDashboard === 'personal' ? (
            <>
              <section className="rounded-[14px] border border-black/10 bg-white p-4 sm:p-5">
            <h3 className="text-base font-semibold text-[#0f0f0f]">How are you doing today?</h3>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              {moods.map((mood) => {
                const isSelected = selectedMood === mood.label
                return (
                  <button
                    key={mood.label}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedMood(mood.label)}
                    className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-[10px] border px-3 py-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6b4a]/40 ${
                      isSelected
                        ? 'border-[#2d9e6b] bg-[#e8f5ee] text-[#1a6b4a]'
                        : 'border-black/10 bg-white text-[#969690] hover:bg-[#f4f3ef] hover:text-[#5a5a56]'
                    }`}
                    type="button"
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {mood.emoji}
                    </span>
                    {mood.label}
                  </button>
                )
              })}
            </div>
          </section>

              <section className="rounded-[14px] border border-black/10 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ClipboardList size={16} className="text-[#5a5a56]" aria-hidden="true" />
                      <h3 className="text-base font-semibold text-[#0f0f0f]">
                        Weekly questionnaire
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-[#8c8c86]">
                      Three private questions. 1 means strongly disagree; 5 means strongly agree.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#e8f5ee] px-2.5 py-1 text-[10px] font-medium text-[#1a6b4a]">
                    Week 24
                  </span>
                </div>

                <div className="mt-5 space-y-5">
                  {weeklyQuestions.map((question) => (
                    <label key={question.id} className="block">
                      <span className="flex items-center justify-between gap-4 text-sm text-[#171717]">
                        {question.label}
                        <span className="font-serif text-lg italic text-[#5a5a56]">
                          {weeklyAnswers[question.id]}/5
                        </span>
                      </span>
                      <input
                        aria-label={question.label}
                        className="mt-2 h-1.5 w-full cursor-pointer accent-[#1a6b4a]"
                        max="5"
                        min="1"
                        onChange={(event) => {
                          setIsWeeklySubmitted(false)
                          setWeeklyAnswers((answers) => ({
                            ...answers,
                            [question.id]: Number(event.target.value),
                          }))
                        }}
                        type="range"
                        value={weeklyAnswers[question.id]}
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <p className="text-xs text-[#8c8c86]">
                    Answers stay on this mock dashboard and are not sent anywhere.
                  </p>
                  <button
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] bg-[#0f0f0f] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#333] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
                    onClick={() => setIsWeeklySubmitted(true)}
                    type="button"
                  >
                    {isWeeklySubmitted && <Check size={13} />}
                    {isWeeklySubmitted ? 'Saved' : 'Save check-in'}
                  </button>
                </div>
              </section>

          <section aria-label="Weekly wellbeing summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {weeklyStats.map((stat) => (
              <article key={stat.label} className="rounded-[12px] bg-[#f4f3ef] px-4 py-5">
                <div className="font-serif text-[28px] italic leading-none text-[#0f0f0f]">
                  {stat.value}
                </div>
                <div className="mt-3 text-xs text-[#8c8c86]">{stat.label}</div>
              </article>
            ))}
          </section>

          <div className="flex items-start gap-3 rounded-[12px] border border-[#8a5a00]/20 bg-[#fef3dc] px-4 py-3 text-sm leading-6 text-[#805400]">
            <AlertTriangle size={16} className="mt-1 shrink-0" aria-hidden="true" />
            <p>
              You&apos;ve had 2 messages from James Whitmore after 9pm this week. This is
              tracked under Principle 4. You can flag these anonymously or speak to a
              Sustainability Ambassador.
            </p>
          </div>

          <section>
            <h3 className="mb-3 text-base font-semibold text-[#0f0f0f]">
              Wellbeing indicators — rolling 4 weeks
            </h3>
            <div className="space-y-2">
              {indicators.map((indicator) => (
                <article
                  key={indicator.label}
                  className="flex items-center gap-4 rounded-[10px] border border-black/10 bg-white px-4 py-3"
                >
                  <span className="min-w-0 flex-1 text-sm text-[#171717]">
                    {indicator.label}
                  </span>
                  <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[#eeecea] sm:w-28">
                    <div
                      className={`h-full rounded-full ${indicator.color}`}
                      style={{ width: `${indicator.value}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-xs text-[#8c8c86]">
                    {indicator.value}%
                  </span>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <article className="rounded-[14px] border border-black/10 bg-white p-5">
              <h3 className="text-sm font-semibold text-[#0f0f0f]">Protected time this week</h3>
              <div className="my-2 font-serif text-[30px] italic leading-none text-[#0f0f0f]">
                4h
              </div>
              <p className="text-xs leading-5 text-[#6f6f69]">
                Of your allocated 8h protected hours used for learning and non-billable
                development. Unused hours roll to next week, up to two weeks.
              </p>
            </article>

            <article className="rounded-[14px] border border-black/10 bg-white p-5">
              <h3 className="text-sm font-semibold text-[#0f0f0f]">
                Sustainability Ambassador
              </h3>
              <p className="my-2 text-xs leading-5 text-[#6f6f69]">
                Your team&apos;s ambassador is <strong>James Park</strong>, senior associate. He is
                available for confidential peer support and can help you plan the next step.
              </p>
              <button
                aria-expanded={isConversationGuideOpen}
                onClick={() => setIsConversationGuideOpen((isOpen) => !isOpen)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-[9px] bg-[#0f0f0f] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#333] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
                type="button"
              >
                {isConversationGuideOpen ? 'Hide conversation guide' : 'Prepare for that conversation'}
                <ArrowUpRight size={13} />
              </button>
              {isConversationGuideOpen && (
                <div className="mt-3 rounded-[10px] bg-[#f4f3ef] p-3 text-xs leading-5 text-[#5a5a56]">
                  <strong className="text-[#0f0f0f]">Private preparation notes</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>Describe the pattern and how it is affecting your work.</li>
                    <li>Choose the boundary or support you want to request.</li>
                    <li>Ask what can remain confidential before sharing details.</li>
                  </ul>
                </div>
              )}
            </article>
          </section>

          <section className="rounded-[14px] border border-black/10 bg-white p-5">
            <h3 className="text-sm font-semibold text-[#0f0f0f]">
              Firm-wide anonymised signals — this month
            </h3>
            <p className="mt-2 text-xs leading-5 text-[#6f6f69]">
              These patterns are shared only as aggregate trends. They help the firm identify
              systemic issues without exposing individual data.
            </p>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
              {firmSignals.map((signal) => (
                <article
                  key={signal.label}
                  className="rounded-[10px] bg-[#f4f3ef] px-4 py-4 text-center"
                >
                  <div className="font-serif text-2xl italic text-[#0f0f0f]">{signal.value}</div>
                  <div className="mt-1 text-[11px] leading-4 text-[#8c8c86]">{signal.label}</div>
                </article>
              ))}
            </div>
          </section>
            </>
          ) : (
            <HrOverview />
          )}
        </div>
      </div>
    </section>
  )
}

function HrOverview() {
  return (
    <>
      <div className="flex items-start gap-3 rounded-[12px] border border-[#4a3db0]/15 bg-[#eeecff] px-4 py-3 text-sm leading-6 text-[#4a3db0]">
        <ShieldCheck size={17} className="mt-1 shrink-0" aria-hidden="true" />
        <p>
          Mock data only. This view contains anonymised group trends and must not expose
          individual questionnaire answers or groups below a safe reporting threshold.
        </p>
      </div>

      <section aria-label="HR wellbeing summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { value: '76%', label: 'Weekly response rate' },
          { value: `${weightedAverage('stress')}%`, label: 'Average stress risk' },
          { value: `${weightedAverage('feedback')}%`, label: 'Positive feedback score' },
          { value: '4', label: 'Seniority groups reporting' },
        ].map((stat) => (
          <article key={stat.label} className="rounded-[12px] bg-[#f4f3ef] px-4 py-5">
            <div className="font-serif text-[28px] italic leading-none text-[#0f0f0f]">
              {stat.value}
            </div>
            <div className="mt-3 text-xs text-[#8c8c86]">{stat.label}</div>
          </article>
        ))}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#0f0f0f]">
              Stress and feedback by seniority
            </h3>
            <p className="mt-1 text-xs text-[#8c8c86]">
              Higher stress is worse; higher positive feedback is better.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-[#8c8c86]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#a33a32]" />
              Stress risk
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#4aa073]" />
              Positive feedback
            </span>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {seniorityData.map((group) => (
            <article
              key={group.level}
              className="rounded-[14px] border border-black/10 bg-white p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-[#0f0f0f]">{group.level}</h4>
                  <p className="mt-0.5 text-[10px] text-[#9a9a94]">
                    {group.respondents} mock respondents
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                    group.stress >= 65
                      ? 'bg-[#fdeeed] text-[#8a1f1f]'
                      : 'bg-[#fef3dc] text-[#8a5a00]'
                  }`}
                >
                  {group.stress >= 65 ? 'Needs attention' : 'Monitor'}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <MetricBar
                  color="bg-[#a33a32]"
                  label="Stress risk"
                  value={group.stress}
                />
                <MetricBar
                  color="bg-[#4aa073]"
                  label="Positive feedback"
                  value={group.feedback}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[14px] border border-black/10 bg-white p-5">
        <h3 className="text-sm font-semibold text-[#0f0f0f]">Mock HR interpretation</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <InsightCard
            label="Priority"
            text="Associates report the highest stress risk and the lowest positive-feedback score."
            tone="red"
          />
          <InsightCard
            label="Watch"
            text="Senior associates remain above the firm stress average despite stronger feedback."
            tone="amber"
          />
          <InsightCard
            label="Action"
            text="Review workload allocation and manager feedback cadence before the next pulse."
            tone="green"
          />
        </div>
      </section>
    </>
  )
}

function MetricBar({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: number
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="text-[#5a5a56]">{label}</span>
        <span className="font-medium text-[#0f0f0f]">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#eeecea]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function InsightCard({
  label,
  text,
  tone,
}: {
  label: string
  text: string
  tone: 'red' | 'amber' | 'green'
}) {
  const tones = {
    red: 'bg-[#fdeeed] text-[#8a1f1f]',
    amber: 'bg-[#fef3dc] text-[#8a5a00]',
    green: 'bg-[#e8f5ee] text-[#1a6b4a]',
  }

  return (
    <article className={`rounded-[10px] p-4 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</div>
      <p className="mt-2 text-xs leading-5">{text}</p>
    </article>
  )
}
