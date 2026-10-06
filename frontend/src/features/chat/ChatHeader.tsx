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
    <header className="z-30 flex shrink-0 items-start justify-between gap-3 border-b border-hairline bg-surface px-4 pb-3 pt-4 lg:px-8">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {leading}
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="t-meta truncate text-ink-secondary">
            <button className="underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-current" onClick={onOpenMatter} type="button">
              {matter ? `${matter.caseNumber} · ${matter.title}` : 'General'}
            </button>
            {' / '}
            <span>LexChat</span>
          </nav>
          <h1 className="mt-1 truncate font-serif text-2xl tracking-tight text-ink lg:text-3xl">{title}</h1>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
