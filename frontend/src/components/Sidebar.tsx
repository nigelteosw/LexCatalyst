type SidebarProps = {
  activeThread: string
  brand: {
    initials: string
    name: string
    title: string
  }
  newChatLabel: string
  onSelectThread: (thread: string) => void
  threads: string[]
  workspace: {
    label: string
    name: string
  }
}

export function Sidebar({
  activeThread,
  brand,
  newChatLabel,
  onSelectThread,
  threads,
  workspace,
}: SidebarProps) {
  return (
    <aside
      aria-label="Workspace navigation"
      className="flex min-h-screen flex-col border-r border-neutral-800 bg-neutral-950 p-4 text-neutral-200 md:p-5"
    >
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-neutral-700 bg-neutral-800 text-xs font-bold text-white">
          {brand.initials}
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-neutral-400">{brand.name}</p>
          <h1 className="text-lg font-semibold leading-tight text-white">{brand.title}</h1>
        </div>
      </div>

      <button
        className="mb-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-neutral-800 px-3 text-sm font-medium text-white transition hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-neutral-950"
        type="button"
      >
        <span aria-hidden="true">+</span>
        {newChatLabel}
      </button>

      <nav aria-label="Recent chats" className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-1">
        {threads.map((thread) => {
          const isActive = thread === activeThread

          return (
            <button
              className={`min-h-10 rounded-lg px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                isActive
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
              }`}
              key={thread}
              onClick={() => onSelectThread(thread)}
              type="button"
            >
              {thread}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <p className="text-xs text-neutral-400">{workspace.label}</p>
        <strong className="text-sm text-white">{workspace.name}</strong>
      </div>
    </aside>
  )
}
