import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type MarkdownContentProps = {
  markdown: string
  className?: string
}

export function MarkdownContent({ markdown, className = '' }: MarkdownContentProps) {
  return (
    <div className={`chat-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
