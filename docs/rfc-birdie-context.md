# RFC: Birdie — Context-Aware Mentor Agent

Status: Proposed  
Date: 2026-06-16  
Owner: LexCatalyst product/backend

---

## 1. Problem Statement

Birdie currently knows two things about the user: their JWT identity (for RBAC-filtered KB search) and, optionally, the active `matter_id`. It does not know:

- **Which page the user is on** — whether they're drafting in a chat thread, reading a document, browsing the KB, or reviewing a wellbeing survey
- **What they are looking at** — the title of the open thread, document, wiki page, KB entry, or action
- **Anything the user has told the system about themselves** — Birdie ignores the personal Memory store entirely, even though the main chat agent pre-loads it

The result: Birdie gives generic mentor responses even when it could give specific, grounded ones. "How do I push back on this clause?" is a much more useful question when Birdie knows the user is currently reading a Meridian NDA in the Documents panel.

The model compounds the problem. `deepseek-v4-flash` was chosen for conversational speed, but a mentor that is supposed to synthesise page context, personal history, and firm knowledge needs reasoning depth. Flash is too thin.

---

## 2. Proposed Changes

### 2.1 Page Context

The frontend passes a `page_context` object on every POST to `/birdie/stream`. The backend injects a natural-language "current context" block into the Birdie system prompt before the KB retrieval context.

**Frontend payload addition:**

```typescript
type BirdiePageContext = {
  view: AppView['view']          // 'chat' | 'documents' | 'wiki' | 'knowledge_bank' | 'actions' | 'home' | 'memories' | 'wellbeing' | 'settings'
  threadTitle?: string | null    // chat view: the thread title
  documentName?: string | null   // documents view: the open document filename
  wikiPageTitle?: string | null  // wiki view: the page title
  kbEntryTitle?: string | null   // knowledge_bank view: the selected entry title
  actionTitle?: string | null    // actions view: the selected action title
}
```

**Backend system prompt injection (rendered from page_context):**

```
Current context (what the user is working on right now):
The user is on the Documents page, reading "Meridian NDA v2.pdf".
Active matter: Meridian Capital (M&A · matter-abc123)
```

or:

```
Current context (what the user is working on right now):
The user is on the Chat page, in thread "NDA survival clause — Oaktree".
```

or for generic views:

```
Current context (what the user is working on right now):
The user is on the Wellbeing page.
```

Birdie uses this to tailor its response — if the user is on the Actions page reviewing a redline, a question like "how do I flag this?" means something specific.

### 2.2 Personal Memory Injection

Birdie will pre-load the user's memories into the system prompt, exactly as `prepare_agent_context` does for the main chat agent. The memory injection goes between the system persona and the page context block.

```
User Context (Long-term Memory):
Stable facts/preferences:
- I work in M&A at Ashworth & Cole, year 1 trainee.
- Supervising partner: James Whitmore.

Working style:
- Prefer concise answers.

Current context (what the user is working on right now):
...
```

This is especially high-value for soft-skills questions: "How do I tell James I can't take on this matter?" — Birdie now knows James is the supervising partner.

### 2.3 Model Upgrade: Flash → Pro

Replace `deepseek-v4-flash` with `deepseek-v4-pro`.

Justification: the mentor's value proposition is now contextual synthesis — connecting page context, personal history, KB knowledge, and the user's question. Flash is tuned for speed over depth. Pro is the right model for reasoning across multiple context layers. The conversational latency increase is acceptable for a 3–5 sentence response that is actually useful.

---

## 3. What Does NOT Change

- **No DB persistence** — psychological safety guarantee is preserved. Partners cannot surface what a junior asked Birdie.
- **Client-managed history** — the frontend still owns the conversation buffer.
- **RBAC on KB search** — Birdie still searches the KB with the user's role filters.
- **Widget UX** — the floating PiP, tab structure, and interaction model are unchanged.
- **Brevity rule** — 3–5 sentences unless the user asks to go deeper.

---

## 4. API Shape

### 4.1 Updated POST `/birdie/stream`

**Request body (additions in bold):**

```json
{
  "message": "How do I push back on this clause?",
  "history": [...],
  "matter_id": "matter-abc123",
  "page_context": {
    "view": "documents",
    "document_name": "Meridian NDA v2.pdf"
  }
}
```

All `page_context` fields are optional. Missing fields are ignored — if the user is on a view with no selected item, `view` alone is sufficient.

**Response:** unchanged — SSE `token` / `done` / `error` events.

---

## 5. System Prompt Structure (updated)

```
[BIRDIE PERSONA — unchanged]

[USER MEMORY — if any memories exist]
User Context (Long-term Memory):
Stable facts/preferences:
  - ...
Working style:
  - ...
Recent context:
  - ...

[PAGE CONTEXT — always present]
Current context (what the user is working on right now):
  The user is on the Documents page, reading "Meridian NDA v2.pdf".
  Active matter: Meridian Capital (M&A · matter-abc123)

[FIRM KNOWLEDGE — if KB search returns results]
---
Firm knowledge relevant to this question:
  ...
```

---

## 6. Implementation Plan

### 6.1 Backend

**`app/routers/birdie.py`**
- Add `PageContext` Pydantic model: `view`, `thread_title`, `document_name`, `wiki_page_title`, `kb_entry_title`, `action_title` — all optional strings
- Add `page_context: PageContext | None = None` field to `BirdieRequest`
- Pass through to `stream_birdie_response`

**`app/services/birdie_service.py`**
- Import `list_memories` from `memory_service` and `format_memories_for_prompt` (or write an equivalent inline formatter)
- In `build_birdie_messages`:
  1. Pull user memories: `memories = await list_memories(db, user_id=user.id)`
  2. Format memories block
  3. Build page context paragraph from `page_context` fields
  4. Assemble system content: `BIRDIE_SYSTEM_PROMPT + memories_block + page_context_block + kb_context`
- Change model arg from `"deepseek-v4-flash"` to `"deepseek-v4-pro"` in `stream_birdie_response`

### 6.2 Frontend

**`frontend/src/features/birdie/BirdiePanel.tsx`**
- Add `pageContext: BirdiePageContext` to `BirdiePanelProps`
- Pass through to `AskTab`
- In `AskTab.send()`, pass `pageContext` to `streamBirdieMessage`

**`frontend/src/app/App.tsx`**
- Build `birdiePageContext` from `current` (the `AppView` object already in scope) and any per-view details (thread title from `activeThread?.title`, etc.)
- Pass as `pageContext` prop to `BirdiePanel`

**`frontend/src/shared/api/api.ts`**
- Add `pageContext?: BirdiePageContext` to `streamBirdieMessage` params
- Include as `page_context` in the JSON body

**`frontend/src/shared/types/workspace.ts`**
- Export `BirdiePageContext` type

### 6.3 Build Order

1. `types/workspace.ts` — add `BirdiePageContext`
2. `birdie.py` router — add `PageContext` model + field to request
3. `birdie_service.py` — memory injection + page context formatting + model switch
4. `api.ts` — pass `page_context` in request body
5. `App.tsx` — build and pass `birdiePageContext`
6. `BirdiePanel.tsx` — accept and forward `pageContext`

---

## 7. Context Builder Logic

The page context paragraph is built server-side from the `PageContext` struct:

```python
def format_page_context(ctx: PageContext | None, matter_title: str | None) -> str:
    if not ctx:
        return ""
    
    view_labels = {
        "home": "the Home page",
        "chat": "the Chat page",
        "documents": "the Documents page",
        "wiki": "the Lex-Wiki",
        "knowledge_bank": "the Knowledge Bank",
        "actions": "the Workboard",
        "memories": "the Memories page",
        "wellbeing": "the Wellbeing page",
        "settings": "the Settings page",
    }
    
    location = view_labels.get(ctx.view, f"the {ctx.view} page")
    detail = (
        ctx.thread_title and f', in thread "{ctx.thread_title}"'
        or ctx.document_name and f', reading "{ctx.document_name}"'
        or ctx.wiki_page_title and f', reading the "{ctx.wiki_page_title}" page'
        or ctx.kb_entry_title and f', viewing KB entry "{ctx.kb_entry_title}"'
        or ctx.action_title and f', reviewing action "{ctx.action_title}"'
        or ""
    )
    
    lines = [f"The user is on {location}{detail}."]
    if matter_title:
        lines.append(f"Active matter: {matter_title}")
    
    return "Current context (what the user is working on right now):\n" + "\n".join(lines)
```

The `matter_title` is resolved server-side from `matter_id` if provided, so the prompt gets a human-readable name rather than a UUID.

---

## 8. Privacy Considerations

- Page context is **sent by the client** — the frontend decides what to disclose. If the user is on a page with no meaningful context (e.g. Settings), `view: "settings"` alone is sent.
- No page context is stored server-side. It lives only in the system prompt for that one inference call.
- Memory is the user's own data and is already injected into the main chat agent. Injecting it into Birdie is consistent and does not expose anything new.

---

## References

- `docs/features/birdie-mentor.md` — original Birdie feature spec (to be updated after this RFC)
- `docs/features/memory.md` — personal memory system; note on Birdie gap at bottom
- `app/services/memory_service.py` — `list_memories`
- `app/services/knowledge_bank_service.py` — `search_kb_for_chat`
- `app/services/birdie_service.py` — current implementation
