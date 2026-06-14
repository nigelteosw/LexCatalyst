import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type PanelHeaderProps = {
  actions?: ReactNode
  children?: ReactNode
  className?: string
  description?: string
  icon?: LucideIcon
  title: string
}

export function PanelHeader({
  actions,
  children,
  className = '',
  description,
  icon: Icon,
  title,
}: PanelHeaderProps) {
  return (
    <header
      className={`flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 lg:px-6 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-950 text-white">
            <Icon aria-hidden="true" size={16} />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-neutral-900">{title}</h2>
          {description && (
            <p className="truncate text-xs text-neutral-500">{description}</p>
          )}
        </div>
      </div>
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
