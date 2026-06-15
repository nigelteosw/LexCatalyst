import { useState } from 'react'
import { BookOpen, CheckCircle2, CircleHelp, ShieldCheck, Sparkles, X } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HelpStep = {
  emoji: string
  title: string
  body: string
}

export type HelpRole = {
  label: string
  /** Visual emphasis tier */
  tier: 'top' | 'mid' | 'base'
  abilities: string[]
}

export type HelpContent = {
  /** One-sentence summary shown under the modal title */
  intro: string
  /** Numbered getting-started steps */
  steps: HelpStep[]
  /** Optional role table — omit for features with no role differences */
  roles?: HelpRole[]
  /** Optional free-text tips shown at the bottom */
  tips?: string[]
}

type FeatureHelpProps = {
  title: string
  content: HelpContent
  /** 'compact' shows only the icon — for tight headers like Birdie */
  size?: 'default' | 'compact'
}

// ---------------------------------------------------------------------------
// Trigger button
// ---------------------------------------------------------------------------

const TIER_CLASSES: Record<HelpRole['tier'], string> = {
  top: 'bg-purple-50 text-purple-700 border-purple-200',
  mid: 'bg-blue-50 text-blue-700 border-blue-200',
  base: 'bg-neutral-50 text-neutral-600 border-neutral-200',
}

const TIER_DOT: Record<HelpRole['tier'], string> = {
  top: 'bg-purple-400',
  mid: 'bg-blue-400',
  base: 'bg-neutral-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeatureHelp({ title, content, size = 'default' }: FeatureHelpProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {size === 'compact' ? (
        <button
          aria-label={`How ${title} works`}
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-amber-500 transition hover:bg-amber-50 hover:text-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
          onClick={() => setOpen(true)}
          title={`How ${title} works`}
          type="button"
        >
          <CircleHelp size={12} />
        </button>
      ) : (
      <button
        aria-label={`How ${title} works`}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
        onClick={() => setOpen(true)}
        type="button"
      >
        <CircleHelp size={12} />
        <span className="hidden sm:inline">How it works</span>
        <span className="sm:hidden">Guide</span>
      </button>
      )}

      {open && (
        <HelpModal title={title} content={content} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function HelpModal({
  title,
  content,
  onClose,
}: {
  title: string
  content: HelpContent
  onClose: () => void
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-label={`${title} guide`}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 bg-gradient-to-b from-amber-50 to-white px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="text-amber-500" size={16} />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">
                Getting started
              </span>
            </div>
            <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
            <p className="mt-0.5 text-sm leading-5 text-neutral-500">{content.intro}</p>
          </div>
          <button
            aria-label="Close guide"
            className="mt-0.5 shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="app-scroll-region overflow-y-auto px-5 py-4">

          {/* Steps */}
          <div className="mb-5">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
              <BookOpen size={12} />
              How to use it
            </div>
            <ol className="space-y-3">
              {content.steps.map((step, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
                  <span className="mt-0.5 shrink-0 text-lg leading-none" role="img" aria-hidden="true">
                    {step.emoji}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[9px] font-bold text-neutral-600">
                        {i + 1}
                      </span>
                      <p className="text-sm font-semibold text-neutral-900">{step.title}</p>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Role table */}
          {content.roles && content.roles.length > 0 && (
            <div className="mb-5">
              <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
                <ShieldCheck size={12} />
                Who can do what
              </div>
              <div className="space-y-2">
                {content.roles.map((role) => (
                  <div
                    key={role.label}
                    className={`rounded-xl border px-4 py-3 ${TIER_CLASSES[role.tier]}`}
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${TIER_DOT[role.tier]}`} />
                      <span className="text-xs font-bold">{role.label}</span>
                    </div>
                    <ul className="space-y-1">
                      {role.abilities.map((ability) => (
                        <li key={ability} className="flex items-start gap-1.5 text-xs">
                          <CheckCircle2 className="mt-px shrink-0 opacity-60" size={11} />
                          {ability}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          {content.tips && content.tips.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-600">
                💡 Good to know
              </p>
              <ul className="space-y-1.5">
                {content.tips.map((tip) => (
                  <li key={tip} className="text-xs leading-5 text-amber-800">
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-neutral-100 px-5 py-3">
          <button
            className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
            onClick={onClose}
            type="button"
          >
            Got it — let me explore
          </button>
        </div>
      </div>
    </div>
  )
}
