import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createPairing, endPairing, listClassMembers, listPairings } from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import type { ClassStatus } from '../../shared/types/workspace'
import { Button } from '../../shared/ui/Button'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'

type ActiveClass = Extract<ClassStatus, { status: 'active' }>

// Pairings are the mentor → mentee links that decide who can see whose feedback.
// Owners pair anyone; mentors can only pair themselves as the mentor. Plain members see the list only.
export function MentoringSection({ status, currentUserId }: { status: ActiveClass; currentUserId: string }) {
  const queryClient = useQueryClient()
  const canManage = status.role === 'owner' || status.role === 'mentor'
  const members = useQuery({ queryKey: ['classMembers', status.classId], queryFn: listClassMembers })
  const pairings = useQuery({ queryKey: ['mentorship', 'pairings'], queryFn: listPairings })
  const [chosenMentor, setChosenMentor] = useState('')
  const [menteeId, setMenteeId] = useState('')

  const mentorId = status.role === 'mentor' ? currentUserId : chosenMentor
  const mentorOptions = (members.data ?? []).filter(
    (m) => m.role !== 'member' && (status.role === 'owner' || m.id === currentUserId),
  )
  const menteeOptions = (members.data ?? []).filter((m) => m.id !== mentorId)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mentorship', 'pairings'] })
    queryClient.invalidateQueries({ queryKey: ['mentorship', 'me'] })
  }
  const create = useMutation({
    mutationFn: () => createPairing({ mentorUserId: mentorId, menteeUserId: menteeId }),
    onSuccess: () => {
      setMenteeId('')
      refresh()
    },
  })
  const end = useMutation({ mutationFn: (pairingId: string) => endPairing(pairingId), onSuccess: refresh })

  const error = create.error ?? end.error ?? pairings.error

  return (
    <section className="mt-10 border-t border-line pt-8">
      <h2 className="mb-1 font-serif text-2xl text-ink">Mentoring</h2>
      <p className="mb-4 text-sm text-ink-secondary">
        A mentor sees a mentee's feedback and lessons only while they are paired. Chats, Birdie conversations and memories stay private.
      </p>

      {error && <ErrorBanner className="mb-4" message={getErrorMessage(error)} />}

      <ul className="mb-6 space-y-2">
        {(pairings.data ?? []).length === 0 && <li className="text-sm text-ink-secondary">No pairings yet.</li>}
        {(pairings.data ?? []).map((pairing) => {
          const mayEnd = canManage && (status.role === 'owner' || pairing.mentorUserId === currentUserId)
          return (
            <li key={pairing.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3">
              <span className="text-sm text-ink">
                {pairing.mentorName} <span className="text-ink-secondary">mentors</span> {pairing.menteeName}
              </span>
              {mayEnd && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={end.isPending}
                  onClick={() => {
                    if (window.confirm(`End the mentoring pairing with ${pairing.menteeName}? Their feedback will no longer be visible to ${pairing.mentorName}.`)) {
                      end.mutate(pairing.id)
                    }
                  }}
                >
                  End
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {canManage && (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <label className="text-sm text-ink-secondary">
            Mentor
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={mentorId}
              disabled={status.role === 'mentor'}
              onChange={(event) => setChosenMentor(event.target.value)}
            >
              <option value="">Choose a mentor</option>
              {mentorOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName || 'Unnamed user'}{m.id === currentUserId ? ' (you)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink-secondary">
            Mentee
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              value={menteeId}
              onChange={(event) => setMenteeId(event.target.value)}
            >
              <option value="">Choose a mentee</option>
              {menteeOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.fullName || 'Unnamed user'}</option>
              ))}
            </select>
          </label>
          <Button variant="primary" type="submit" disabled={create.isPending || !mentorId || !menteeId}>
            {create.isPending ? 'Pairing…' : 'Add pairing'}
          </Button>
        </form>
      )}
    </section>
  )
}
