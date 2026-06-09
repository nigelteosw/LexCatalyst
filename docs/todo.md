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

## ReAct Agent Loop

- [ ] Implement ReAct (Reasoning + Acting) loop for the LLM. See `docs/rfc-react-agent-loop.md` for the full plan.
  - Replace single-shot RAG with a tool-calling loop (max 5 rounds).
  - Tools: `search_documents`, `search_knowledge_bank`, `search_memories`, `get_kb_entry`.
  - Stream `tool_call` and `tool_result` SSE events to the frontend.
  - Show tool steps inline above the final answer in the chat UI.
  - Build order: `deepseek.py` stream_with_tools → `agent_service.py` → `chat_service.py` → `main.py` → frontend types → `api.ts` → `App.tsx` → `ChatPanel.tsx`.

## Chat Context

- [x] Add thread summarization for long-running chats.
  - Current behavior sends only recent thread messages to the LLM prompt.
  - Store a rolling summary per chat thread so the assistant can preserve older context after days or long conversations.
  - Refresh the summary after new assistant responses, then include it alongside recent messages, long-term memory, and document search context.
  - Keep summaries scoped to the authenticated user and the specific thread.

## Authentication

- [ ] Fix user authentication timeout issue.
  - Currently, users are forced to log back in if their session times out.
  - Implement a mechanism (e.g., refresh tokens or persistent sessions) to keep users logged in or handle re-authentication gracefully.

## Document Ingestion

- [ ] Improve document ingestion workflow.
  - Ensure the LLM saves two distinct items:
    1. The original document content.
    2. An LLM-summarized version containing all important points.
  - The summarized version should be the one added to the Knowledge Bank.
