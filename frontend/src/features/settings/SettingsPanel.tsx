import { useState } from 'react'
import { Check, Settings, UserRound } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateCurrentUserRole } from '../../shared/api/api'
import type { CurrentUser, FirmRole } from '../../shared/types/workspace'

type SettingsPanelProps = {
  currentUser: CurrentUser | null
}

const roles: Array<{
  id: FirmRole
  label: string
  description: string
}> = [
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
  const [selectedRole, setSelectedRole] = useState<FirmRole | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const effectiveRole = selectedRole ?? currentUser?.firmRole ?? 'associate'

  const mutation = useMutation({
    mutationFn: updateCurrentUserRole,
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['currentUser'], updatedUser)
      const savedUser = JSON.parse(localStorage.getItem('user') ?? '{}')
      localStorage.setItem(
        'user',
        JSON.stringify({ ...savedUser, firm_role: updatedUser.firmRole }),
      )
      setSelectedRole(updatedUser.firmRole)
      setMessage('Your role has been updated.')
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Could not update your role.')
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
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 rounded-xl border border-black/10 bg-white p-4">
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
                effectiveRole === currentUser.firmRole
              }
              onClick={() => mutation.mutate(effectiveRole)}
              type="button"
            >
              {mutation.isPending ? 'Saving...' : 'Save role'}
            </button>
            {message && <span className="text-xs text-[#6f6f69]">{message}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
