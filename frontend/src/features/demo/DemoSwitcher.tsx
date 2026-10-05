import { useQuery } from '@tanstack/react-query'
import { getAppConfig, isImpersonating, listDemoUsers } from '../../shared/api/api'

type DemoSwitcherProps = {
  isAdmin: boolean
  currentUserId: string | null
  onSwitch: (userId: string) => void
  onReturn: () => void
}

const roleLabels: Record<string, string> = {
  partner: 'Partner',
  senior_associate: 'Senior',
  associate: 'Associate',
  admin: 'Admin',
}

/** User-menu section for demo mode. Renders nothing unless DEMO_MODE is on and the user is
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

  const users = usersQuery.data ?? []

  return (
    <div className="border-t border-white/[0.08] px-1.5 py-1.5">
      <div className="mb-1 px-2 text-[10.5px] text-white/40">Switch user (demo)</div>
      <ul className="space-y-0.5" aria-label="Demo users">
        {impersonating && (
          <li>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-white/70 hover:bg-white/[0.07] hover:text-white"
              onClick={onReturn}
              type="button"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/20 text-[9px]">↩</span>
              <span className="min-w-0 flex-1 truncate">Back to my account</span>
            </button>
          </li>
        )}
        {usersQuery.isLoading && <li className="px-2 py-1.5 text-xs text-white/40">Loading…</li>}
        {users.map((user) => {
          const active = user.id === currentUserId
          const name = user.fullName ?? user.email
          return (
            <li key={user.id}>
              <button
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                  active ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/[0.07] hover:text-white'
                }`}
                disabled={active}
                onClick={() => onSwitch(user.id)}
                title={`${name} · ${roleLabels[user.firmRole] ?? user.firmRole}`}
                type="button"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-semibold uppercase">
                  {name
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-[10.5px] text-white/40">{roleLabels[user.firmRole] ?? user.firmRole}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
