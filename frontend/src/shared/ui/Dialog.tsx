import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

type DialogProps = {
  children: ReactNode
  onClose: () => void
  title: string
  className?: string
}

export function Dialog({ children, className = '', onClose, title }: DialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousActiveElement?.focus()
    }
  }, [])

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[80] grid place-items-center bg-black/35 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="dialog"
    >
      <div
        ref={panelRef}
        className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-2xl border border-black/10 bg-[#fafaf8] shadow-2xl outline-none ${className || 'max-w-xl'}`}
        tabIndex={-1}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-[#fafaf8]/95 px-4 py-3 backdrop-blur">
          <h2 className="text-sm font-semibold text-[#0f0f0f]" id={titleId}>
            {title}
          </h2>
          <Button aria-label="Close dialog" onClick={onClose} size="icon" variant="ghost">
            <X size={16} />
          </Button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
