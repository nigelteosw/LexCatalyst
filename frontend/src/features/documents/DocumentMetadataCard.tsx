import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDocumentMetadata,
  getEntryMetadata,
  listDocumentTags,
  updateDocumentMetadata,
  updateEntryMetadata,
  type DocumentMetadataUpdate,
} from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentMetadata } from '../../shared/types/workspace'
import { Button } from '../../shared/ui/Button'

/*
 * Editing metadata for a document or a manual note. `useMetadataEditor` owns the
 * saved value and the unsaved draft; the small components below render pieces of
 * it, so one editor can feed a sidebar and a tab at the same time. The
 * `DocumentMetadataCard` at the bottom composes all of them for narrow spaces.
 */

export type Draft = {
  tags: string[]
  summary: string
  documentType: string
  documentStatus: string
  executionDate: string
}

type EditorState = 'loading' | 'unavailable' | 'generating' | 'ready'

export type MetadataEditor = {
  isDocument: boolean
  canEdit: boolean
  state: EditorState
  saved?: DocumentMetadata
  draft?: Draft
  setDraft: (draft: Draft) => void
  edited: Set<string>
  dirty: boolean
  error: string | null
  isSaving: boolean
  save: () => void
  discard: () => void
  suggestions: string[]
  idPrefix: string
}

export type ReadyMetadataEditor = MetadataEditor & { saved: DocumentMetadata; draft: Draft }

function draftFrom(metadata: DocumentMetadata): Draft {
  return {
    tags: metadata.tags,
    summary: metadata.summary ?? '',
    documentType: metadata.documentType ?? 'Other',
    documentStatus: metadata.documentStatus ?? 'Unknown',
    executionDate: metadata.executionDate ?? '',
  }
}

function changedUpdates(saved: DocumentMetadata, draft: Draft, isDocument: boolean): DocumentMetadataUpdate {
  const updates: DocumentMetadataUpdate = {}
  if (draft.tags.join('|') !== saved.tags.join('|')) updates.tags = draft.tags
  if (draft.summary !== (saved.summary ?? '')) updates.summary = draft.summary
  if (!isDocument) return updates
  if (draft.documentType !== (saved.documentType ?? '')) updates.documentType = draft.documentType
  if (draft.documentStatus !== (saved.documentStatus ?? '')) updates.documentStatus = draft.documentStatus
  if (draft.executionDate !== (saved.executionDate ?? '')) updates.executionDate = draft.executionDate || null
  return updates
}

export function useMetadataEditor({
  documentId,
  entryId,
  canEdit,
}: {
  // A document's metadata, or a manual note's when there is no document.
  documentId?: string | null
  entryId?: string
  canEdit: boolean
}): MetadataEditor {
  const queryClient = useQueryClient()
  const isDocument = !!documentId
  const subjectId = documentId ?? entryId ?? ''
  const queryKey = ['documentMetadata', isDocument ? 'document' : 'entry', subjectId]
  const idPrefix = useId()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const metadataQuery = useQuery({
    queryKey,
    queryFn: () => (isDocument ? getDocumentMetadata(subjectId) : getEntryMetadata(subjectId)),
    retry: false,
  })
  const tagsQuery = useQuery({
    queryKey: ['documentTags'],
    queryFn: () => listDocumentTags(),
    enabled: canEdit,
  })

  const saved = metadataQuery.data
  useEffect(() => {
    if (saved) setDraft(draftFrom(saved))
  }, [saved?.updatedAt])

  const saveMutation = useMutation({
    mutationFn: (updates: DocumentMetadataUpdate) =>
      isDocument ? updateDocumentMetadata(subjectId, updates) : updateEntryMetadata(subjectId, updates),
    onSuccess: (updated) => {
      setError(null)
      queryClient.setQueryData(queryKey, updated)
      queryClient.invalidateQueries({ queryKey: ['documentTags'] })
      queryClient.invalidateQueries({ queryKey: ['documentMetadataList'] })
    },
    onError: (err) => setError(getErrorMessage(err)),
  })

  let state: EditorState = 'ready'
  if (metadataQuery.isError) state = 'unavailable'
  else if (metadataQuery.isLoading || !saved || !draft) state = 'loading'
  else if (saved.status !== 'ready') state = 'generating'

  const dirty = !!saved && !!draft && Object.keys(changedUpdates(saved, draft, isDocument)).length > 0
  return {
    isDocument,
    canEdit,
    state,
    saved,
    draft: draft ?? undefined,
    setDraft,
    edited: new Set(saved?.editedFields ?? []),
    dirty,
    error,
    isSaving: saveMutation.isPending,
    save: () => {
      if (saved && draft) saveMutation.mutate(changedUpdates(saved, draft, isDocument))
    },
    discard: () => {
      if (saved) setDraft(draftFrom(saved))
      setError(null)
    },
    suggestions: (tagsQuery.data ?? []).filter((tag) => !draft?.tags.includes(tag)),
    idPrefix,
  }
}

/** Renders `children` once the metadata is loaded; otherwise a skeleton or an explanation. */
export function MetadataBoundary({
  editor,
  children,
  noticeClassName = '',
}: {
  editor: MetadataEditor
  children: (ready: ReadyMetadataEditor) => ReactNode
  /** Classes for the loading, unavailable and generating states (for example, padding). */
  noticeClassName?: string
}) {
  if (editor.state === 'loading') {
    return (
      <div aria-busy="true" className={`space-y-4 ${noticeClassName}`}>
        <div className="h-3 w-16 animate-pulse rounded bg-neutral-100" />
        <div className="h-16 w-full animate-pulse rounded-lg bg-neutral-100" />
        <div className="h-3 w-10 animate-pulse rounded bg-neutral-100" />
        <div className="h-7 w-2/3 animate-pulse rounded-md bg-neutral-100" />
      </div>
    )
  }
  if (editor.state === 'unavailable') {
    return (
      <p className={`text-meta leading-5 text-ink-tertiary ${noticeClassName}`}>
        Metadata is not available for this entry. Document metadata is visible to people with access to the document itself.
      </p>
    )
  }
  if (editor.state === 'generating') {
    return (
      <p className={`flex items-center gap-2 text-meta text-ink-tertiary ${noticeClassName}`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Generating tags and summary…
      </p>
    )
  }
  return <>{children(editor as ReadyMetadataEditor)}</>
}

export const controlClass =
  'h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-body text-ink outline-none transition-colors placeholder:text-ink-tertiary hover:border-neutral-300 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:bg-neutral-50 disabled:text-ink-secondary'

export function Field({
  label,
  htmlFor,
  edited,
  children,
}: {
  label: string
  htmlFor?: string
  edited?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="text-label font-medium text-ink-secondary" htmlFor={htmlFor}>
          {label}
        </label>
        {edited && <span className="text-micro text-ink-tertiary">Edited</span>}
      </div>
      {children}
    </div>
  )
}

export function TagsEditor({ editor }: { editor: ReadyMetadataEditor }) {
  const { draft, canEdit, setDraft } = editor
  const [tagInput, setTagInput] = useState('')
  const listId = `${editor.idPrefix}-tags`

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!tag || draft.tags.includes(tag) || draft.tags.length >= 12) return
    setDraft({ ...draft, tags: [...draft.tags, tag.slice(0, 40)] })
    setTagInput('')
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(tagInput)
    } else if (event.key === 'Backspace' && !tagInput && draft.tags.length) {
      setDraft({ ...draft, tags: draft.tags.slice(0, -1) })
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {draft.tags.map((tag) => (
        <span
          className={`inline-flex h-7 items-center gap-1 rounded-md bg-neutral-100 text-meta text-ink ${canEdit ? 'pl-2.5 pr-1' : 'px-2.5'}`}
          key={tag}
        >
          {tag}
          {canEdit && (
            <button
              aria-label={`Remove tag ${tag}`}
              className="grid h-5 w-5 place-items-center rounded text-ink-tertiary transition-colors hover:bg-neutral-200 hover:text-ink"
              onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) })}
              type="button"
            >
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {canEdit ? (
        <input
          aria-label="Add tag"
          className="h-7 w-24 rounded-md border border-dashed border-neutral-300 bg-transparent px-2 text-meta text-ink outline-none transition-colors placeholder:text-ink-tertiary hover:border-neutral-400 focus:w-32 focus:border-solid focus:border-accent"
          id={`${editor.idPrefix}-tag-input`}
          list={listId}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={handleKey}
          placeholder="+ Add tag"
          value={tagInput}
        />
      ) : (
        draft.tags.length === 0 && <span className="text-meta text-ink-tertiary">No tags</span>
      )}
      <datalist id={listId}>
        {editor.suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  )
}

export function SummaryEditor({ editor, autoFocus }: { editor: ReadyMetadataEditor; autoFocus?: boolean }) {
  const { draft, canEdit, setDraft } = editor
  if (!canEdit) {
    return (
      <p className="text-body leading-6 text-ink-secondary">
        {draft.summary || <span className="text-ink-tertiary">No summary</span>}
      </p>
    )
  }
  return (
    <textarea
      autoFocus={autoFocus}
      className="min-h-24 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-body leading-6 text-ink outline-none transition-colors [field-sizing:content] placeholder:text-ink-tertiary hover:border-neutral-300 focus:border-accent focus:ring-2 focus:ring-accent/15"
      id={`${editor.idPrefix}-summary`}
      onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
      placeholder="Add a short summary"
      value={draft.summary}
    />
  )
}

/** Type, status and execution date. Only meaningful for documents. */
export function DocumentFields({ editor }: { editor: ReadyMetadataEditor }) {
  const { draft, canEdit, edited, setDraft } = editor
  const id = editor.idPrefix
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field edited={edited.has('document_type')} htmlFor={`${id}-type`} label="Type">
        <select
          className={controlClass}
          disabled={!canEdit}
          id={`${id}-type`}
          onChange={(event) => setDraft({ ...draft, documentType: event.target.value })}
          value={draft.documentType}
        >
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </Field>
      <Field edited={edited.has('document_status')} htmlFor={`${id}-status`} label="Status">
        <select
          className={controlClass}
          disabled={!canEdit}
          id={`${id}-status`}
          onChange={(event) => setDraft({ ...draft, documentStatus: event.target.value })}
          value={draft.documentStatus}
        >
          {DOCUMENT_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </Field>
      <Field edited={edited.has('execution_date')} htmlFor={`${id}-date`} label="Executed">
        <input
          className={controlClass}
          disabled={!canEdit}
          id={`${id}-date`}
          onChange={(event) => setDraft({ ...draft, executionDate: event.target.value })}
          type="date"
          value={draft.executionDate}
        />
      </Field>
    </div>
  )
}

export function SaveBar({ editor, className = '' }: { editor: MetadataEditor; className?: string }) {
  if (!editor.error && !(editor.canEdit && editor.dirty)) return null
  return (
    <div className={className}>
      {editor.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-meta text-red-700">{editor.error}</p>}
      {editor.canEdit && editor.dirty && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta text-ink-tertiary">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button onClick={editor.discard} size="sm" variant="ghost">
              Discard
            </Button>
            <Button disabled={editor.isSaving} onClick={editor.save} size="sm" variant="primary">
              {editor.isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Everything in one stack, for narrow spaces such as the document drawer. */
export function DocumentMetadataCard(props: { documentId?: string | null; entryId?: string; canEdit: boolean }) {
  const editor = useMetadataEditor(props)
  return (
    <MetadataBoundary editor={editor}>
      {(e) => (
        <div className="space-y-5">
          <Field edited={e.edited.has('tags')} htmlFor={`${e.idPrefix}-tag-input`} label="Tags">
            <TagsEditor editor={e} />
          </Field>
          <Field edited={e.edited.has('summary')} htmlFor={`${e.idPrefix}-summary`} label="Summary">
            <SummaryEditor editor={e} />
          </Field>
          {e.isDocument && <DocumentFields editor={e} />}
          <SaveBar className="border-t border-neutral-100 pt-4" editor={e} />
        </div>
      )}
    </MetadataBoundary>
  )
}
