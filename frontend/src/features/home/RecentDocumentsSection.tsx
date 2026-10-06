import { FileText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { listDocuments, listMatters } from '../../shared/api/api'
import { useWorkspaceNavigation } from '../../app/routes'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { formatRelative } from './format'

const MAX_DOCUMENTS = 3

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
      <h2 className="border-b border-line pb-3 font-serif text-xl text-ink">Recent documents</h2>
      {documents.isPending ? (
        <p className="py-6 text-sm text-ink-tertiary">Loading…</p>
      ) : documents.isError ? (
        <p className="py-6 text-sm text-danger">Could not load recent documents.</p>
      ) : recent.length === 0 ? (
        <p className="py-6 text-sm text-ink-secondary">No documents yet. Open a matter to upload one.</p>
      ) : (
        <div className="divide-y divide-neutral-200/70">
          {recent.map((doc) => {
            const matter = matters.data?.find((m) => m.id === doc.matterId)
            return (
              <button
                className="group flex w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-fill"
                key={doc.id}
                onClick={() => selectDocuments(doc.id)}
                type="button"
              >
                <FileText className="mt-0.5 shrink-0 text-ink-tertiary" size={16} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink group-hover:text-accent">
                    {doc.filename}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-ink-secondary">
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
