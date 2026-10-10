import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole, ShieldCheck, UsersRound } from 'lucide-react'
import { createMentorshipClass, joinMentorshipClass } from '../../shared/api/api'
import type { ClassStatus } from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { formatClassCodeInput } from './classState'

type Props = {
  status: ClassStatus
  onChanged: () => Promise<unknown>
  onLogout: () => void
}

export function ClassOnboarding({ status, onChanged, onLogout }: Props) {
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') await createMentorshipClass(name.trim())
      else await joinMentorshipClass(code)
      await onChanged()
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-scroll-region flex h-dvh min-h-0 overflow-y-auto bg-surface text-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-12">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-xl" />
            <span className="t-wordmark">LexCatalyst</span>
          </div>
          <button type="button" onClick={onLogout} className="rounded-lg px-3 py-2 text-sm text-ink-secondary transition hover:bg-fill hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
            Sign out
          </button>
        </header>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,430px)] lg:gap-20">
          <section className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-accent shadow-sm">
              <ShieldCheck size={14} aria-hidden="true" /> Private mentorship workspace
            </div>
            <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Learn together.<br /><span className="text-accent">Keep your work yours.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-secondary sm:text-lg">
              Your team gives you a place to share selected knowledge with the people learning alongside you. Personal chats, memories, and unshared files stay private.
            </p>
            <div className="mt-9 hidden max-w-xl gap-4 sm:grid sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-accent-tint text-accent"><UsersRound size={18} aria-hidden="true" /></div>
                <h2 className="font-medium">A space for your team</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">Join with a code, then wait for a team lead to approve your request.</p>
              </div>
              <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-fill text-ink-secondary"><LockKeyhole size={18} aria-hidden="true" /></div>
                <h2 className="font-medium">Share by choice</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">Your private work is visible only to you until you choose an audience.</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-card p-6 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.35)] sm:p-8" aria-labelledby="class-onboarding-title">
            {status.status === 'pending' ? (
              <>
                <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-accent-tint text-accent"><UsersRound size={23} aria-hidden="true" /></div>
                <h2 id="class-onboarding-title" className="font-serif text-3xl">Request sent</h2>
                <p className="mt-3 text-sm leading-relaxed text-ink-secondary">A team lead needs to approve your request. Your workspace will open once they do.</p>
                <button type="button" onClick={() => void onChanged()} className="mt-7 inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                  Check for approval
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Get started</p>
                <h2 id="class-onboarding-title" className="mt-2 font-serif text-3xl">Your team awaits</h2>
                <p className="mt-2 text-sm text-ink-secondary">Join an existing team or start one for your group.</p>
                <div className="mt-7 grid grid-cols-2 rounded-xl bg-fill p-1" role="group" aria-label="Choose how to begin">
                  {(['join', 'create'] as const).map((choice) => (
                    <button key={choice} type="button" onClick={() => { setMode(choice); setError(null) }} aria-pressed={mode === choice}
                      className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${mode === choice ? 'bg-card text-accent shadow-sm' : 'text-ink-secondary hover:text-ink'}`}>
                      {choice === 'join' ? 'Join a team' : 'Create a team'}
                    </button>
                  ))}
                </div>
                <form onSubmit={submit} className="mt-7">
                  {mode === 'join' ? (
                    <>
                      <label htmlFor="class-code" className="mb-2 block text-sm font-medium">Six-digit team code</label>
                      <input id="class-code" inputMode="numeric" autoComplete="one-time-code" value={code}
                        onChange={(event) => setCode(formatClassCodeInput(event.target.value))} placeholder="000-000" maxLength={7} required pattern="[0-9]{3}-[0-9]{3}"
                        className="w-full rounded-xl border border-line-strong bg-card px-4 py-3 font-mono text-lg tracking-[0.2em] outline-none transition placeholder:text-ink-tertiary focus:border-accent focus:ring-2 focus:ring-accent/15" />
                      <p className="mt-2 text-xs text-ink-secondary">Ask your team lead for the code. They will approve your request.</p>
                    </>
                  ) : (
                    <>
                      <label htmlFor="class-name" className="mb-2 block text-sm font-medium">Team name</label>
                      <input id="class-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Autumn intake" minLength={2} maxLength={160} required
                        className="w-full rounded-xl border border-line-strong bg-card px-4 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15" />
                      <p className="mt-2 text-xs text-ink-secondary">You will manage this team and approve new members.</p>
                    </>
                  )}
                  {error && <p className="mt-4 rounded-xl border border-danger/20 bg-danger-tint px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
                  <button disabled={busy} type="submit" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60">
                    {busy ? 'Working…' : mode === 'join' ? 'Request to join' : 'Create team'} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
        <p className="text-xs text-ink-tertiary">Your team controls access to shared knowledge. Personal work remains yours.</p>
      </div>
    </main>
  )
}
