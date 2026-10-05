import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import {
  BookMarked,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  FolderInput,
  HeartPulse,
  Home,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteChatThread,
  listKnowledgeBankEntryPage,
  listActionItems,
  listSurveyQuestions,
  moveChatThread,
  renameChatThread,
} from '../../shared/api/api'
import type { ChatThread, Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import birdieLogo from '../../assets/Birdie.png'
import { MatterSelect } from '../../shared/ui/MatterSelect'
import { ChatsByMatter } from './ChatsByMatter'

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
  userRole: string
  menuExtra?: ReactNode
}

const COLLAPSED_WIDTH = 64
const COLLAPSED_KEY = 'lc.sidebar.collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
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
  userRole,
  menuExtra,
}: SidebarProps) {
  const {
    current,
    selectHome,
    selectThread,
    selectKnowledgeBank,
    selectWellbeing,
    selectActions,
    selectSettings,
  } = useWorkspaceNavigation()

  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  // Collapse is a desktop affordance; the mobile drawer always shows labels.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const isCollapsed = collapsed && isDesktop
  const sidebarRef = useRef<HTMLDivElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const queryClient = useQueryClient()

  // Keep the Workboard badge aligned with the board: count tickets that are
  // still active, not just review handoffs.
  const actionsQuery = useQuery({
    queryKey: ['actions'],
    queryFn: listActionItems,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })
  const pendingTaskCount = (actionsQuery.data ?? []).filter((item) => item.status !== 'done').length

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

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!userMenuOpen) return
    function onDocClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // per-viewer convenience only
      }
      return next
    })
  }

  function closeMobile() {
    if (window.innerWidth < 1024) onClose()
  }

  function prefetchWorkspace(view: 'knowledge_bank' | 'wellbeing' | 'actions') {
    if (view === 'knowledge_bank') {
      queryClient.prefetchInfiniteQuery({
        queryKey: [
          'kbEntries',
          {
            query: '',
            scope: 'all',
            type: 'all',
            matterId: selectedMatterId,
          },
        ],
        queryFn: ({ pageParam }) =>
          listKnowledgeBankEntryPage({
            contextMatterId: selectedMatterId ?? undefined,
            limit: 30,
            offset: Number(pageParam),
          }),
        initialPageParam: 0,
      })
      return
    }
    if (view === 'wellbeing') {
      queryClient.prefetchQuery({ queryKey: ['surveyQuestions', 'active'], queryFn: () => listSurveyQuestions(true) })
      return
    }
    queryClient.prefetchQuery({ queryKey: ['actions'], queryFn: listActionItems })
  }

  const kbActive = current.view === 'knowledge_bank'

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
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh flex-col overflow-hidden overscroll-none bg-[#0f0f0f] text-[#fafaf8] transition-[transform,width] duration-300 lg:relative lg:h-auto lg:max-h-none lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: `${isCollapsed ? COLLAPSED_WIDTH : width}px` }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {/* Sidebar Header */}
          <div
            className={`border-b border-white/[0.08] pb-3 pt-[18px] ${isCollapsed ? 'px-2' : 'px-3.5'}`}
          >
            <div
              className={`flex items-center ${
                isCollapsed ? 'flex-col gap-2' : 'justify-between'
              }`}
            >
              <button
                aria-label="Go to home dashboard"
                className="flex items-center gap-2.5 text-white transition-opacity hover:opacity-80"
                onClick={() => { selectHome(); onClose() }}
                type="button"
              >
                <img alt="" className="h-[30px] w-[30px] rounded-lg" src="/favicon.svg" />
                {!isCollapsed && (
                  <span className="text-[15px] font-semibold tracking-[-0.02em]">
                    LexCatalyst
                  </span>
                )}
              </button>
              <div className="flex items-center">
                <button
                  onClick={toggleCollapsed}
                  aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className="hidden h-8 w-8 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:grid"
                  type="button"
                >
                  {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
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
            </div>
          </div>

          <nav
            aria-label="Workspace"
            className="flex flex-col gap-0.5 border-b border-white/[0.08] px-1.5 py-2"
          >
            <NavItem icon={Home} label="Home" collapsed={isCollapsed} active={current.view === 'home' || current.view === 'matter' || current.view === 'documents'}
              onClick={() => { selectHome(); closeMobile() }} />
            <NavItem icon={MessageSquare} label="LexChat" collapsed={isCollapsed} active={current.view === 'chat'}
              onClick={() => { onNewChat(); closeMobile() }} />
            <NavItem icon={BookMarked} label="Knowledge Bank" collapsed={isCollapsed} active={kbActive}
              onPrefetch={() => prefetchWorkspace('knowledge_bank')}
              onClick={() => { selectKnowledgeBank(); closeMobile() }} />
            <NavItem icon={HeartPulse} label="Wellbeing" collapsed={isCollapsed} active={current.view === 'wellbeing'}
              onPrefetch={() => prefetchWorkspace('wellbeing')}
              onClick={() => { selectWellbeing(); closeMobile() }} />
            <NavItem icon={CheckSquare} label="Workboard" collapsed={isCollapsed} active={current.view === 'actions'}
              badge={pendingTaskCount} onPrefetch={() => prefetchWorkspace('actions')}
              onClick={() => { selectActions(); closeMobile() }} />
            <button
              aria-label={isBirdieOpen ? 'Close Birdie' : 'Open Birdie'}
              aria-pressed={isBirdieOpen}
              title={isCollapsed ? 'Birdie' : undefined}
              className={`mt-1 flex min-h-10 w-full items-center gap-3 rounded-[9px] border px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isCollapsed ? 'justify-center px-0' : ''
              } ${
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
                <img alt="" aria-hidden="true" className="h-auto w-[250%] max-w-none" src={birdieLogo} />
              </span>
              {!isCollapsed && (
                <>
                  <span className="flex-1">Birdie</span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isBirdieOpen ? 'animate-pulse bg-[#2d9e6b]' : 'bg-white/25'
                    }`}
                  />
                </>
              )}
            </button>
          </nav>

          {/* Chats by matter: only on the LexChat page */}
          {current.view === 'chat' && !isCollapsed ? (
            <nav
              aria-label="LexChat conversations by matter"
              className="app-scroll-region lex-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-3"
            >
              <ChatsByMatter
                threads={threads}
                matters={matters}
                onSelectMatter={(id) => {
                  onMatterChange(id)
                  onNewChat()
                  closeMobile()
                }}
                renderThread={(thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    matters={matters}
                    isActive={current.view === 'chat' && thread.id === current.threadId}
                    onSelect={() => {
                      selectThread(thread.id)
                      closeMobile()
                    }}
                  />
                )}
              />
            </nav>
          ) : (
            <div className="min-h-0 flex-1" />
          )}

          {/* Sidebar Footer: user button opens the account menu */}
          <div
            ref={userMenuRef}
            className="relative shrink-0 border-t border-white/[0.08] px-2 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
          >
            {(
              <div
                aria-hidden={!userMenuOpen}
                role="menu"
                aria-label="Account menu"
                className={`absolute bottom-full z-50 mb-1 origin-bottom overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] py-1.5 shadow-xl transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none ${
                  isCollapsed ? 'left-2 w-60' : 'inset-x-2'
                } ${
                  userMenuOpen
                    ? 'visible translate-y-0 scale-100 opacity-100'
                    : 'invisible translate-y-1 scale-95 opacity-0'
                }`}
              >
                <div className="px-1.5">
                  <UserMenuItem
                    label="Profile settings"
                    onClick={() => {
                      setUserMenuOpen(false)
                      selectSettings()
                      closeMobile()
                    }}
                  />
                  <UserMenuItem
                    label="Wellbeing"
                    onClick={() => {
                      setUserMenuOpen(false)
                      selectWellbeing()
                      closeMobile()
                    }}
                  />
                  <UserMenuItem
                    label="Birdie"
                    hint={
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${isBirdieOpen ? 'bg-[#2d9e6b]' : 'bg-white/25'}`}
                        />
                        {isBirdieOpen ? 'Open' : 'Closed'}
                      </span>
                    }
                    onClick={() => {
                      setUserMenuOpen(false)
                      onBirdieToggle()
                      closeMobile()
                    }}
                  />
                </div>
                {menuExtra}
                <div className="mt-1 border-t border-white/[0.08] px-1.5 pt-1.5">
                  <UserMenuItem
                    label="Sign out"
                    onClick={() => {
                      setUserMenuOpen(false)
                      onLogout()
                    }}
                  />
                </div>
              </div>
            )}
            <button
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label="Account menu"
              title={isCollapsed ? `${userFullName} · ${userRole}` : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isCollapsed ? 'justify-center px-0' : ''
              } ${
                userMenuOpen
                  ? 'border-white/25 bg-white/[0.08]'
                  : 'border-transparent hover:bg-white/[0.07]'
              }`}
              onClick={() => setUserMenuOpen((open) => !open)}
              type="button"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold uppercase text-white">
                {userInitials}
              </div>
              {!isCollapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-white/85">{userFullName}</div>
                    <div className="truncate text-[10.5px] capitalize text-white/40">{userRole}</div>
                  </div>
                  <ChevronsUpDown
                    size={14}
                    className={`shrink-0 text-white/35 transition-transform duration-150 motion-reduce:transition-none ${
                      userMenuOpen ? 'scale-110 text-white/60' : ''
                    }`}
                  />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        {!isCollapsed && (
          <div
            onMouseDown={startResizing}
            className={`absolute bottom-0 right-0 top-0 hidden w-1 cursor-col-resize transition-colors hover:bg-white/15 lg:block ${
              isResizing ? 'w-1.5 bg-white/20' : 'bg-transparent'
            }`}
          />
        )}
      </aside>
    </>
  )
}

function UserMenuItem({
  label,
  hint,
  onClick,
}: {
  label: string
  hint?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span>{label}</span>
      {hint && <span className="text-[11px] text-white/45">{hint}</span>}
    </button>
  )
}

function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
  onPrefetch,
  badge,
}: {
  icon: typeof Home
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  onPrefetch?: () => void
  badge?: number
}) {
  return (
    <button
      aria-label={label}
      title={collapsed ? label : undefined}
      onClick={onClick}
      onFocus={onPrefetch}
      onMouseEnter={onPrefetch}
      className={`${sidebarActionClass} relative min-h-10 gap-3 text-[13px] ${
        collapsed ? 'justify-center px-0' : ''
      } ${active ? sidebarNavActiveClass : sidebarNavClass}`}
      type="button"
    >
      <Icon size={20} className="shrink-0" />
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {badge ? (
        collapsed ? (
          <span
            aria-label={`${badge} pending`}
            className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-[#f0a000]"
          />
        ) : (
          <span
            aria-label={`${badge} pending ${label} tasks`}
            className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#f0a000] px-1 text-[9.5px] font-semibold text-[#0f0f0f]"
          >
            {badge}
          </span>
        )
      ) : null}
    </button>
  )
}

function ThreadRow({
  thread,
  matters,
  isActive,
  onSelect,
}: {
  thread: ChatThread
  matters: Matter[]
  isActive: boolean
  onSelect: () => void
}) {
  const queryClient = useQueryClient()
  const { current, startNewChat } = useWorkspaceNavigation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isMoving, setIsMoving] = useState(false)
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
      queryClient.setQueriesData<ChatThread[]>({ queryKey: ['threads'] }, (old) =>
        old?.map((t) => (t.id === updated.id ? updated : t)),
      )
      setIsRenaming(false)
    },
    onError: () => setDraftTitle(thread.title),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteChatThread(thread.id),
    onSuccess: () => {
      queryClient.setQueriesData<ChatThread[]>({ queryKey: ['threads'] }, (old) =>
        old?.filter((t) => t.id !== thread.id),
      )
      queryClient.removeQueries({ queryKey: ['messages', thread.id] })
      // If the deleted thread was the active one, drop the user to a new chat
      if (current.view === 'chat' && current.threadId === thread.id) {
        startNewChat({ replace: true })
      }
    },
  })

  const moveMutation = useMutation({
    mutationFn: (matterId: string | null) => moveChatThread(thread.id, matterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] })
      setIsMoving(false)
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
            <span className="min-w-0 flex-1 truncate text-[12px] font-normal">{thread.title}</span>
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

      {isMoving && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-white/10 bg-[#1a1a1a] p-2 shadow-xl">
          <MatterSelect
            tone="dark"
            label={`Move "${thread.title}" to matter`}
            matters={matters}
            value={thread.matterId}
            onChange={(id) => moveMutation.mutate(id)}
          />
          <button
            className="mt-1.5 text-[11px] text-white/50 hover:text-white"
            onClick={() => setIsMoving(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
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
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-white/80 hover:bg-white/[0.08] hover:text-white"
            onClick={() => {
              setMenuOpen(false)
              setIsMoving(true)
            }}
            type="button"
          >
            <FolderInput size={12} />
            Move to matter…
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
