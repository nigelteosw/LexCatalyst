import { FileText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { listDocuments, listMatters } from '../../shared/api/api'
import { useWorkspaceNavigation } from '../../app/routes'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { formatRelative } from './format'

const MAX_DOCUMENTS = 5

/** The documents touched most recently, so a lawyer can pick up where they left off. */
export function RecentDocumentsSection() {
  const { selectDocuments } = useWorkspaceNavigation()
  const documents = useQuery({ queryKey: ['documents'], queryFn: listDocuments, staleTime: 30_000 })
  const matters = useQuery({ queryKey: ['matters', 'all'], queryFn: () => listMatters(), staleTime: 60_000 })

  const recent = [...(documents.data ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_DOCUMENTS)

  return (
    <section>
      <h2 className="border-b border-neutral-200 pb-3 font-serif text-xl text-neutral-900">Recent documents</h2>
      {documents.isPending ? (
        <p className="py-6 text-sm text-neutral-400">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="py-6 text-sm text-neutral-500">No documents yet. Open a matter to upload one.</p>
      ) : (
        <div className="divide-y divide-neutral-200/70">
          {recent.map((doc) => {
            const matter = matters.data?.find((m) => m.id === doc.matterId)
            return (
              <button
                className="group flex w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-black/[0.025]"
                key={doc.id}
                onClick={() => selectDocuments(doc.id)}
                type="button"
              >
                <FileText className="mt-0.5 shrink-0 text-neutral-400" size={16} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-neutral-900 group-hover:text-[#1e3a8a]">
                    {doc.filename}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-neutral-500">
                    {matter ? matter.caseNumber : 'General'} · {formatRelative(doc.updatedAt)}
                  </span>
                </span>
                {doc.status !== 'ready' && (
                  <StatusBadge tone={doc.status === 'failed' ? 'danger' : 'warning'}>{doc.status}</StatusBadge>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
