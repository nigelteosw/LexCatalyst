import { BookMarked, BriefcaseBusiness } from 'lucide-react'
import { useWorkspaceNavigation } from '../../app/routes'

const sections = [
  { id: 'knowledge_bank', label: 'Knowledge Bank', icon: BookMarked },
  { id: 'matters', label: 'Matters', icon: BriefcaseBusiness },
] as const

export function KnowledgeBankSections() {
  const { current, selectKnowledgeBank, selectMatters } = useWorkspaceNavigation()
  const open = {
    knowledge_bank: () => selectKnowledgeBank(),
    matters: () => selectMatters(),
  }
  // Matter pages and document review pages both belong to the Matters section.
  const activeId =
    current.view === 'matter' || current.view === 'documents' ? 'matters' : current.view
  return (
    <nav
      aria-label="Knowledge Bank sections"
      className="flex shrink-0 gap-1 border-b border-neutral-100 bg-white px-4 pt-2 lg:px-6"
    >
      {sections.map(({ id, label, icon: Icon }) => {
        const active = activeId === id
        return (
          <button
            key={id}
            aria-current={active ? 'page' : undefined}
            onClick={open[id]}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-800'
            }`}
            type="button"
          >
            <Icon size={15} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
