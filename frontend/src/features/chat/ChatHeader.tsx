import type { ReactNode } from 'react'
import type { Matter } from '../../shared/types/workspace'

/** Breadcrumb (matter / LexChat) over a serif conversation title. */
export function ChatHeader({
  matter,
  title,
  onOpenMatter,
  leading,
  actions,
}: {
  matter: Matter | null
  title: string
  onOpenMatter: () => void
  leading?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="z-30 flex shrink-0 items-start justify-between gap-3 bg-white px-4 pb-3 pt-4 lg:px-8">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {leading}
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="truncate text-sm text-neutral-500">
            <button className="underline underline-offset-2 hover:text-neutral-800" onClick={onOpenMatter} type="button">
              {matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
            </button>
            {' / '}
            <span>LexChat</span>
          </nav>
          <h1 className="mt-1 truncate font-serif text-2xl text-neutral-900 lg:text-3xl">{title}</h1>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
