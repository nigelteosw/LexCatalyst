import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import {
  BookMarked,
  CheckSquare,
  ChevronsLeft,
  ChevronsUpDown,
  FolderInput,
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
  moveChatThread,
  renameChatThread,
} from '../../shared/api/api'
import type { ChatThread, Matter } from '../../shared/types/workspace'
import { useWorkspaceNavigation } from '../../app/routes'
import { MatterSelect } from '../../shared/ui/MatterSelect'
import { ChatsByMatter } from './ChatsByMatter'

export type SidebarProps = {
  threads: ChatThread[]
  matters: Matter[]
  selectedMatterId: string | null
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
  'flex w-full items-center gap-2 rounded-md px-[17px] py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-fill'

const sidebarNavClass =
  'text-ink-secondary hover:bg-fill-pressed hover:text-ink'

const sidebarNavActiveClass = 'bg-fill-pressed text-ink'

export function Sidebar({
  threads,
  matters,
  selectedMatterId,
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

  function prefetchWorkspace(view: 'knowledge_bank' | 'actions') {
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
    queryClient.prefetchQuery({ queryKey: ['actions'], queryFn: listActionItems })
  }

  const kbActive = current.view === 'knowledge_bank'

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 overscroll-none bg-ink/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        data-collapsed={isCollapsed}
        className={`mobile-sidebar lex-sidebar fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh flex-col overflow-hidden overscroll-none border-r border-line bg-fill text-ink transition-[transform,width] duration-200 ease-out motion-reduce:transition-none lg:relative lg:h-auto lg:max-h-none lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: `${isCollapsed ? COLLAPSED_WIDTH : width}px`, maxWidth: isDesktop ? undefined : 'calc(100vw - 2rem)', transitionDuration: isResizing ? '0ms' : undefined }}
      >
        <div className="flex h-full min-h-0 flex-col" style={{ width: isDesktop ? width : '100%' }}>
          {/* Sidebar Header */}
          <div
            className="border-b border-hairline px-[17px] pb-3 pt-[18px]"
          >
            <div
              className="flex items-center justify-between"
            >
              <button
                aria-label={isCollapsed ? 'Expand sidebar' : 'Go to home dashboard'}
                title={isCollapsed ? 'Expand sidebar' : undefined}
                className="flex items-center gap-2.5 text-ink transition-opacity hover:opacity-80"
                onClick={() => { if (isCollapsed) { toggleCollapsed() } else { selectHome(); onClose() } }}
                type="button"
              >
                <img alt="" className="h-[30px] w-[30px] rounded-md" src="/favicon.svg" />
                {(
                  <span aria-hidden={isCollapsed} className="sidebar-label t-wordmark whitespace-nowrap">
                    LexCatalyst
                  </span>
                )}
              </button>
              <div className="flex items-center">
                <button
                  onClick={toggleCollapsed}
                  aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className={`${isCollapsed ? 'invisible pointer-events-none' : ''} hidden lg:grid h-8 w-8 place-items-center rounded-md text-ink-secondary transition-colors hover:bg-fill-pressed hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                  type="button"
                >
                  <ChevronsLeft size={16} strokeWidth={1.5} />
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close sidebar"
                  className="grid h-8 w-8 place-items-center rounded-md text-ink-secondary transition-colors hover:bg-fill-pressed hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
                  type="button"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>

          <nav
            aria-label="Workspace"
            className="flex flex-col gap-[4px] border-b border-hairline px-[10px] py-[8px]"
          >
            <NavItem icon={Home} label="Home" collapsed={isCollapsed} active={current.view === 'home' || current.view === 'matter' || current.view === 'documents'}
              onClick={() => { selectHome(); closeMobile() }} />
            <NavItem icon={MessageSquare} label="LexChat" collapsed={isCollapsed} active={current.view === 'chat'}
              onClick={() => { onNewChat(); closeMobile() }} />
            <NavItem icon={BookMarked} label="Knowledge Bank" collapsed={isCollapsed} active={kbActive}
              onPrefetch={() => prefetchWorkspace('knowledge_bank')}
              onClick={() => { selectKnowledgeBank(); closeMobile() }} />
            <NavItem icon={CheckSquare} label="Workboard" collapsed={isCollapsed} active={current.view === 'actions'}
              badge={pendingTaskCount} onPrefetch={() => prefetchWorkspace('actions')}
              onClick={() => { selectActions(); closeMobile() }} />
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
            className="relative shrink-0 border-t border-hairline px-2 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
          >
            {(
              <div
                aria-hidden={!userMenuOpen}
                role="menu"
                aria-label="Account menu"
                className={`absolute bottom-full z-50 mb-1 origin-bottom overflow-hidden rounded-[10px] border border-line bg-card py-1.5 shadow-[0_16px_48px_oklch(0.2_0.01_260/0.18)] transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none ${
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
                </div>
                {menuExtra}
                <div className="mt-1 border-t border-hairline px-1.5 pt-1.5">
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
              className={`flex w-full items-center gap-2.5 rounded-md border px-[7px] py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent  ${
                userMenuOpen
                  ? 'border-line-strong bg-fill-pressed'
                  : 'border-transparent hover:bg-fill-pressed'
              }`}
              onClick={() => setUserMenuOpen((open) => !open)}
              type="button"
            >
              <div className="t-micro grid h-[32px] w-[32px] shrink-0 place-items-center rounded-full bg-accent uppercase text-white">
                {userInitials}
              </div>
              {(
                <div aria-hidden={isCollapsed} className="sidebar-label flex min-w-0 flex-1 items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="t-body-strong truncate text-ink">{userFullName}</div>
                    <div className="t-meta truncate capitalize text-ink-tertiary">{userRole}</div>
                  </div>
                  <ChevronsUpDown
                    size={14}
                    strokeWidth={1.5}
                    className={`shrink-0 text-ink-tertiary transition-transform duration-150 motion-reduce:transition-none ${
                      userMenuOpen ? 'scale-110 text-ink-secondary' : ''
                    }`}
                  />
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Resize Handle */}
        {!isCollapsed && (
          <div
            onMouseDown={startResizing}
            className={`absolute bottom-0 right-0 top-0 hidden w-1 cursor-col-resize transition-colors hover:bg-line-strong lg:block ${
              isResizing ? 'w-1.5 bg-line-strong' : 'bg-transparent'
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
      className="t-body flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-ink-secondary transition-colors hover:bg-fill hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span>{label}</span>
      {hint && <span className="t-meta text-ink-tertiary">{hint}</span>}
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
      className={`${sidebarActionClass} sidebar-nav-slot t-body-strong relative gap-3  ${active ? sidebarNavActiveClass : sidebarNavClass}`}
      type="button"
    >
      <Icon size={18} strokeWidth={1.5} className="shrink-0" />
      <span aria-hidden={collapsed} className="sidebar-label flex-1 whitespace-nowrap text-left">{label}</span>
      {badge ? (
        collapsed ? (
          <span
            aria-label={`${badge} pending`}
            className="absolute left-9 top-2 h-2 w-2 rounded-full bg-warning"
          />
        ) : (
          <span
            aria-label={`${badge} pending ${label} tasks`}
            className="t-meta inline-flex h-6 min-w-[24px] font-semibold tabular-nums items-center justify-center rounded-full bg-warning-tint px-1 text-warning"
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
      className={`group relative flex items-center rounded-md transition-colors ${
        isActive ? 'bg-fill-pressed' : 'hover:bg-fill-pressed'
      }`}
    >
      {isRenaming ? (
        <div className="flex w-full items-center gap-2 px-2 py-1.5">
          <input
            ref={inputRef}
            className="t-meta min-w-0 flex-1 rounded-md border border-line-strong bg-card px-2 py-1 text-ink outline-none focus:border-accent"
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
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left [@media(pointer:coarse)]:pr-8 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-fill ${
              isActive ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'
            }`}
            type="button"
          >
            <span className="t-meta min-w-0 flex-1 truncate">{thread.title}</span>
          </button>
          <button
            aria-label={`Options for ${thread.title}`}
            className={`absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md bg-fill-pressed text-ink-tertiary shadow-[-8px_0_8px_var(--color-fill-pressed)] transition-colors hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [@media(pointer:coarse)]:opacity-100 ${
              menuOpen ? 'text-ink' : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
            type="button"
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </button>
        </>
      )}

      {isMoving && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-[10px] border border-line bg-card p-2 shadow-[0_16px_48px_oklch(0.2_0.01_260/0.18)]">
          <MatterSelect
            tone="light"
            label={`Move "${thread.title}" to matter`}
            matters={matters}
            value={thread.matterId}
            onChange={(id) => moveMutation.mutate(id)}
          />
          <button
            className="t-meta mt-1.5 text-ink-secondary hover:text-ink"
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
          className="absolute right-1 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-[10px] border border-line bg-card py-1 shadow-[0_16px_48px_oklch(0.2_0.01_260/0.18)]"
        >
          <button
            className="t-body flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-secondary hover:bg-fill hover:text-ink"
            onClick={() => {
              setMenuOpen(false)
              setDraftTitle(thread.title)
              setIsRenaming(true)
            }}
            type="button"
          >
            <Pencil size={16} strokeWidth={1.5} />
            Rename
          </button>
          <button
            className="t-body flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-secondary hover:bg-fill hover:text-ink"
            onClick={() => {
              setMenuOpen(false)
              setIsMoving(true)
            }}
            type="button"
          >
            <FolderInput size={16} strokeWidth={1.5} />
            Move to matter…
          </button>
          <button
            className="t-body flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger-tint"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            type="button"
          >
            <Trash2 size={16} strokeWidth={1.5} />
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}
