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
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-500">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Task</th>
            <th scope="col" className="w-36 px-4 py-3 font-medium">Status</th>
            <th scope="col" className="w-48 px-4 py-3 font-medium">Assignee</th>
            <th scope="col" className="w-28 px-4 py-3 font-medium">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {items.map((item) => {
            const matter = item.matterId ? matterById.get(item.matterId) : null
            const assignee = item.assignee?.fullName || item.assignee?.email || 'Unassigned'
            const initials = assignee === 'Unassigned' ? '?' : assignee.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
            return (
              <tr key={item.id} className="transition-colors hover:bg-neutral-50 focus-within:bg-neutral-50">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => onSelect(item.id)} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a8a]">
                    <span className={`block font-medium text-neutral-900 ${item.status === 'done' ? 'line-through text-neutral-500' : ''}`}>{item.title}</span>
                    <span className="mt-1 block text-xs text-neutral-500">
                      {matter ? [matter.caseNumber, matter.title].filter(Boolean).join(' · ') : 'General'}
                    </span>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-neutral-600">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${statusColors[item.status]}`} />
                    <span>{statusColumns.find((column) => column.id === item.status)?.label ?? 'To do'}</span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 text-xs text-neutral-600">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-100 text-[10px] font-medium">{initials}</span>
                    <span>{assignee}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                  {item.dueDate ? new Date(item.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                </td>
              </tr>
            )
          })}
          {items.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-neutral-500">No tickets match these filters.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
