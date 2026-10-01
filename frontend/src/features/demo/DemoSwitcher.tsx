import { useQuery } from '@tanstack/react-query'
import { getAppConfig, isImpersonating, listDemoUsers } from '../../shared/api/api'

type DemoSwitcherProps = {
  isAdmin: boolean
  currentUserId: string | null
  onSwitch: (userId: string) => void
  onReturn: () => void
}

const RETURN_VALUE = '__return__'

const roleLabels: Record<string, string> = {
  partner: 'Partner',
  senior_associate: 'Senior associate',
  associate: 'Associate',
  admin: 'Admin',
}

/** Sidebar-footer picker for demo mode. Renders nothing unless DEMO_MODE is on and the user is
 *  the admin presenter (or is currently switched into a demo user). */
export function DemoSwitcher({ isAdmin, currentUserId, onSwitch, onReturn }: DemoSwitcherProps) {
  const impersonating = isImpersonating()
  const configQuery = useQuery({ queryKey: ['appConfig'], queryFn: getAppConfig, staleTime: Infinity })
  const enabled = Boolean(configQuery.data?.demoMode) && (isAdmin || impersonating)
  const usersQuery = useQuery({
    queryKey: ['demoUsers'],
    queryFn: listDemoUsers,
    enabled,
    staleTime: 60_000,
  })

  if (!enabled) return null

  return (
    <div className="shrink-0 border-t border-white/[0.08] px-2.5 pt-2.5">
      <label className="block text-[9.5px] font-medium uppercase tracking-[0.08em] text-white/30" htmlFor="demo-switch">
        Demo · switch user
      </label>
      <select
        className="mt-1 h-8 w-full rounded-lg border border-white/10 bg-white/[0.06] px-2 text-[11.5px] text-white/80 outline-none focus:border-white/30"
        id="demo-switch"
        onChange={(event) => {
          const value = event.target.value
          if (!value) return
          if (value === RETURN_VALUE) onReturn()
          else onSwitch(value)
        }}
        value=""
      >
        <option className="text-black" value="">
          {usersQuery.isLoading ? 'Loading…' : 'Choose…'}
        </option>
        {impersonating && (
          <option className="text-black" value={RETURN_VALUE}>
            Back to my account
          </option>
        )}
        {(usersQuery.data ?? [])
          .filter((user) => user.id !== currentUserId)
          .map((user) => (
            <option className="text-black" key={user.id} value={user.id}>
              {user.fullName ?? user.email} ({roleLabels[user.firmRole] ?? user.firmRole})
            </option>
          ))}
      </select>
    </div>
  )
}
