import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clipboard, KeyRound, ShieldCheck, UsersRound } from 'lucide-react'
import {
  approveClassMember,
  archiveMentorshipClass,
  disableClassCode,
  leaveMentorshipClass,
  listClassJoinRequests,
  listClassMembers,
  removeClassMember,
  rejectClassMember,
  rotateClassCode,
  setClassMemberRole,
  transferClassOwnership,
} from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import type { ClassStatus } from '../../shared/types/workspace'

type ActiveClass = Extract<ClassStatus, { status: 'active' }>

export function ClassSettings({ status, currentUserId }: { status: ActiveClass; currentUserId: string }) {
  const queryClient = useQueryClient()
  const [newCode, setNewCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canManage = status.role === 'owner' || status.role === 'mentor'
  const members = useQuery({ queryKey: ['classMembers', status.classId], queryFn: listClassMembers })
  const requests = useQuery({ queryKey: ['classRequests', status.classId], queryFn: listClassJoinRequests, enabled: canManage })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['classMembers', status.classId] })
    void queryClient.invalidateQueries({ queryKey: ['classRequests', status.classId] })
    void queryClient.invalidateQueries({ queryKey: ['classStatus'] })
  }
  const invite = useMutation({
    mutationFn: rotateClassCode,
    onSuccess: ({ code }) => { setNewCode(code); setCopied(false); setError(null) },
    onError: (caught) => setError(getErrorMessage(caught)),
  })
  const approve = useMutation({
    mutationFn: approveClassMember,
    onSuccess: refresh,
    onError: (caught) => setError(getErrorMessage(caught)),
  })
  const reject = useMutation({ mutationFn: rejectClassMember, onSuccess: refresh, onError: (caught) => setError(getErrorMessage(caught)) })
  const role = useMutation({ mutationFn: setClassMemberRole, onSuccess: refresh, onError: (caught) => setError(getErrorMessage(caught)) })
  const disable = useMutation({ mutationFn: disableClassCode, onSuccess: () => { setNewCode(null); setError(null) }, onError: (caught) => setError(getErrorMessage(caught)) })
  const archive = useMutation({ mutationFn: archiveMentorshipClass, onSuccess: refresh, onError: (caught) => setError(getErrorMessage(caught)) })
  const remove = useMutation({
    mutationFn: removeClassMember,
    onSuccess: refresh,
    onError: (caught) => setError(getErrorMessage(caught)),
  })
  const transfer = useMutation({
    mutationFn: transferClassOwnership,
    onSuccess: refresh,
    onError: (caught) => setError(getErrorMessage(caught)),
  })
  const leave = useMutation({
    mutationFn: leaveMentorshipClass,
    onSuccess: refresh,
    onError: (caught) => setError(getErrorMessage(caught)),
  })

  async function copyCode() {
    if (!newCode) return
    try {
      await navigator.clipboard.writeText(newCode)
      setCopied(true)
    } catch {
      setError('Copy failed. Select the code and copy it manually.')
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm" aria-labelledby="class-settings-title">
      <div className="border-b border-line bg-gradient-to-br from-accent-tint to-card px-5 py-5 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-card text-accent shadow-sm"><UsersRound size={19} aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.13em] text-accent">Your team</p>
            <h2 id="class-settings-title" className="mt-0.5 truncate font-serif text-2xl text-ink">{status.name}</h2>
            <p className="mt-1 text-xs text-ink-secondary">You are a {status.role}. Personal work stays private until you share it.</p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        {canManage && (
          <div>
            <div className="flex items-center gap-2"><KeyRound size={16} className="text-accent" aria-hidden="true" /><h3 className="text-sm font-semibold">Invite code</h3></div>
            <p className="mt-1 text-xs leading-relaxed text-ink-secondary">Generate a code to invite someone. Codes expire after 24 hours and require your approval.</p>
            {newCode && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-fill px-4 py-3">
                <span className="select-all font-mono text-xl tracking-[0.2em] text-ink">{newCode}</span>
                <button type="button" onClick={() => void copyCode()} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-card">
                  {copied ? <Check size={15} /> : <Clipboard size={15} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
            <button type="button" disabled={invite.isPending} onClick={() => invite.mutate()} className="mt-3 rounded-lg border border-line-strong bg-card px-3.5 py-2 text-xs font-medium text-accent transition hover:bg-accent-tint disabled:opacity-60">
              {newCode ? 'Rotate code' : 'Generate code'}
            </button>
            <button type="button" disabled={disable.isPending} onClick={() => disable.mutate()} className="ml-2 rounded-lg px-3.5 py-2 text-xs font-medium text-danger hover:bg-danger-tint disabled:opacity-60">Disable code</button>
            {newCode && <p className="mt-2 text-xs text-ink-tertiary">This code is shown once. Rotating it invalidates the previous one.</p>}
          </div>
        )}

        {canManage && (
          <div className="border-t border-line pt-5">
            <h3 className="text-sm font-semibold">Join requests {requests.data?.length ? `(${requests.data.length})` : ''}</h3>
            {requests.isLoading ? <p className="mt-3 text-xs text-ink-secondary">Loading requests…</p>
              : requests.data?.length ? (
                <ul className="mt-3 space-y-2">
                  {requests.data.map((person) => (
                    <li key={person.id} className="flex items-center justify-between gap-3 rounded-xl bg-fill px-3 py-2.5">
                      <span className="min-w-0 truncate text-sm">{person.fullName || 'Unnamed user'}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" disabled={reject.isPending} onClick={() => reject.mutate(person.id)} className="rounded-lg px-2 py-1.5 text-xs font-medium text-danger hover:bg-danger-tint disabled:opacity-60">Reject</button>
                        <button type="button" disabled={approve.isPending} onClick={() => approve.mutate(person.id)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60">Approve</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-xs text-ink-secondary">No one is waiting for approval.</p>}
          </div>
        )}

        <div className="border-t border-line pt-5">
          <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-accent" aria-hidden="true" /><h3 className="text-sm font-semibold">Members</h3></div>
          {members.isLoading ? <p className="mt-3 text-xs text-ink-secondary">Loading members…</p> : (
            <ul className="mt-3 divide-y divide-line">
              {(members.data ?? []).map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0"><span className="block truncate">{person.fullName || 'Unnamed user'}{person.id === currentUserId ? ' (you)' : ''}</span><span className="text-xs capitalize text-ink-secondary">{person.role}</span></div>
                  {person.id !== currentUserId && person.role !== 'owner' && canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      {status.role === 'owner' && <button type="button" disabled={role.isPending} onClick={() => role.mutate({ userId: person.id, role: person.role === 'mentor' ? 'member' : 'mentor' })} className="rounded-lg px-2 py-1.5 text-xs text-accent hover:bg-accent-tint">{person.role === 'mentor' ? 'Remove mentor role' : 'Make mentor'}</button>}
                      {status.role === 'owner' && <button type="button" disabled={transfer.isPending} onClick={() => {
                        if (window.confirm(`Transfer ownership of ${status.name} to ${person.fullName || 'this member'}?`)) transfer.mutate(person.id)
                      }} className="rounded-lg px-2 py-1.5 text-xs text-accent hover:bg-accent-tint">Make owner</button>}
                      {(status.role === 'owner' || person.role === 'member') && <button type="button" disabled={remove.isPending} onClick={() => {
                        if (window.confirm(`Remove ${person.fullName || 'this member'}? They will lose access to this team.`)) remove.mutate(person.id)
                      }} className="rounded-lg px-2 py-1.5 text-xs text-danger hover:bg-danger-tint">Remove</button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {status.role !== 'owner' && <div className="border-t border-line pt-5">
          <p className="text-xs leading-relaxed text-ink-secondary">Leaving removes your access to this team, including content you created here. Your work stays in the team.</p>
          <button type="button" disabled={leave.isPending} onClick={() => {
            if (window.confirm(`Leave ${status.name}? You will lose access to its content.`)) leave.mutate()
          }} className="mt-3 rounded-lg px-3 py-2 text-xs font-medium text-danger hover:bg-danger-tint">Leave team</button>
        </div>}

        {status.role === 'owner' && <div className="border-t border-line pt-5">
          <p className="text-xs leading-relaxed text-ink-secondary">Archiving closes this team to everyone and disables its invite code. Its content stays stored.</p>
          <button type="button" disabled={archive.isPending} onClick={() => {
            if (window.confirm(`Archive ${status.name}? Everyone will lose access to this team's workspace.`)) archive.mutate()
          }} className="mt-3 rounded-lg px-3 py-2 text-xs font-medium text-danger hover:bg-danger-tint disabled:opacity-60">Archive team</button>
        </div>}

        {error && <p role="alert" className="rounded-lg bg-danger-tint px-3 py-2 text-xs text-danger">{error}</p>}
      </div>
    </section>
  )
}
