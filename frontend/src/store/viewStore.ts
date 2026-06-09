import { create } from 'zustand'

type ChatView = { view: 'chat'; threadId: string | null }
type WikiView = { view: 'wiki'; pageId: string | null }
type DocumentsView = { view: 'documents' }
type MemoriesView = { view: 'memories' }

export type AppView = ChatView | WikiView | DocumentsView | MemoriesView

type ViewState = {
  current: AppView
  startNewChat: () => void
  selectThread: (threadId: string) => void
  selectWiki: (pageId?: string | null) => void
  selectDocuments: () => void
  selectMemories: () => void
  setWikiPageId: (pageId: string | null) => void
}

export const useViewStore = create<ViewState>((set, get) => ({
  current: { view: 'chat', threadId: null },

  startNewChat: () => set({ current: { view: 'chat', threadId: null } }),

  selectThread: (threadId) => set({ current: { view: 'chat', threadId } }),

  selectWiki: (pageId) => {
    const { current } = get()
    const existingPageId = current.view === 'wiki' ? current.pageId : null
    set({ current: { view: 'wiki', pageId: pageId !== undefined ? pageId : existingPageId } })
  },

  selectDocuments: () => set({ current: { view: 'documents' } }),

  selectMemories: () => set({ current: { view: 'memories' } }),

  setWikiPageId: (pageId) =>
    set((state) =>
      state.current.view === 'wiki' ? { current: { ...state.current, pageId } } : state,
    ),
}))
