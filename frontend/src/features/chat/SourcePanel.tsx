import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { Matter, MessageSource } from '../../shared/types/workspace'
import { Button } from '../../shared/ui/Button'
import { useWorkspaceNavigation } from '../../app/routes'
import { describeSource } from './sourceLabels'

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
          <p className="whitespace-pre-wrap rounded-sm bg-amber-100 px-3 py-3 font-serif text-[17px] leading-8 text-neutral-900">
            {source.excerpt}
          </p>
        ) : (
          <p className="text-sm text-neutral-500">
            LexChat read this whole {source.kind === 'document' ? 'document' : 'entry'}; open it to see the full text.
          </p>
        )}
        <Button className="mt-6 border border-neutral-200" onClick={openFull} variant="secondary">
          {source.kind === 'document' ? 'Open full document' : 'Open Knowledge Bank entry'}
        </Button>
      </div>
    </aside>
  )
}
