import { UsersRound } from 'lucide-react'
import type { ClassStatus } from '../../shared/types/workspace'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import { ClassSettings } from './ClassSettings'

type ActiveTeam = Extract<ClassStatus, { status: 'active' }>

export function TeamManagementPage({ status, currentUserId }: { status: ActiveTeam; currentUserId: string }) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <PanelHeader icon={UsersRound} title="Team Management" description="Members, invitations and access" />
      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-5 py-7 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:px-8">
        <div className="mx-auto max-w-3xl">
          <ClassSettings status={status} currentUserId={currentUserId} />
        </div>
      </div>
    </section>
  )
}
