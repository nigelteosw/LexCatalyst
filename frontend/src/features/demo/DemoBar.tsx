type DemoBarProps = {
  name: string
  role: string
  onReturn: () => void
}

/** Always-visible reminder of who the presenter is acting as while switched into a demo user. */
export function DemoBar({ name, role, onReturn }: DemoBarProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-center gap-3 bg-[#fef3dc] px-3 py-1.5 text-meta text-[#8a5a00]"
      role="status"
    >
      <span>
        Demo · viewing as <strong className="font-semibold">{name}</strong> ({role})
      </span>
      <button className="font-semibold underline hover:no-underline" onClick={onReturn} type="button">
        Switch back
      </button>
    </div>
  )
}
