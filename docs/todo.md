# TODO

## Frontend State Management

- [x] Replace `activeThreadId` magic string navigation with a Zustand store using a discriminated union view type.
  - Current `activeThreadId` doubles as both a thread ID and a panel selector (`'wiki'`, `'documents'`, `'memories'`), causing bugs like New Chat snapping back to the previous thread.
  - Define a view union: `{ view: 'chat', threadId: string | null } | { view: 'wiki', pageId: string | null } | { view: 'documents' } | { view: 'memories' }`.
  - Navigation functions (`startNewChat`, `selectWiki`, etc.) become store actions; components read the current view directly rather than receiving it via prop drilling.

- [x] Migrate server state to TanStack Query.
  - Threads, messages, documents, and wiki pages are currently fetched manually with scattered `loadX` functions and no shared cache.
  - Replace with `useQuery` / `useMutation` hooks so components fetch their own data; use `queryClient.invalidateQueries` for post-mutation refresh instead of explicit `refreshThreads` calls.
  - Eliminates the manual guard checks in `handleSubmit` for `'wiki'` / `'documents'` thread IDs and removes the double-load pattern in `WikiPanel`.

## Chat Context

- [x] Add thread summarization for long-running chats.
  - Current behavior sends only recent thread messages to the LLM prompt.
  - Store a rolling summary per chat thread so the assistant can preserve older context after days or long conversations.
  - Refresh the summary after new assistant responses, then include it alongside recent messages, long-term memory, and document search context.
  - Keep summaries scoped to the authenticated user and the specific thread.
