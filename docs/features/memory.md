# Personal Memory — What the Agent Knows About You

> A user's private store of facts, preferences, and reminders that the agent loads into every conversation, so the user doesn't repeat themselves every time.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**User Memory brief**:
- "Style guide"
- "Instructions"
- "Editable to individual / admin team?"
- "Settings / profile page"

**Chat function**:
- "Confidential to user"

**Prompts brief**:
- "Tone → tailor to firm(?)"

Every lawyer has habits the AI should respect:
- *"I always use English law unless told otherwise."*
- *"My supervising partner is James Whitmore — he prefers 5-year survival on NDAs."*
- *"I'm a trainee in the M&A team."*

If the lawyer has to restate these every chat, the system is useless. ChatGPT-style "you have to tell me again" friction is the death of an in-firm AI product.

## What we built

A `memories` table scoped to each user, organised into three categories:

| Category | What goes in it |
|---|---|
| `semantic` | Stable facts. "I work in M&A at Ashworth & Cole. My supervising partner is James Whitmore." |
| `procedural` | Working style preferences. "I prefer concise answers with clause-level specificity." |
| `episodic` | Past events / context. "Reviewing Meridian NDA v2 this week — flagged the survival clause." |

Memories are loaded by `prepare_agent_context` and injected into the agent's system prompt *before* every conversation starts:

```
User Context (Long-term Memory):
Stable facts/preferences:
- I work in M&A at Ashworth & Cole, year 1 trainee.
- Supervising partner: James Whitmore.

Working style:
- Prefer concise answers with clause-level specificity.
- Always ask for worked examples.
```

The agent then has the context it needs without the user re-stating anything.

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **Three categories, not free-form** | Lawyers think hierarchically. Separating "this is who I am" from "this is how I like to work" from "this is what I'm doing right now" helps the user organise their own memory. It also lets the prompt structure surface the relevant slice first. |
| **Injected, not searched** | Memories are small (a few sentences each) and always relevant. We pre-load them into the system prompt rather than making the agent do a search-tool call for them. Faster, cheaper, more reliable. |
| **User-owned, not firm-owned** | The `memories` table has a `user_id`. The product-requirement note "Editable to individual / admin team?" left this open, but we landed on: **memories are private**. A partner can't read a junior's memories. The "instructions to my AI" should be no more invasive than "notes in my personal notebook". |
| **No partner override** | Lawyers want to know that what they write about a partner ("hates being interrupted") isn't surfaceable in any other context. We do not surface memory contents in any aggregate, search, or audit view. |
| **No automatic memory extraction (yet)** | We have a `memory_service.extract_memory_candidates` stub but it's not wired into routes. Auto-creating memories from chat history is powerful but unpredictable — needs careful UX. For now the user adds memories explicitly. |

## How it works

```
[User opens Memories panel]
        │
        ▼
GET /memories                  → list user's memories grouped by category
        │
[User adds a memory]
        │
        ▼
POST /memories
        { category, content, source_thread_id?, source_message_id? }
        │
        ▼
[Stored in memories table — user_id from auth]

────────────────────────────────────────────────

[User asks a question in chat]
        │
        ▼
prepare_agent_context
        │
        ├── load history
        │
        ├── list_memories(db, user_id=user.id)
        │     │
        │     └── group by category, format as bullets
        │
        ├── inject into system prompt
        │
        └── return messages to agent loop
```

## Roles & permissions

| Action | Required |
|---|---|
| List own memories | Owner |
| Create memory | Owner |
| Update memory | Owner |
| Delete memory | Owner |

Other users — including partners and admins — cannot view, edit, or delete another user's memories. The route checks `user_id` against `current_user.id` on every operation.

## What this is NOT

- **It's not RAG over chat history.** We don't auto-embed every past message and search them. Memories are explicit, structured, user-curated facts.
- **It's not a firm-wide style guide.** That's what the Knowledge Bank `style_guide` entries are for. The KB's style guide is the firm's official position; user memory is one user's instructions to their AI.
- **It's not visible to Birdie's reasoning context yet.** Birdie is stateless and doesn't currently pull personal memories. We may add this — when a junior asks Birdie for advice on raising a workload concern with James Whitmore, knowing James is the supervisor would help.

## Limitations

- No automatic memory extraction from chat. The user must add memories manually.
- Memory content is plaintext in the DB. A user who leaks their JWT exposes their memories.
- No "memory budget" — a user with 500 memories will produce an enormous system prompt and slow chat. We should cap memory injection at ~50 entries.
- No "stale memory" eviction — a memory from year 1 about a partner the user no longer works with stays forever unless deleted.

## Where it lives in the code

| Concern | Path |
|---|---|
| Service | `backend/app/services/memory_service.py` |
| Routes | `backend/app/main.py` → `/memories/*` |
| Model | `backend/app/models.py` → `Memory` |
| Frontend panel | `frontend/src/components/MemoriesPanel.tsx` |
| Context injection | `backend/app/services/chat_service.py` → `prepare_agent_context` |
