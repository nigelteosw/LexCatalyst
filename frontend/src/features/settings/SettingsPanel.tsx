import { useState } from 'react'
import { Database, Settings, UserPlus, UserMinus, UserRound, Users } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createDummyUsers,
  deleteDummyUsers,
  getAppConfig,
  listFirmUsers,
  seedDemoData,
  seedPropertyWorkboard,
  setDemoRole,
  updateOtherUserRole,
} from '../../shared/api/api'
import { ModelSettingsSection } from './ModelSettingsSection'
import type { CurrentUser, FirmRole } from '../../shared/types/workspace'
import { getErrorMessage } from '../../shared/lib/errors'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const SETTINGS_HELP: HelpContent = {
  intro: 'Manage your profile, firm role, and the team roster for your workspace.',
  steps: [
    {
      emoji: '🪪',
      title: 'Your firm role',
      body: 'Your role — Associate, Senior Associate, or Partner — controls what you can create, manage, and approve across LexCatalyst. Admins can change your role from here.',
    },
    {
      emoji: '👥',
      title: 'Firm roster',
      body: 'The roster lists everyone in your firm. Admins can change any user\'s role. This is how you onboard a new senior or promote an associate.',
    },
    {
      emoji: '🧪',
      title: 'Demo users',
      body: 'Use "Add demo users" to create Sarah Chen (Senior Associate) and Jane Pereira (Associate) for testing. "Remove demo users" cleans them up afterwards.',
    },
  ],
  roles: [
    {
      label: 'Admin',
      tier: 'top',
      abilities: [
        'Change any user\'s firm role',
        'Add and remove demo users',
        'Access all firm-wide data and settings',
      ],
    },
    {
      label: 'All users',
      tier: 'base',
      abilities: [
        'View the firm roster',
        'See their own current role',
      ],
    },
  ],
  tips: [
    'Only users with the Admin flag can change roles. The Admin flag is managed outside the app — contact your firm\'s LexCatalyst administrator.',
    'Role changes take effect immediately — the user does not need to log out and back in.',
  ],
}
import { userLabel } from '../actions/config'

type SettingsPanelProps = {
  currentUser: CurrentUser | null
}

export function SettingsPanel({ currentUser }: SettingsPanelProps) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)

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

  const configQuery = useQuery({ queryKey: ['appConfig'], queryFn: getAppConfig, staleTime: Infinity })
  const demoMode = configQuery.data?.demoMode ?? false

  const seedMutation = useMutation({
    mutationFn: seedDemoData,
    onSuccess: (summary) => {
      queryClient.invalidateQueries()
      const processing = summary.documents_still_processing
        ? ' Documents are still processing — wait a minute before demoing chat.'
        : ''
      const failed = Number(summary.documents_failed) + Number(summary.kb_failed)
      setMessage(
        `Demo data loaded: ${summary.documents} documents, ${summary.kb_entries} KB entries, ${summary.tickets} tickets, ${summary.review_rounds} review rounds.` +
          (failed > 0 ? ` ${failed} item(s) failed — check R2/OpenAI config.` : '') +
          processing,
      )
    },
    onError: (error) => setMessage(getErrorMessage(error)),
  })

  const propertySeedMutation = useMutation({
    mutationFn: seedPropertyWorkboard,
    onSuccess: (summary) => {
      queryClient.invalidateQueries()
      setMessage(summary.ticketsCreated > 0 || summary.chatsCreated > 0
        ? `Property Workboard demo loaded: ${summary.ticketsCreated} synthetic tasks and ${summary.chatsCreated} sample chats across ${summary.matters} Singapore property matters.`
        : 'Property Workboard demo is already loaded. Existing tasks were kept.')
    },
    onError: (error) => setMessage(getErrorMessage(error)),
  })

  const demoRoleMutation = useMutation({
    mutationFn: setDemoRole,
    onSuccess: () => {
      // Role changes what every panel shows, so refetch everything rather than picking queries.
      queryClient.invalidateQueries()
      setMessage('Role updated.')
    },
    onError: (error) => setMessage(getErrorMessage(error)),
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
      <PanelHeader
        description="Profile and workspace access"
        helpContent={SETTINGS_HELP}
        icon={Settings}
        title="Settings"
      />

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

          <ModelSettingsSection />

          <div className="rounded-xl border border-black/10 bg-white p-4">
            <h3 className="text-sm font-semibold text-[#0f0f0f]">Professional role</h3>
            <p className="mt-1 text-xs leading-5 capitalize text-[#6f6f69]">
              {(currentUser?.isAdmin ? 'administrator' : currentUser?.firmRole ?? 'associate')
                .replace('_', ' ')}
            </p>
            {demoMode ? (
              <label className="mt-3 flex items-center justify-between gap-4 text-xs text-[#6f6f69]">
                <span>
                  View as
                  <span className="block text-[11px] text-[#8c8c86]">
                    Demo mode: everyone is an admin and can mimic any role to see what it can do.
                  </span>
                </span>
                <select
                  className="rounded-lg border border-black/10 bg-[#f4f3ef] px-2 py-1 text-[11px] font-medium text-[#5a5a56] outline-none focus:border-black/25"
                  disabled={!currentUser || demoRoleMutation.isPending}
                  onChange={(e) => demoRoleMutation.mutate(e.target.value as FirmRole)}
                  value={currentUser?.isAdmin ? 'admin' : (currentUser?.firmRole ?? 'associate')}
                >
                  <option value="admin">Administrator</option>
                  <option value="partner">Partner</option>
                  <option value="senior_associate">Senior Associate</option>
                  <option value="associate">Junior Associate</option>
                </select>
              </label>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[#8c8c86]">Roles are managed by an administrator.</p>
            )}
          </div>

          {message && (
            <p className="rounded-lg bg-[#f4f3ef] px-3 py-2 text-xs text-[#6f6f69]">
              {message}
            </p>
          )}

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
                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-[#0f0f0f]">{userLabel(u)}</div>
                        <div className="truncate text-[11px] text-[#8c8c86]">{u.email}</div>
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
              
              {demoMode && (
                <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
                  <h4 className="text-sm font-medium text-neutral-900">Singapore property Workboard demo</h4>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    Add 12 synthetic tasks across private residential purchase, HDB resale, commercial leasing and a strata dispute. Uses Sarah, Jane and Marcus across all five stages, plus one private sample chat per matter for you and each demo user. Existing work and conversations are kept; repeated clicks add no duplicates.
                  </p>
                  <button type="button" disabled={propertySeedMutation.isPending || seedMutation.isPending}
                    onClick={() => propertySeedMutation.mutate()}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 text-xs font-medium text-white hover:bg-[#172e6e] disabled:opacity-50">
                    <Database size={14} />
                    {propertySeedMutation.isPending ? 'Loading property demo…' : 'Load property Workboard demo'}
                  </button>
                </div>
              )}
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
                {demoMode && (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-[#0f0f0f] px-4 text-xs font-medium text-white hover:bg-black disabled:opacity-50"
                    disabled={seedMutation.isPending || propertySeedMutation.isPending}
                    onClick={() => {
                      if (window.confirm('Load demo data? This resets any previous demo data (Sarah, Jane, Marcus and the Meridian matter).')) {
                        seedMutation.mutate()
                      }
                    }}
                    type="button"
                  >
                    <Database size={14} />
                    {seedMutation.isPending ? 'Loading demo data…' : 'Load demo data'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
