import type {
  KnowledgeBankEntry,
  KnowledgeBankEntryType,
  KnowledgeBankScope,
} from '../../../shared/types/workspace'
import { entryTypes, scopeLabels } from '../config'

type KnowledgeFiltersProps = {
  entries: KnowledgeBankEntry[]
  onScopeChange: (scope: KnowledgeBankScope | 'all') => void
  onTypeChange: (type: KnowledgeBankEntryType | 'all') => void
  scopeFilter: KnowledgeBankScope | 'all'
  typeFilter: KnowledgeBankEntryType | 'all'
}

export function KnowledgeFilters({
  entries,
  onScopeChange,
  onTypeChange,
  scopeFilter,
  typeFilter,
}: KnowledgeFiltersProps) {
  return (
    <>
      <FilterButton
        active={typeFilter === 'all' && scopeFilter === 'all'}
        label="All knowledge"
        onClick={() => {
          onTypeChange('all')
          onScopeChange('all')
        }}
      />
      <FilterHeading>Entry type</FilterHeading>
      {entryTypes.map((type) => (
        <FilterButton
          key={type.id}
          active={typeFilter === type.id}
          count={entries.filter((entry) => entry.entryType === type.id).length}
          label={type.label}
          onClick={() => onTypeChange(type.id)}
        />
      ))}
      <FilterHeading>Scope</FilterHeading>
      <FilterButton
        active={scopeFilter === 'all'}
        count={entries.length}
        label="All scopes"
        onClick={() => onScopeChange('all')}
      />
      {(Object.keys(scopeLabels) as KnowledgeBankScope[]).map((scope) => (
        <FilterButton
          key={scope}
          active={scopeFilter === scope}
          count={entries.filter((entry) => entry.scope === scope).length}
          label={scopeLabels[scope]}
          onClick={() => onScopeChange(scope)}
        />
      ))}
    </>
  )
}

function FilterHeading({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-4 px-2 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#76766f]">
      {children}
    </div>
  )
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count?: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
        active ? 'bg-white font-medium text-[#0f0f0f]' : 'text-[#6f6f69] hover:bg-white/60'
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[10px] text-[#8a8a84]">{count}</span>}
    </button>
  )
}
