import { useEffect, useEffectEvent, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

type DialogProps = {
  bodyClassName?: string
  children: ReactNode
  headerActions?: ReactNode
  onClose: () => void
  title: ReactNode
  className?: string
}

export function Dialog({
  bodyClassName = 'p-5',
  children,
  className = '',
  headerActions,
  onClose,
  title,
}: DialogProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeDialog = useEffectEvent(onClose)

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeDialog()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panelRef.current.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousActiveElement?.focus()
    }
  }, [])

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="viewport-overlay fixed inset-0 z-[80] grid place-items-center bg-black/35 p-2 sm:p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="dialog"
    >
      <div
        ref={panelRef}
        className={`max-h-[calc(var(--app-height,100dvh)-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-w-0 w-full sm:max-h-[calc(var(--app-height,100dvh)-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto rounded-lg border border-black/10 bg-[#fafaf8] shadow-2xl outline-none ${className || 'max-w-xl'}`}
        tabIndex={-1}
      >
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-[#fafaf8]/95 px-4 py-3 backdrop-blur">
          {typeof title === 'string' ? (
            <h2 className="min-w-0 flex-1 break-words text-sm font-semibold text-[#0f0f0f]" id={titleId}>
              {title}
            </h2>
          ) : (
            <div className="min-w-0 flex-1 text-sm font-semibold text-[#0f0f0f]" id={titleId}>
              {title}
            </div>
          )}
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
            {headerActions}
            <Button aria-label="Close dialog" onClick={onClose} size="icon" variant="ghost">
              <X size={16} />
            </Button>
          </div>
        </header>
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>
  )
}
