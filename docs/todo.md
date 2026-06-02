# TODO

## Chat Context

- [ ] Add thread summarization for long-running chats.
  - Current behavior sends only recent thread messages to the LLM prompt.
  - Store a rolling summary per chat thread so the assistant can preserve older context after days or long conversations.
  - Refresh the summary after new assistant responses, then include it alongside recent messages, long-term memory, and document search context.
  - Keep summaries scoped to the authenticated user and the specific thread.
