import { useEffect, useState, useCallback, useRef } from 'react'
import { MessageSquare, Plus, X, Clock, Brain } from 'lucide-react'
import type { ChatThread } from '../types/workspace'

type SidebarProps = {
  threads: ChatThread[]
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onSelectMemories: () => void
  onNewChat: () => void
  isOpen: boolean
  onClose: () => void
  userFullName: string
  userInitials: string
}

const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 260

export function Sidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onSelectMemories,
  onNewChat,
  isOpen,
  onClose,
  userFullName,
  userInitials,
}: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = e.clientX
        if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
          setWidth(newWidth)
        }
      }
    },
    [isResizing],
  )

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-neutral-900/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white transition-transform duration-300 lg:relative lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } border-r border-neutral-200`}
        style={{ width: isOpen || window.innerWidth >= 1024 ? `${width}px` : 'auto' }}
      >
        <div className="flex flex-col h-full min-h-0">
          {/* Sidebar Header */}
          <div className="flex items-center justify-between p-4 border-b border-neutral-100">
            <h1 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
              <span className="w-6 h-6 bg-neutral-900 text-white rounded grid place-items-center text-[10px]">LC</span>
              LexCatalyst
            </h1>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 text-neutral-500 hover:bg-neutral-100 rounded-md"
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-3 space-y-2">
            <button
              onClick={() => {
                onNewChat()
                if (window.innerWidth < 1024) onClose()
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 hover:border-neutral-300 transition-all shadow-sm"
            >
              <Plus size={16} />
              New chat
            </button>
            <button
              onClick={() => {
                onSelectMemories()
                if (window.innerWidth < 1024) onClose()
              }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                activeThreadId === 'memories'
                  ? 'bg-neutral-100 text-neutral-900 border border-neutral-200 shadow-sm'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 border border-transparent'
              }`}
            >
              <Brain size={16} />
              Memories
            </button>
          </div>

          {/* Past Chats List */}
          <nav className="flex-1 overflow-y-auto px-2 py-2">
            <div className="px-3 mb-2 flex items-center gap-2 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              <Clock size={12} />
              Recent History
            </div>
            {threads.length > 0 ? (
              <div className="space-y-0.5">
                {threads.map((thread) => {
                  const isActive = thread.id === activeThreadId
                  return (
                    <button
                      key={thread.id}
                      onClick={() => {
                        onSelectThread(thread.id)
                        if (window.innerWidth < 1024) onClose()
                      }}
                      className={`group flex items-center gap-3 w-full px-3 py-2.5 text-left rounded-lg transition-all ${
                        isActive
                          ? 'bg-neutral-100 text-neutral-900 shadow-sm'
                          : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                      }`}
                    >
                      <MessageSquare
                        size={16}
                        className={isActive ? 'text-neutral-900' : 'text-neutral-400 group-hover:text-neutral-600'}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{thread.title}</div>
                        <div className="text-[10px] text-neutral-400 mt-0.5">
                          {formatThreadDate(thread.updatedAt)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-neutral-400 italic">
                No recent chats
              </div>
            )}
          </nav>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-neutral-100">
             <div className="flex items-center gap-3 px-1">
                <div className="w-8 h-8 rounded-full bg-neutral-900 grid place-items-center text-[10px] font-semibold text-white shadow-sm uppercase">
                  {userInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-neutral-900 truncate uppercase tracking-tight">
                    {userFullName}
                  </div>
                  <div className="text-[10px] text-neutral-500 truncate">Professional Plan</div>
                </div>
             </div>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-neutral-300 transition-colors hidden lg:block ${
            isResizing ? 'bg-neutral-400 w-1.5' : 'bg-transparent'
          }`}
        />
      </aside>
    </>
  )
}

function formatThreadDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Saved'
  }

  const now = new Date()
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24))

  if (diffInDays === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
  if (diffInDays < 7) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
    }).format(date)
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}
