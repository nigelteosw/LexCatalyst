import { useEffect, useState, useCallback, useRef } from 'react'
import {
  BookMarked,
  Brain,
  BriefcaseBusiness,
  CheckSquare,
  Clock,
  FileText,
  HeartPulse,
  Home,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteChatThread,
  getReviewsWaitingCount,
  renameChatThread,
} from '../../shared/api/api'
import type { ChatThread, Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import birdieLogo from '../../assets/Birdie.png'

export type SidebarProps = {
  threads: ChatThread[]
  matters: Matter[]
  isBirdieOpen: boolean
  selectedMatterId: string | null
  onBirdieToggle: () => void
  onMatterChange: (matterId: string | null) => void
  onNewChat: () => void
  isOpen: boolean
  onClose: () => void
  onLogout: () => void
  userFullName: string
  userInitials: string
}

const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 236

const sidebarActionClass =
  'flex w-full items-center gap-2 rounded-[9px] px-3 py-2 text-left text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f0f]'

const sidebarNavClass =
  'text-white/50 hover:bg-white/[0.07] hover:text-white/85'

const sidebarNavActiveClass = 'bg-white/10 text-white'

export function Sidebar({
  threads,
  matters,
  isBirdieOpen,
  selectedMatterId,
  onBirdieToggle,
  onMatterChange,
  onNewChat,
  isOpen,
  onClose,
  onLogout,
  userFullName,
  userInitials,
}: SidebarProps) {
  const {
    current,
    selectHome,
    selectThread,
    selectMemories,
    selectDocuments,
    selectKnowledgeBank,
    selectWellbeing,
    selectActions,
    selectSettings,
  } = useWorkspaceNavigation()

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Poll the "reviews waiting for you" count so the Workboard badge stays
  // current as juniors submit work. Refetches every 30s and on window focus.
  const reviewsWaiting = useQuery({
    queryKey: ['reviewsWaiting'],
    queryFn: getReviewsWaitingCount,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
  const reviewBadge = reviewsWaiting.data ?? 0

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
    if (!isResizing) return
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing, resize, stopResizing])

  function closeMobile() {
    if (window.innerWidth < 1024) onClose()
  }

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 overscroll-none bg-neutral-900/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh flex-col overflow-hidden overscroll-none bg-[#0f0f0f] text-[#fafaf8] transition-transform duration-300 lg:relative lg:h-auto lg:max-h-none lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: `${width}px` }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {/* Sidebar Header */}
          <div className="border-b border-white/[0.08] px-3.5 pb-3.5 pt-[18px]">
            <div className="mb-4 flex items-center justify-between">
              <button
                aria-label="Go to home dashboard"
                className="flex items-center gap-2.5 text-white transition-opacity hover:opacity-80"
                onClick={() => { selectHome(); onClose() }}
                type="button"
              >
                <span className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-white/[0.18] font-serif text-[15px] italic">
                  L
                </span>
                <span className="font-serif text-base italic tracking-[-0.01em]">
                  LexCatalyst
                </span>
              </button>
              <button
                onClick={onClose}
                aria-label="Close sidebar"
                className="grid h-8 w-8 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            <button
              onClick={() => {
                onNewChat()
                closeMobile()
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-[9px] border border-white/10 bg-white/[0.07] px-3 py-2 text-xs font-medium text-white/65 transition-colors hover:bg-white/[0.13] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              type="button"
            >
              <Plus size={13} strokeWidth={2.25} />
              New LexChat
            </button>
            <button
              aria-label={isBirdieOpen ? 'Close Birdie' : 'Open Birdie'}
              aria-pressed={isBirdieOpen}
              className={`mt-2 flex w-full items-center gap-2 rounded-[9px] border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isBirdieOpen
                  ? 'border-[#2d9e6b]/55 bg-[#2d9e6b]/15 text-[#6ed6a4]'
                  : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.1] hover:text-white'
              }`}
              onClick={() => {
                onBirdieToggle()
                closeMobile()
              }}
              type="button"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border border-[#2d9e6b]/45 bg-[#fff8d8]">
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-auto w-[250%] max-w-none"
                  src={birdieLogo}
                />
              </span>
              <span className="flex-1">Birdie</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isBirdieOpen ? 'animate-pulse bg-[#2d9e6b]' : 'bg-white/25'
                }`}
              />
              <span className="text-[10px] font-normal text-current/70">
                {isBirdieOpen ? 'Close' : 'Open'}
              </span>
            </button>
          </div>

          <nav
            aria-label="Workspace"
            className="flex flex-col gap-0.5 border-b border-white/[0.08] px-1.5 py-2"
          >
            <button
              onClick={() => {
                selectHome()
                closeMobile()
              }}
              className={`${sidebarActionClass} ${
                current.view === 'home' ? sidebarNavActiveClass : sidebarNavClass
              }`}
              type="button"
            >
              <Home size={14} />
              Home
            </button>
            <button
              onClick={() => {
                selectKnowledgeBank()
                closeMobile()
              }}
              className={`${sidebarActionClass} ${
                current.view === 'knowledge_bank' ? sidebarNavActiveClass : sidebarNavClass
              }`}
              type="button"
            >
              <BookMarked size={14} />
              Knowledge Bank
            </button>
            <button
              onClick={() => {
                selectMemories()
                closeMobile()
              }}
              className={`${sidebarActionClass} ${
                current.view === 'memories' ? sidebarNavActiveClass : sidebarNavClass
              }`}
              type="button"
            >
              <Brain size={14} />
              Memories
            </button>
            <button
              onClick={() => {
                selectDocuments()
                closeMobile()
              }}
              className={`${sidebarActionClass} ${
                current.view === 'documents' ? sidebarNavActiveClass : sidebarNavClass
              }`}
              type="button"
            >
              <FileText size={14} />
              Documents
            </button>
            <button
              onClick={() => {
                selectWellbeing()
                closeMobile()
              }}
              className={`${sidebarActionClass} ${
                current.view === 'wellbeing' ? sidebarNavActiveClass : sidebarNavClass
              }`}
              type="button"
            >
              <HeartPulse size={14} />
              Wellbeing
            </button>
            <button
              onClick={() => {
                selectActions()
                closeMobile()
              }}
              className={`${sidebarActionClass} ${
                current.view === 'actions' ? sidebarNavActiveClass : sidebarNavClass
              }`}
              type="button"
            >
              <CheckSquare size={14} />
              <span className="flex-1 text-left">Workboard</span>
              {reviewBadge > 0 && (
                <span
                  aria-label={`${reviewBadge} reviews waiting for you`}
                  className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#f0a000] px-1 text-[9.5px] font-semibold text-[#0f0f0f]"
                >
                  {reviewBadge}
                </span>
              )}
            </button>
          </nav>

          {/* Past Chats List */}
          <nav
            aria-label="Recent LexChat conversations"
            className="app-scroll-region lex-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-2"
          >
            {matters.length > 0 && (
              <>
                <div className="mb-1 flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.09em] text-white/30">
                  <BriefcaseBusiness size={11} />
                  Recent matters
                </div>
                <div className="mb-3 space-y-0.5">
                  {matters.slice(0, 4).map((matter) => (
                    <button
                      key={matter.id}
                      className={`${sidebarActionClass} py-1.5 ${
                        selectedMatterId === matter.id ? sidebarNavActiveClass : sidebarNavClass
                      }`}
                      onClick={() => {
                        onMatterChange(matter.id)
                        selectKnowledgeBank()
                        closeMobile()
                      }}
                      type="button"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-normal">
                          {matter.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[9.5px] text-white/25">
                          {matter.caseNumber}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mb-1 flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.09em] text-white/30">
              <Clock size={11} />
              Recent LexChats
            </div>
            {threads.length > 0 ? (
              <div className="space-y-0.5">
                {threads.map((thread, index) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    isActive={
                      current.view === 'chat' && thread.id === current.threadId
                    }
                    dotClass={threadDotClass(index)}
                    onSelect={() => {
                      selectThread(thread.id)
                      closeMobile()
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="px-2.5 py-3 text-[11px] text-white/30">No recent LexChats</div>
            )}
          </nav>

          {/* Sidebar Footer */}
          <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.08] px-2.5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <button
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              onClick={() => {
                selectSettings()
                closeMobile()
              }}
              type="button"
            >
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-semibold uppercase text-white">
                {userInitials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-medium text-white/80">
                  {userFullName}
                </div>
                <div className="truncate text-[9.5px] text-white/30">Profile settings</div>
              </div>
              <Settings size={14} className="shrink-0 text-white/35" />
            </button>
            <button
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              type="button"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={startResizing}
          className={`absolute bottom-0 right-0 top-0 hidden w-1 cursor-col-resize transition-colors hover:bg-white/15 lg:block ${
            isResizing ? 'w-1.5 bg-white/20' : 'bg-transparent'
          }`}
        />
      </aside>
    </>
  )
}

function ThreadRow({
  thread,
  isActive,
  dotClass,
  onSelect,
}: {
  thread: ChatThread
  isActive: boolean
  dotClass: string
  onSelect: () => void
}) {
  const queryClient = useQueryClient()
  const { current, startNewChat } = useWorkspaceNavigation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(thread.title)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus()
  }, [isRenaming])

  const renameMutation = useMutation({
    mutationFn: (title: string) => renameChatThread(thread.id, title),
    onSuccess: (updated) => {
      queryClient.setQueryData<ChatThread[]>(['threads'], (old) =>
        old?.map((t) => (t.id === updated.id ? updated : t)) ?? [],
      )
      setIsRenaming(false)
    },
    onError: () => setDraftTitle(thread.title),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteChatThread(thread.id),
    onSuccess: () => {
      queryClient.setQueryData<ChatThread[]>(['threads'], (old) =>
        old?.filter((t) => t.id !== thread.id) ?? [],
      )
      queryClient.removeQueries({ queryKey: ['messages', thread.id] })
      // If the deleted thread was the active one, drop the user to a new chat
      if (current.view === 'chat' && current.threadId === thread.id) {
        startNewChat({ replace: true })
      }
    },
  })

  function commitRename() {
    const next = draftTitle.trim()
    if (!next || next === thread.title) {
      setIsRenaming(false)
      setDraftTitle(thread.title)
      return
    }
    renameMutation.mutate(next)
  }

  function handleDelete() {
    setMenuOpen(false)
    if (window.confirm(`Delete "${thread.title}"? This cannot be undone.`)) {
      deleteMutation.mutate()
    }
  }

  return (
    <div
      className={`group relative flex items-center gap-1 rounded-[9px] pr-1 transition-colors ${
        isActive ? 'bg-white/10' : 'hover:bg-white/[0.07]'
      }`}
    >
      {isRenaming ? (
        <div className="flex w-full items-center gap-2 px-3 py-1.5">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11.5px] text-white outline-none focus:border-white/45"
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setIsRenaming(false)
                setDraftTitle(thread.title)
              }
            }}
            onBlur={commitRename}
            value={draftTitle}
            maxLength={160}
          />
        </div>
      ) : (
        <>
          <button
            onClick={onSelect}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-[9px] px-3 py-1.5 text-left text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f0f] ${
              isActive ? 'text-white' : 'text-white/50 group-hover:text-white/85'
            }`}
            type="button"
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-normal">{thread.title}</span>
              <span
                className={`mt-0.5 block text-[9.5px] ${
                  isActive ? 'text-white/45' : 'text-white/25 group-hover:text-white/40'
                }`}
              >
                {formatThreadDate(thread.updatedAt)}
              </span>
            </span>
          </button>
          <button
            aria-label={`Options for ${thread.title}`}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-white/35 transition-colors hover:bg-white/10 hover:text-white/80 ${
              menuOpen ? 'bg-white/10 text-white/80' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
            type="button"
          >
            <MoreHorizontal size={13} />
          </button>
        </>
      )}

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-1 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-white/10 bg-[#1a1a1a] py-1 shadow-xl"
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-white/80 hover:bg-white/[0.08] hover:text-white"
            onClick={() => {
              setMenuOpen(false)
              setDraftTitle(thread.title)
              setIsRenaming(true)
            }}
            type="button"
          >
            <Pencil size={12} />
            Rename
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-red-300 hover:bg-red-500/15 hover:text-red-200"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            type="button"
          >
            <Trash2 size={12} />
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

function threadDotClass(index: number) {
  const colors = ['bg-emerald-300', 'bg-violet-300', 'bg-amber-300', 'bg-sky-300']
  return colors[index % colors.length]
}

function formatThreadDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Saved'

  const now = new Date()
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24))

  if (diffInDays === 0) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  if (diffInDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}
