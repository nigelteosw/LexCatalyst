import { useCallback, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type HomeView = { view: 'home' }
type ChatView = { view: 'chat'; threadId: string | null }
type WikiView = { view: 'wiki'; pageId: string | null }
type DocumentsView = { view: 'documents'; documentId: string | null }
type MemoriesView = { view: 'memories' }
type WellbeingView = { view: 'wellbeing' }
type KnowledgeBankView = { view: 'knowledge_bank'; entryId: string | null }
type ActionsView = { view: 'actions'; actionId: string | null }
type HandoffReviewView = { view: 'handoff_review'; actionId: string }
type SettingsView = { view: 'settings' }
type MattersView = { view: 'matters' }
type MatterView = { view: 'matter'; matterId: string }

export type AppView =
  | HomeView
  | ChatView
  | WikiView
  | DocumentsView
  | MemoriesView
  | WellbeingView
  | KnowledgeBankView
  | ActionsView
  | HandoffReviewView
  | SettingsView
  | MattersView
  | MatterView

type NavigationOptions = {
  replace?: boolean
}

function decodeSegment(value: string | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseWorkspacePath(pathname: string): { current: AppView; isKnownRoute: boolean } {
  const segments = pathname.split('/').filter(Boolean)
  const [section, rawId] = segments
  const id = decodeSegment(rawId)
  if (section === 'knowledge' && rawId === 'documents' && segments.length <= 3) {
    return {
      current: { view: 'documents', documentId: decodeSegment(segments[2]) },
      isKnownRoute: true,
    }
  }
  if (section === 'knowledge' && rawId === 'matters' && segments.length <= 3) {
    const matterId = decodeSegment(segments[2])
    return {
      current: matterId ? { view: 'matter', matterId } : { view: 'matters' },
      isKnownRoute: true,
    }
  }
  if (segments.length > 2) {
    // Only allowed 3-segment path: /actions/[id]/review
    if (section === 'actions' && rawId && segments[2] === 'review') {
      return {
        current: { view: 'handoff_review', actionId: id! },
        isKnownRoute: true,
      }
    }
    return { current: { view: 'home' }, isKnownRoute: false }
  }

  if (!section || section === 'home') {
    return { current: { view: 'home' }, isKnownRoute: true }
  }
  if (section === 'chat') {
    return { current: { view: 'chat', threadId: id }, isKnownRoute: segments.length <= 2 }
  }
  if (section === 'documents') {
    return { current: { view: 'documents', documentId: id }, isKnownRoute: true }
  }
  if (section === 'memories' && !id) {
    return { current: { view: 'memories' }, isKnownRoute: true }
  }
  if (section === 'wellbeing' && !id) {
    return { current: { view: 'wellbeing' }, isKnownRoute: true }
  }
  if (section === 'knowledge') {
    return { current: { view: 'knowledge_bank', entryId: id }, isKnownRoute: true }
  }
  if (section === 'actions') {
    return { current: { view: 'actions', actionId: id }, isKnownRoute: true }
  }
  if (section === 'settings' && !id) {
    return { current: { view: 'settings' }, isKnownRoute: true }
  }
  if (section === 'wiki') {
    return { current: { view: 'wiki', pageId: id }, isKnownRoute: true }
  }
  return { current: { view: 'home' }, isKnownRoute: false }
}

function routeWithId(base: string, id?: string | null) {
  return id ? `${base}/${encodeURIComponent(id)}` : base
}

export function useWorkspaceNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const { current, isKnownRoute } = useMemo(
    () => parseWorkspacePath(location.pathname),
    [location.pathname],
  )

  // Documents moved under Knowledge Bank; keep old /documents links working.
  useEffect(() => {
    if (location.pathname === '/documents' || location.pathname.startsWith('/documents/')) {
      navigate(`/knowledge${location.pathname}`, { replace: true })
    }
  }, [location.pathname, navigate])

  const go = useCallback(
    (path: string, options?: NavigationOptions) => navigate(path, { replace: options?.replace }),
    [navigate],
  )

  return {
    current,
    isKnownRoute,
    selectHome: useCallback(
      (options?: NavigationOptions) => go('/home', options),
      [go],
    ),
    startNewChat: useCallback(
      (options?: NavigationOptions) => go('/chat', options),
      [go],
    ),
    selectThread: useCallback(
      (threadId: string, options?: NavigationOptions) =>
        go(routeWithId('/chat', threadId), options),
      [go],
    ),
    selectWiki: useCallback(
      (pageId?: string | null, options?: NavigationOptions) =>
        go(routeWithId('/wiki', pageId), options),
      [go],
    ),
    selectDocuments: useCallback(
      (documentId?: string | null, options?: NavigationOptions) =>
        go(routeWithId('/knowledge/documents', documentId), options),
      [go],
    ),
    selectMatters: useCallback(
      (options?: NavigationOptions) => go('/knowledge/matters', options),
      [go],
    ),
    selectMatter: useCallback(
      (matterId: string, options?: NavigationOptions) =>
        go(`/knowledge/matters/${encodeURIComponent(matterId)}`, options),
      [go],
    ),
    selectMemories: useCallback(
      (options?: NavigationOptions) => go('/memories', options),
      [go],
    ),
    selectWellbeing: useCallback(
      (options?: NavigationOptions) => go('/wellbeing', options),
      [go],
    ),
    selectKnowledgeBank: useCallback(
      (entryId?: string | null, options?: NavigationOptions) =>
        go(routeWithId('/knowledge', entryId), options),
      [go],
    ),
    selectActions: useCallback(
      (actionId?: string | null, options?: NavigationOptions) =>
        go(routeWithId('/actions', actionId), options),
      [go],
    ),
    selectHandoffReview: useCallback(
      (actionId: string, options?: NavigationOptions) =>
        go(`/actions/${encodeURIComponent(actionId)}/review`, options),
      [go],
    ),
    selectSettings: useCallback(
      (options?: NavigationOptions) => go('/settings', options),
      [go],
    ),
  }
}
