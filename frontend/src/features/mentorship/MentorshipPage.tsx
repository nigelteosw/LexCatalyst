export function MentorshipPage({ menteeId }: { menteeId: string | null }) {
  return (
    <div className="bg-surface p-6">
      <h1 className="font-serif text-4xl text-ink">Mentorship</h1>
      {menteeId ? <p className="mt-2 text-ink-secondary">Mentee view</p> : null}
    </div>
  )
}
