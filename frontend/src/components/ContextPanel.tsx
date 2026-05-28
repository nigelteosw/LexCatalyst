import type { ReactNode } from 'react'
import type { MatterDocument, Memory } from '../types/workspace'

type ContextPanelProps = {
  addMemoryLabel: string
  documentCount: string
  documents: MatterDocument[]
  insight: {
    label: string
    title: string
    body: string
  }
  memories: Memory[]
  memoryLabel: string
  onAddMemory: () => void
  onUpload: () => void
  uploadLabel: string
  uploadState: string
}

export function ContextPanel({
  addMemoryLabel,
  documentCount,
  documents,
  insight,
  memories,
  memoryLabel,
  onAddMemory,
  onUpload,
  uploadLabel,
  uploadState,
}: ContextPanelProps) {
  return (
    <aside
      aria-label="Matter context"
      className="min-h-0 overflow-y-auto border-t border-stone-200 bg-stone-100 p-4 lg:min-h-[calc(100vh-73px)] lg:border-l lg:border-t-0"
    >
      <PanelSection>
        <SectionHeading
          actionLabel={uploadLabel}
          label="Documents"
          onAction={onUpload}
          title={documentCount}
        />
        <button
          className="mb-4 flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 text-stone-700 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          onClick={onUpload}
          type="button"
        >
          <span aria-hidden="true">+</span>
          {uploadState}
        </button>
        <div className="grid gap-2">
          {documents.map((document) => (
            <DocumentRow document={document} key={document.name} />
          ))}
        </div>
      </PanelSection>

      <PanelSection>
        <SectionHeading
          actionLabel={addMemoryLabel}
          label={memoryLabel}
          onAction={onAddMemory}
          title={`${memories.length} saved`}
        />
        <div className="grid gap-3">
          {memories.map((memory) => (
            <MemoryItem key={`${memory.title}-${memory.status}`} memory={memory} />
          ))}
        </div>
      </PanelSection>

      <section className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <p className="mb-1 text-xs font-bold uppercase text-stone-300">{insight.label}</p>
        <h3 className="text-base font-semibold leading-tight text-white">{insight.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-stone-300">{insight.body}</p>
      </section>
    </aside>
  )
}

function PanelSection({ children }: { children: ReactNode }) {
  return <section className="mt-4 rounded-lg border border-stone-200 bg-white p-4 first:mt-0">{children}</section>
}

type SectionHeadingProps = {
  actionLabel: string
  label: string
  onAction: () => void
  title: string
}

function SectionHeading({ actionLabel, label, onAction, title }: SectionHeadingProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase text-stone-500">{label}</p>
        <h3 className="text-base font-semibold leading-tight text-stone-950">{title}</h3>
      </div>
      <button
        className="min-h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        onClick={onAction}
        type="button"
      >
        {actionLabel}
      </button>
    </div>
  )
}

function DocumentRow({ document }: { document: MatterDocument }) {
  const statusClass =
    document.status === 'ready' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'

  return (
    <div className="flex items-center justify-between gap-3 border-t border-stone-100 py-3 first:border-t-0">
      <div className="min-w-0">
        <strong className="block truncate text-sm font-semibold leading-tight text-stone-950">
          {document.name}
        </strong>
        <p className="mt-1 text-sm leading-snug text-stone-500">{document.detail}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-1 text-xs capitalize ${statusClass}`}>
        {document.status}
      </span>
    </div>
  )
}

function MemoryItem({ memory }: { memory: Memory }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <strong className="text-sm font-semibold leading-tight text-stone-950">{memory.title}</strong>
        <span className="shrink-0 text-xs font-bold text-amber-800">{memory.status}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">{memory.body}</p>
    </article>
  )
}
