import { isGoogleDoc } from '../lib/pageText'
import type { BrowserContext } from './useBrowserContext'

export function ContextChips({ context, onSearchCases }: { context: BrowserContext; onSearchCases: () => void }) {
  const { tab, siteEnabled, selection, page } = context
  return (
    <div className="space-y-1 text-xs">
      {selection && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-amber-50 px-2 py-1">
          <span className="line-clamp-2">
            <strong>Highlighted:</strong> “{selection.text}”{selection.truncated && ' (truncated)'}
          </span>
          <span className="flex shrink-0 gap-2">
            <button className="underline" onClick={onSearchCases}>
              Search eLitigation
            </button>
            <button aria-label="Remove highlighted text" onClick={context.clearSelection}>
              ×
            </button>
          </span>
        </div>
      )}
      {page && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-stone-100 px-2 py-1">
          <span className="line-clamp-1">
            <strong>Page:</strong> {page.title || page.url}
            {page.truncated && ' (truncated)'}
          </span>
          <button aria-label="Remove page text" onClick={context.clearPage}>
            ×
          </button>
        </div>
      )}
      {tab && !siteEnabled && (
        <p className="text-stone-500">
          <button className="underline" onClick={() => void context.enableCurrentSite()}>
            Turn on Birdie for this site
          </button>{' '}
          to share highlights and page text. Birdie only reads sites you turn on.
        </p>
      )}
      {tab && siteEnabled && !selection && isGoogleDoc(tab.url) && (
        <p className="text-stone-500">In Google Docs, copy (⌘C) or right-click highlighted text to share it.</p>
      )}
      {context.error && <p className="text-red-600">{context.error}</p>}
    </div>
  )
}
