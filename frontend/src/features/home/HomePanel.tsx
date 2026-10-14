import { MessageSquare } from 'lucide-react'
import type { CurrentUser } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { Button } from '../../shared/ui/Button'
import { AttentionSection } from './AttentionSection'
import { FromMentorsSection, MyMenteesSection, TeamGuidanceSection } from './MentorshipHomeSections'
import { MattersSection } from './MattersSection'

type Props = {
  currentUser: CurrentUser | null
  matters?: unknown
  onMatterChange: (matterId: string | null) => void
}

/** Mentorship first: feedback, mentees and team guidance; then the user's Workboard and matters. */
export function HomePanel({ currentUser, onMatterChange }: Props) {
  const nav = useWorkspaceNavigation()
  const name = currentUser?.fullName?.split(' ')[0] ?? currentUser?.email?.split('@')[0]

  return (
    <div className="app-scroll-region h-full overflow-y-auto bg-page px-4 pb-20 pt-8 sm:px-6 sm:pb-10 lg:px-12 lg:pt-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="t-meta mb-2 text-ink-secondary">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="break-words font-serif text-3xl sm:text-4xl tracking-tight text-ink">{getGreeting()}{name ? `, ${name}` : ''}</h1>
          </div>
          <Button onClick={() => { onMatterChange(null); nav.startNewChat() }} variant="primary">
            <MessageSquare size={16} /> New LexChat
          </Button>
        </header>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
          <FromMentorsSection currentUser={currentUser} />
          <MyMenteesSection />
          <TeamGuidanceSection />
          <div className="rounded-lg border border-line bg-card p-4 sm:p-5">
            <AttentionSection currentUser={currentUser} />
          </div>
        </div>

        <div id="home-matters" className="mt-10 scroll-mt-6">
          <MattersSection currentUser={currentUser} onMatterChange={onMatterChange} />
        </div>
      </div>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}
