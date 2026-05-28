type TopbarProps = {
  actions: string[]
  label: string
  title: string
}

export function Topbar({ actions, label, title }: TopbarProps) {
  return (
    <header className="flex min-h-[73px] flex-col gap-3 border-b border-stone-200 bg-stone-50 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
      <div>
        <p className="text-xs font-bold uppercase text-stone-500">{label}</p>
        <h2 className="text-xl font-semibold leading-tight text-stone-950">{title}</h2>
      </div>

      <div aria-label="Workspace actions" className="flex w-full gap-2 overflow-x-auto md:w-auto">
        {actions.map((action) => (
          <button
            className="min-h-9 shrink-0 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            key={action}
            type="button"
          >
            {action}
          </button>
        ))}
      </div>
    </header>
  )
}
