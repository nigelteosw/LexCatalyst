import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { Matter, MessageSource } from '../../shared/types/workspace'
import { Button } from '../../shared/ui/Button'
import { MarkdownContent } from '../../shared/ui/MarkdownContent'
import { useWorkspaceNavigation } from '../../app/routes'
import { describeSource } from './sourceLabels'

// Stay below the server's 1,500-character excerpt cap so saved previews also
// end with an explicit ellipsis rather than an abrupt mid-word cutoff.
const MAX_PREVIEW_CHARS = 1400

/** Slide-over showing the passage a footnote points at, with a link to the full source. */
export function SourcePanel({
  source,
  matters,
  onClose,
}: {
  source: MessageSource
  matters: Matter[]
  onClose: () => void
}) {
  const { selectDocuments, selectKnowledgeBank } = useWorkspaceNavigation()
  const excerpt = source.excerpt ?? ''
  const isTruncated = excerpt.length > MAX_PREVIEW_CHARS
  const preview = isTruncated
    ? excerpt.slice(0, MAX_PREVIEW_CHARS).replace(/\s+\S*$/, '').trimEnd()
    : excerpt

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function openFull() {
    if (source.kind === 'document') selectDocuments(source.id)
    else selectKnowledgeBank(source.id)
  }

  return (
    <aside
      aria-label={`Source ${source.n}: ${source.title}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[28rem] flex-col border-l border-neutral-200 bg-white shadow-[-12px_0_32px_rgba(23,23,23,0.08)]"
    >
      <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4">
        <span className="mt-0.5 text-sm font-semibold text-accent">{source.n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium leading-snug text-neutral-900">{source.title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{describeSource(source, matters)}</p>
        </div>
        <Button aria-label="Close source" onClick={onClose} size="icon" variant="ghost">
          <X size={18} />
        </Button>
      </header>
      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {source.excerpt ? (
          <div className="min-w-0 break-words rounded-sm border border-neutral-200 bg-surface px-4 py-4 font-serif text-[17px] leading-8 text-neutral-900">
            <MarkdownContent markdown={preview} />
            {isTruncated && <p aria-label="Source preview truncated" className="mt-3 text-neutral-500">…</p>}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            {source.kind === 'elitigation'
              ? 'A judgment excerpt is unavailable. Open the judgment to read the full text.'
              : `LexChat read this whole ${source.kind === 'document' ? 'document' : 'entry'}; open it to see the full text.`}
          </p>
        )}
        {source.kind === 'elitigation' ? (
          source.url && /^https:\/\/www\.elitigation\.sg\/gd\/s\/\d{4}_[A-Z]+_\d+$/.test(source.url) && (
            <a className="mt-6 inline-flex text-sm font-medium text-accent underline" href={source.url} target="_blank" rel="noopener noreferrer">
              Open full judgment on eLitigation
            </a>
          )
        ) : (
          <Button className="mt-6 border border-neutral-200" onClick={openFull} variant="secondary">
            {source.kind === 'document' ? 'Open full document' : 'Open Knowledge Bank entry'}
          </Button>
        )}
      </div>
    </aside>
  )
}
