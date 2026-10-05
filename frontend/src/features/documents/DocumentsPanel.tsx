import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDocuments } from '../../shared/api/api'
import type { CurrentUser } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { GENERAL_MATTER_ID } from '../knowledge-bank/MatterPage'
import { DocumentDrawer } from './DocumentDrawer'

/**
 * Review page for one document (/knowledge/documents/:id). Documents are listed,
 * uploaded and organised on their matter's page, so this route only opens the drawer.
 */
export function DocumentsPanel({ currentUser }: { currentUser: CurrentUser | null }) {
  const { current, selectMatter, selectMatters } = useWorkspaceNavigation()
  const documentId = current.view === 'documents' ? current.documentId : null
  const documentsQuery = useQuery({ queryKey: ['documents'], queryFn: listDocuments })
  const document = documentsQuery.data?.find((d) => d.id === documentId) ?? null

  // /knowledge/documents with no id used to be the list; send people to the matters instead.
  useEffect(() => {
    if (!documentId) selectMatters({ replace: true })
  }, [documentId, selectMatters])

  if (!document) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {documentsQuery.isLoading ? 'Loading…' : "Document not found, or you don't have access."}
      </div>
    )
  }

  return (
    <DocumentDrawer
      currentUser={currentUser}
      document={document}
      onClose={() => selectMatter(document.matterId ?? GENERAL_MATTER_ID)}
    />
  )
}
