import { create } from 'zustand'

type ChatView = { view: 'chat'; threadId: string | null }
type WikiView = { view: 'wiki'; pageId: string | null }
type DocumentsView = { view: 'documents' }
type MemoriesView = { view: 'memories' }
type WellbeingView = { view: 'wellbeing' }
type KnowledgeBankView = { view: 'knowledge_bank'; entryId: string | null }

export type AppView =
  | ChatView
  | WikiView
  | DocumentsView
  | MemoriesView
  | WellbeingView
  | KnowledgeBankView

type ViewState = {
  current: AppView
  startNewChat: () => void
  selectThread: (threadId: string) => void
  selectWiki: (pageId?: string | null) => void
  selectDocuments: () => void
  selectMemories: () => void
  selectWellbeing: () => void
  selectKnowledgeBank: (entryId?: string | null) => void
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

  selectWellbeing: () => set({ current: { view: 'wellbeing' } }),

  selectKnowledgeBank: (entryId) => {
    const { current } = get()
    const existingEntryId = current.view === 'knowledge_bank' ? current.entryId : null
    set({
      current: {
        view: 'knowledge_bank',
        entryId: entryId !== undefined ? entryId : existingEntryId,
      },
    })
  },

  setWikiPageId: (pageId) =>
    set((state) =>
      state.current.view === 'wiki' ? { current: { ...state.current, pageId } } : state,
    ),
}))
