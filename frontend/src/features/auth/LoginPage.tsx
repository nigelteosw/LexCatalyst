import { useEffect, useRef, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { BookMarked, ClipboardCheck, HeartPulse, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'

export interface LoginPageProps {
  onLoginSuccess: (credential: string) => void
  onLoginError: (message: string) => void
  error?: string | null
}

const FEATURES = [
  { icon: Sparkles, label: 'Birdie', desc: 'A private mentor that turns senior feedback into lessons' },
  { icon: ClipboardCheck, label: 'Workboard', desc: 'Delegate, review and redline matter work' },
  { icon: BookMarked, label: 'Knowledge Bank', desc: 'Your firm’s playbooks, style guides and precedents' },
  { icon: HeartPulse, label: 'Wellbeing', desc: 'Anonymous team check-ins that surface workload early' },
]

// Each line describes behaviour that exists in the product; do not add claims
// (certifications, uptime, etc.) that the code does not back up.
const TRUST = [
  'Access is scoped to your workspace, team and matter. Nothing crosses matters by default.',
  'Client names are encrypted at rest.',
  'Knowledge shared firm-wide is checked for personal data first, and every access is logged.',
  'Conversations with Birdie are never stored or shown to supervisors.',
]

export function LoginPage({ onLoginSuccess, onLoginError, error }: LoginPageProps) {
  const googleContainerRef = useRef<HTMLDivElement>(null)
  const [googleBtnWidth, setGoogleBtnWidth] = useState(280)

  useEffect(() => {
    const el = googleContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setGoogleBtnWidth(Math.floor(entry.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="app-scroll-region flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[#fafaf8] lg:flex-row">
      {/* Brand panel */}
      <div className="pearl-black flex flex-1 flex-col justify-between px-8 py-10 text-white lg:px-16 lg:py-14">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/20 font-serif text-lg italic">
            L
          </div>
          <span className="font-serif text-xl italic tracking-tight">LexCatalyst</span>
        </div>

        <div className="my-12 max-w-xl lg:my-0">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Mentorship that happens
            <br />
            while the work gets done.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/60">
            Seniors review as they always do. Juniors learn from every comment, privately, with their
            firm’s own knowledge behind them.
          </p>

          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <li key={label} className="flex items-start gap-3.5">
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white/80">
                  <Icon aria-hidden="true" size={16} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">{label}</div>
                  <div className="text-sm text-white/55">{desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden text-xs text-white/40 lg:block">Designed for confidential legal work.</p>
      </div>

      {/* Sign-in panel */}
      <div className="flex shrink-0 items-center justify-center px-6 py-14 lg:w-[480px] lg:px-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-900">Sign in</h2>
          <p className="mt-1.5 text-sm text-neutral-600">
            Use your firm Google account to access your workspace.
          </p>

          {error && (
            <div
              className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div ref={googleContainerRef} className="w-full overflow-hidden">
              <GoogleLogin
                onSuccess={(cred) => {
                  if (cred.credential) onLoginSuccess(cred.credential)
                }}
                onError={() => onLoginError('Google sign-in failed. Please try again.')}
                useOneTap
                shape="rectangular"
                theme="outline"
                width={String(googleBtnWidth)}
              />
            </div>
          </div>

          <section aria-labelledby="trust-heading" className="mt-8 rounded-xl border border-neutral-200 bg-white/60 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900" id="trust-heading">
              <LockKeyhole aria-hidden="true" size={15} className="text-[#1a6b4a]" />
              Built for client confidentiality
            </h3>
            <ul className="mt-3 space-y-2.5">
              {TRUST.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[13px] leading-5 text-neutral-600">
                  <ShieldCheck aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-[#1a6b4a]" />
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-5 text-xs leading-relaxed text-neutral-500">
            By signing in you agree to your firm’s acceptable-use and data-handling policies.
          </p>
        </div>
      </div>
    </div>
  )
}
