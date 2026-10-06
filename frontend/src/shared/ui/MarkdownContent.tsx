import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type MarkdownContentProps = {
  markdown: string
  className?: string
  /**
   * Footnote support: `[n]` markers for these source numbers render as numbered chips
   * and call `onFootnoteClick(n)`. Other bracketed text is left alone.
   */
  footnotes?: number[]
  onFootnoteClick?: (n: number) => void
}

const FOOTNOTE_HREF = '#footnote-'

/** Turn `[3]` into a link the renderer turns into a chip; skips `[3](url)` and existing links. */
export function linkFootnotes(markdown: string, footnotes: number[]): string {
  if (footnotes.length === 0) return markdown
  const known = new Set(footnotes)
  return markdown.replace(/\[(\d{1,3})\](?!\(|\])/g, (match, digits: string) =>
    known.has(Number(digits)) ? `[${digits}](${FOOTNOTE_HREF}${digits})` : match,
  )
}

export function MarkdownContent({
  markdown,
  className = '',
  footnotes,
  onFootnoteClick,
}: MarkdownContentProps) {
  const text = footnotes?.length ? linkFootnotes(markdown, footnotes) : markdown
  return (
    <div className={`chat-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith(FOOTNOTE_HREF) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ children, href, ...props }) => {
            if (href?.startsWith(FOOTNOTE_HREF)) {
              const n = Number(href.slice(FOOTNOTE_HREF.length))
              return (
                <button
                  aria-label={`Source ${n}`}
                  className="mx-0.5 inline-flex min-w-3 -translate-y-1 items-center justify-center align-baseline font-sans text-[11px] font-medium leading-none tracking-[0.02em] text-accent transition-colors hover:text-accent-hover"
                  onClick={() => onFootnoteClick?.(n)}
                  type="button"
                >
                  {n}
                </button>
              )
            }
            return (
              <a {...props} href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// react-markdown's default sanitiser drops unknown protocols; keep http(s), mailto and relative links.
function defaultUrlTransform(url: string): string {
  return /^(https?:|mailto:|\/|#)/i.test(url) ? url : ''
}
