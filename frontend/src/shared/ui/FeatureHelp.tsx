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
  top: 'bg-fill text-ink border-line',
  mid: 'bg-fill text-ink border-line',
  base: 'bg-fill text-ink-secondary border-line',
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
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-ink-tertiary transition hover:bg-fill hover:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => setOpen(true)}
          title={`How ${title} works`}
          type="button"
        >
          <CircleHelp size={12} strokeWidth={1.5} />
        </button>
      ) : (
      <button
        aria-label={`How ${title} works`}
        className="t-label inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-2.5 py-1 text-ink-secondary transition hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setOpen(true)}
        type="button"
      >
        <CircleHelp size={12} strokeWidth={1.5} />
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
      className="viewport-overlay fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-label={`${title} guide`}
    >
      <div className="flex max-h-[calc(var(--app-height,100dvh)-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-lg flex-col overflow-hidden rounded-[10px] bg-card shadow-[0_16px_48px_oklch(0.2_0.01_260/0.18)]">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="text-ink-secondary" size={16} strokeWidth={1.5} />
              <span className="t-label uppercase text-ink-secondary">
                Getting started
              </span>
            </div>
            <h2 className="t-h2 text-ink">{title}</h2>
            <p className="t-body mt-1 text-ink-secondary">{content.intro}</p>
          </div>
          <button
            aria-label="Close guide"
            className="mt-0.5 shrink-0 rounded-md p-1.5 text-ink-tertiary hover:bg-fill hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="app-scroll-region overflow-y-auto px-5 py-4">

          {/* Steps */}
          <div className="mb-5">
            <div className="t-label mb-3 flex items-center gap-1.5 uppercase text-ink-tertiary">
              <BookOpen size={12} strokeWidth={1.5} />
              How to use it
            </div>
            <ol className="space-y-3">
              {content.steps.map((step, i) => (
                <li key={i} className="flex gap-3 rounded-md border border-line bg-fill px-4 py-3">
                  <span className="mt-0.5 shrink-0 text-lg leading-none" role="img" aria-hidden="true">
                    {step.emoji}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="t-micro flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-fill-pressed text-ink-secondary">
                        {i + 1}
                      </span>
                      <p className="t-body-strong text-ink">{step.title}</p>
                    </div>
                    <p className="t-meta mt-1 text-ink-secondary">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Role table */}
          {content.roles && content.roles.length > 0 && (
            <div className="mb-5">
              <div className="t-label mb-3 flex items-center gap-1.5 uppercase text-ink-tertiary">
                <ShieldCheck size={12} strokeWidth={1.5} />
                Who can do what
              </div>
              <div className="space-y-2">
                {content.roles.map((role) => (
                  <div
                    key={role.label}
                    className={`rounded-md border px-4 py-3 ${TIER_CLASSES[role.tier]}`}
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="t-body-strong">{role.label}</span>
                    </div>
                    <ul className="space-y-1">
                      {role.abilities.map((ability) => (
                        <li key={ability} className="t-meta flex items-start gap-1.5">
                          <CheckCircle2 className="mt-px shrink-0 opacity-60" size={11} strokeWidth={1.5} />
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
            <div className="rounded-md border border-line bg-fill px-4 py-3">
              <p className="t-label mb-1.5 uppercase text-ink-secondary">
                Good to know
              </p>
              <ul className="space-y-1.5">
                {content.tips.map((tip) => (
                  <li key={tip} className="t-meta text-ink-secondary">
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-hairline px-5 py-3">
          <button
            className="t-body w-full rounded-md bg-accent py-2.5 font-semibold text-white hover:bg-accent-hover"
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
