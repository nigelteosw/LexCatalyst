import { useState } from 'react'
import { Check, Settings, UserPlus, UserMinus, UserRound, Users } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createDummyUsers,
  deleteDummyUsers,
  listFirmUsers,
  updateCurrentUserRole,
  updateOtherUserRole,
} from '../../shared/api/api'
import type { CurrentUser, FirmRole } from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { userLabel } from '../actions/config'

type SettingsPanelProps = {
  currentUser: CurrentUser | null
}

const roles: Array<{
  id: FirmRole | 'admin'
  label: string
  description: string
}> = [
  {
    id: 'admin',
    label: 'Administrator',
    description: 'System-wide configuration, roster management, and development tools.',
  },
  {
    id: 'partner',
    label: 'Partner',
    description: 'Firm-wide knowledge, survey oversight, and full workflow controls.',
  },
  {
    id: 'senior_associate',
    label: 'Senior Associate',
    description: 'Create and manage knowledge and action items.',
  },
  {
    id: 'associate',
    label: 'Junior Associate',
    description: 'Use assigned matters, documents, knowledge, and personal workflows.',
  },
]

export function SettingsPanel({ currentUser }: SettingsPanelProps) {
  const queryClient = useQueryClient()
  const [selectedRole, setSelectedRole] = useState<FirmRole | 'admin' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const effectiveRole = selectedRole ?? (currentUser?.isAdmin ? 'admin' : currentUser?.firmRole ?? 'associate')

  const mutation = useMutation({
    mutationFn: (role: FirmRole) => updateCurrentUserRole(role),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['currentUser'], updatedUser)
      const savedUser = JSON.parse(localStorage.getItem('user') ?? '{}')
      localStorage.setItem(
        'user',
        JSON.stringify({ ...savedUser, firm_role: updatedUser.firmRole, is_admin: updatedUser.isAdmin }),
      )
      setSelectedRole(null)
      setMessage('Your role has been updated.')
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Could not update your role.')
    },
  })

  const addDummyMutation = useMutation({
    mutationFn: () => createDummyUsers(2),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmUsers'] })
      setMessage('Sarah Chen and Jane Pereira added.')
    },
    onError: (error) => {
      setMessage(getErrorMessage(error))
    },
  })

  const clearDummyMutation = useMutation({
    mutationFn: deleteDummyUsers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmUsers'] })
      queryClient.invalidateQueries({ queryKey: ['actions'] })
      setMessage('All dummy users cleared.')
    },
    onError: (error) => {
      setMessage(getErrorMessage(error))
    },
  })

  const usersQuery = useQuery({
    queryKey: ['firmUsers'],
    queryFn: listFirmUsers,
    enabled: !!currentUser?.isAdmin,
  })

  const otherUserMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: FirmRole }) =>
      updateOtherUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmUsers'] })
      queryClient.invalidateQueries({ queryKey: ['actions'] })
      setMessage('User role updated.')
    },
    onError: (error) => {
      setMessage(getErrorMessage(error))
    },
  })

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#fafaf8]">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-black/10 bg-white px-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#0f0f0f] text-white">
          <Settings size={16} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#0f0f0f]">Settings</h2>
          <p className="text-[10px] text-[#8c8c86]">Profile and workspace access</p>
        </div>
      </header>

      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-8">
        <div className="mx-auto max-w-2xl space-y-8">
          <div className="rounded-xl border border-black/10 bg-white p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f4f3ef] text-[#5a5a56]">
                <UserRound size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[#0f0f0f]">
                  {currentUser?.fullName || 'LexCatalyst user'}
                </div>
                <div className="truncate text-xs text-[#8c8c86]">
                  {currentUser?.email ?? 'Loading profile...'}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div>
              <h3 className="text-sm font-semibold text-[#0f0f0f]">Professional role</h3>
              <p className="mt-1 text-xs leading-5 text-[#6f6f69]">
                Your role controls which workspace actions and management views are available.
              </p>
            </div>

            <div className="mt-4 grid gap-3">
              {roles.map((role) => {
                const selected = effectiveRole === role.id
                return (
                  <button
                    key={role.id}
                    aria-pressed={selected}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                      selected
                        ? 'border-[#0f0f0f] bg-white'
                        : 'border-black/10 bg-white hover:border-black/25'
                    }`}
                    onClick={() => {
                      setSelectedRole(role.id)
                      setMessage(null)
                    }}
                    type="button"
                  >
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                        selected
                          ? 'border-[#0f0f0f] bg-[#0f0f0f] text-white'
                          : 'border-black/20 text-transparent'
                      }`}
                    >
                      <Check size={12} />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-[#0f0f0f]">
                        {role.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[#6f6f69]">
                        {role.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                className="h-9 rounded-lg bg-[#0f0f0f] px-4 text-xs font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:bg-[#d5d4cf]"
                disabled={
                  mutation.isPending ||
                  !currentUser ||
                  effectiveRole === (currentUser.isAdmin ? 'admin' : currentUser.firmRole)
                }
                onClick={() => mutation.mutate(effectiveRole)}
                type="button"
              >
                {mutation.isPending ? 'Saving...' : 'Save role'}
              </button>
              {message && <span className="text-xs text-[#6f6f69]">{message}</span>}
            </div>
          </div>

          {currentUser?.isAdmin && (
            <div className="pt-8 border-t border-black/10">
              <div className="flex items-center gap-2 mb-1">
                <Users size={16} className="text-[#0f0f0f]" />
                <h3 className="text-sm font-semibold text-[#0f0f0f]">Firm Roster</h3>
              </div>
              <p className="text-xs leading-5 text-[#6f6f69]">
                Manage professional roles for every member of the firm.
              </p>

              <div className="mt-4 overflow-hidden rounded-xl border border-black/10 bg-white divide-y divide-black/5">
                {usersQuery.isLoading ? (
                  <p className="p-4 text-xs text-[#8c8c86]">Loading roster...</p>
                ) : usersQuery.data?.length === 0 ? (
                  <p className="p-4 text-xs text-[#8c8c86]">No other users found.</p>
                ) : (
                  usersQuery.data?.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[#0f0f0f]">{userLabel(u)}</div>
                        <div className="truncate text-[10px] text-[#8c8c86]">{u.email}</div>
                      </div>
                      <select
                        className="rounded-lg border border-black/10 bg-[#f4f3ef] px-2 py-1 text-[11px] font-medium text-[#5a5a56] outline-none focus:border-black/25"
                        disabled={u.id === currentUser.id || otherUserMutation.isPending}
                        onChange={(e) =>
                          otherUserMutation.mutate({
                            userId: u.id,
                            role: e.target.value as FirmRole,
                          })
                        }
                        value={u.isAdmin ? 'admin' : u.firmRole}
                      >
                        <option value="admin">Administrator</option>
                        <option value="partner">Partner</option>
                        <option value="senior_associate">Senior Associate</option>
                        <option value="associate">Junior Associate</option>
                      </select>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {currentUser?.isAdmin && (
            <div className="pt-8 border-t border-black/10">
              <h3 className="text-sm font-semibold text-red-600">Development & Testing</h3>
              <p className="mt-1 text-xs leading-5 text-[#6f6f69]">
                Use these tools to populate or clean up your firm roster during testing.
              </p>
              
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-white px-4 text-xs font-medium text-[#0f0f0f] hover:bg-[#f4f3ef] disabled:opacity-50"
                  disabled={addDummyMutation.isPending}
                  onClick={() => addDummyMutation.mutate()}
                  type="button"
                >
                  <UserPlus size={14} />
                  Add Sarah and Jane
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-100 bg-white px-4 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  disabled={clearDummyMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Remove all dummy users? This will affect any tasks assigned to them.')) {
                      clearDummyMutation.mutate()
                    }
                  }}
                  type="button"
                >
                  <UserMinus size={14} />
                  Clear dummy data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
