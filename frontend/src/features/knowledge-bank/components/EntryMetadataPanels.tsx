import { useState, type ReactNode } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'
import {
  DocumentFields,
  MetadataBoundary,
  SaveBar,
  SummaryEditor,
  TagsEditor,
  type MetadataEditor,
} from '../../documents/DocumentMetadataCard'
import { formatDateTime, formatLongDate } from '../../../shared/lib/dates'
import type { KnowledgeBankEntry } from '../../../shared/types/workspace'

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <button
          aria-expanded={open}
          className="-ml-1 flex items-center gap-1.5 rounded px-1 text-body font-semibold text-ink"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <ChevronDown className={`text-ink-tertiary transition-transform ${open ? '' : '-rotate-90'}`} size={15} />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  )
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-2.5">
      {rows.map(([label, value]) => (
        <div className="flex items-baseline justify-between gap-4" key={label}>
          <dt className="text-meta text-ink-tertiary">{label}</dt>
          <dd className="text-right text-meta text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The compact right-hand Summary rail: summary, tags, key document facts and info. */
export function EntrySummarySidebar({ editor, entry }: { editor: MetadataEditor; entry: KnowledgeBankEntry }) {
  const [editingSummary, setEditingSummary] = useState(false)
  return (
    <aside
      aria-label="Summary"
      className="overflow-hidden rounded-xl border border-neutral-200 bg-white lg:sticky lg:top-6"
    >
      <h2 className="border-b border-neutral-100 px-5 py-3.5 text-body font-semibold text-ink">Summary</h2>
      <div className="divide-y divide-neutral-100">
        <MetadataBoundary editor={editor} noticeClassName="px-5 py-4">
          {(e) => (
            <>
              <Section
                action={
                  e.canEdit && (
                    <button
                      aria-label={editingSummary ? 'Done editing summary' : 'Edit summary'}
                      className="grid h-7 w-7 place-items-center rounded-md text-ink-tertiary transition-colors hover:bg-neutral-100 hover:text-ink"
                      onClick={() => setEditingSummary((value) => !value)}
                      type="button"
                    >
                      <Pencil size={13} />
                    </button>
                  )
                }
                title="Summary"
              >
                {editingSummary ? (
                  <SummaryEditor autoFocus editor={e} />
                ) : (
                  <p className="text-body leading-6 text-ink-secondary">
                    {e.draft.summary || <span className="text-ink-tertiary">No summary yet.</span>}
                  </p>
                )}
              </Section>
              <Section title="Tags">
                <TagsEditor editor={e} />
              </Section>
              {e.isDocument && (
                <Section title="Document">
                  <Facts
                    rows={[
                      ['Type', e.draft.documentType],
                      ['Status', e.draft.documentStatus],
                      ['Executed', e.draft.executionDate ? formatLongDate(e.draft.executionDate) : '—'],
                    ]}
                  />
                </Section>
              )}
            </>
          )}
        </MetadataBoundary>
        <Section title="Info">
          <Facts
            rows={[
              ['Author role', entry.createdByRole.replaceAll('_', ' ')],
              ['Added', formatDateTime(entry.createdAt)],
              ['Latest edit', formatDateTime(entry.updatedAt)],
              ['Version', String(entry.version)],
            ]}
          />
        </Section>
      </div>
      {editor.state === 'ready' && (
        <SaveBar className="border-t border-neutral-100 bg-white px-5 py-3" editor={editor} />
      )}
    </aside>
  )
}

type Evidence = { value: string; locator?: string; quote?: string }
type Row = { label: string; value: string; locator?: string; quote?: string }

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

function humanise(name: string): string {
  const text = name.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function evidenceRows(group: unknown): Row[] {
  if (!group || typeof group !== 'object') return []
  return Object.entries(group as Record<string, Evidence | null>).flatMap(([name, item]) => {
    const value = asText(item?.value)
    return value ? [{ label: humanise(name), value, locator: asText(item?.locator), quote: asText(item?.quote) }] : []
  })
}

function listRows(list: unknown, label: (item: Record<string, unknown>) => string | undefined, value: (item: Record<string, unknown>) => string | undefined): Row[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    const item = raw as Record<string, unknown>
    const l = label(item)
    const v = value(item)
    return l && v ? [{ label: l, value: v, locator: asText(item.locator), quote: asText(item.quote) }] : []
  })
}

function FactTable({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-label font-medium uppercase tracking-wider text-ink-tertiary">{title}</h3>
      <dl className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {rows.map((row, index) => (
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4" key={`${row.label}-${index}`}>
            <dt className="text-meta text-ink-tertiary">{row.label}</dt>
            <dd className="min-w-0">
              <p className="text-body text-ink">{row.value}</p>
              {(row.locator || row.quote) && (
                <p className="mt-1 text-meta leading-5 text-ink-tertiary">
                  {row.locator && row.locator !== 'unspecified' && <span className="font-medium">{row.locator}</span>}
                  {row.locator && row.locator !== 'unspecified' && row.quote && ' · '}
                  {row.quote && <span>“{row.quote}”</span>}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The Details tab for a document entry: editable document fields plus what was extracted. */
export function DocumentDetailsTab({ editor, entry }: { editor: MetadataEditor; entry: KnowledgeBankEntry }) {
  const fields = entry.catalogueFields ?? {}
  const parties = listRows(fields.parties, (i) => asText(i.name), (i) => asText(i.role) ?? 'Party')
  const dates = listRows(fields.key_dates, (i) => asText(i.label), (i) => asText(i.date))
  const amounts = listRows(
    fields.amounts,
    (i) => asText(i.label),
    (i) => [asText(i.currency), asText(i.value)].filter(Boolean).join(' '),
  )
  const terms = [...evidenceRows(fields.fields), ...evidenceRows(fields.type_fields)]
  const hasFacts = parties.length + dates.length + amounts.length + terms.length > 0

  return (
    <div className="space-y-8 rounded-xl border border-neutral-200 bg-white px-6 py-7 sm:px-8">
      <section>
        <h3 className="mb-3 text-body font-semibold text-ink">Document details</h3>
        <MetadataBoundary editor={editor}>{(e) => <DocumentFields editor={e} />}</MetadataBoundary>
      </section>
      {hasFacts ? (
        <>
          <FactTable rows={parties} title="Parties" />
          <FactTable rows={dates} title="Key dates" />
          <FactTable rows={amounts} title="Amounts" />
          <FactTable rows={terms} title="Terms" />
        </>
      ) : (
        <p className="text-body text-ink-tertiary">No structured fields were extracted from this document.</p>
      )}
    </div>
  )
}
