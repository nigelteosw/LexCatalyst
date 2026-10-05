import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { FeatureHelp } from './FeatureHelp'
import type { HelpContent } from './FeatureHelp'

type PanelHeaderProps = {
  actions?: ReactNode
  children?: ReactNode
  className?: string
  description?: string
  helpContent?: HelpContent
  icon?: LucideIcon
  title: string
}

export function PanelHeader({
  actions,
  children,
  className = '',
  description,
  helpContent,
  icon: Icon,
  title,
}: PanelHeaderProps) {
  return (
    <header
      className={`flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200/70 bg-surface px-4 py-3 lg:px-6 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-950 text-white">
            <Icon aria-hidden="true" size={16} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-serif text-2xl tracking-tight text-neutral-950">{title}</h2>
            {helpContent && <FeatureHelp title={title} content={helpContent} />}
          </div>
          {description && (
            <p className="truncate text-xs text-neutral-600">{description}</p>
          )}
        </div>
      </div>
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
