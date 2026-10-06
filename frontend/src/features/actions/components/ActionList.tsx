import type { ActionItem } from '../../../shared/types/workspace'
import { statusColumns, statusColors } from '../config'

type Props = {
  items: ActionItem[]
  matters: { id: string; title: string; caseNumber: string | null }[]
  onSelect: (id: string) => void
}

export function ActionList({ items, matters, onSelect }: Props) {
  const matterById = new Map(matters.map((matter) => [matter.id, matter]))

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="block w-full text-left text-sm sm:table sm:min-w-[640px]">
        <thead className="hidden border-b border-neutral-200 bg-neutral-50 text-xs sm:table-header-group font-medium text-neutral-500">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Task</th>
            <th scope="col" className="w-36 px-4 py-3 font-medium">Status</th>
            <th scope="col" className="w-48 px-4 py-3 font-medium">Assignee</th>
            <th scope="col" className="w-28 px-4 py-3 font-medium">Due</th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-neutral-100 sm:table-row-group">
          {items.map((item) => {
            const matter = item.matterId ? matterById.get(item.matterId) : null
            const assignee = item.assignee?.fullName || item.assignee?.email || 'Unassigned'
            const initials = assignee === 'Unassigned' ? '?' : assignee.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
            return (
              <tr key={item.id} className="grid grid-cols-2 transition-colors hover:bg-neutral-50 focus-within:bg-neutral-50 sm:table-row">
                <td className="col-span-2 min-w-0 px-4 py-3 sm:table-cell">
                  <button type="button" onClick={() => onSelect(item.id)} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a]">
                    <span className={`block break-words font-medium text-neutral-900 ${item.status === 'done' ? 'line-through text-neutral-500' : ''}`}>{item.title}</span>
                    <span className="mt-1 block text-xs text-neutral-500">
                      {matter ? [matter.caseNumber, matter.title].filter(Boolean).join(' · ') : 'General'}
                    </span>
                  </button>
                </td>
                <td className="min-w-0 px-4 py-3 sm:table-cell">
                  <span className="inline-flex items-center gap-2 sm:whitespace-nowrap text-xs text-neutral-600">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${statusColors[item.status]}`} />
                    <span>{statusColumns.find((column) => column.id === item.status)?.label ?? 'To do'}</span>
                  </span>
                </td>
                <td className="min-w-0 px-4 py-3 sm:table-cell">
                  <span className="flex items-center gap-2 text-xs text-neutral-600">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-100 text-[10px] font-medium">{initials}</span>
                    <span className="break-words">{assignee}</span>
                  </span>
                </td>
                <td className="min-w-0 px-4 py-3 text-xs text-neutral-500 sm:whitespace-nowrap">
                  <span className="mb-1 block font-medium text-neutral-700 sm:hidden">Due</span>
                  {item.dueDate ? new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                </td>
              </tr>
            )
          })}
          {items.length === 0 && (
            <tr className="block sm:table-row"><td colSpan={4} className="px-4 py-10 text-center text-sm text-neutral-500">No tickets match these filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
