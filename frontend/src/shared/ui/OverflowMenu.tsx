import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

/** Small "more actions" menu so secondary actions don't crowd the header. */
export function OverflowMenu({
  items,
  label = 'More actions',
}: {
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    <div ref={ref} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          className="absolute right-0 z-20 mt-1.5 w-52 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.label}
              className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-neutral-50 disabled:text-neutral-400 ${item.danger ? 'text-red-700' : 'text-neutral-700'}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
