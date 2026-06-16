# Birdie — The Always-On Mentor

> A pop-up AI mentor a junior can ask anything, without being judged or logged in front of their supervisor.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**Juniors**:
- "Lack of mentorship"
- "Scared to ask stupid Qns"
- "Lack of psychological safety"

**Seniors**:
- "No time for mentorship / bad at it"
- "Not confident in knowledge"
- "No incentive for Mentorship"

In a typical firm, a trainee's primary learning channel is asking their supervising partner. But partners are billable-hour-constrained, often inconsistent in feedback quality, and being asked the same question twice can damage a junior's career. The junior either guesses, asks a peer (also unsure), or stays quiet and ships work that the partner has to redraft — wasting both their time.

Junior lawyers want to ask:
- "Is this clause market-standard?"
- "How do I push back on this without sounding green?"
- "How do I raise that I'm overworked without it counting against me?"

A human mentor relationship that handles *all three* of those questions, equally available at midnight on a Sunday, does not exist.

## What we built

Birdie is a **floating picture-in-picture widget** (320×480) you can drag anywhere on the screen. Open it via the "Birdie" pill in the chat header.

Four tabs:

| Tab | What it does |
|---|---|
| **Ask** | Live streaming chat with the mentor. The agent's system prompt covers legal hard skills (clause drafting, partner prefs) *and* soft skills (workload, feedback, raising concerns) equally. |
| **Review** | Cards summarising what Birdie has spotted in the current matter or draft. |
| **Examples** | Pulls relevant style guides and playbooks from the firm's Knowledge Bank, filtered to what the user has access to. |
| **Progress** | A skills map showing what the junior has been learning. |

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **Separate from the main chat** | The main `/chat/stream` agent is for "do my work" tasks. Birdie is for "help me think". Conflating them produces an assistant that's either too task-focused for mentoring or too chatty for legal work. They run on **separate endpoints with distinct system prompts**. |
| **Uses `deepseek-v4-pro`** | The mentor now synthesises page context, personal memory, and KB knowledge in a single response. Pro's reasoning depth is necessary; Flash is too shallow for contextual synthesis. The 3–5 sentence brevity rule keeps response time acceptable. |
| **Floating PiP, not a sidebar** | Juniors keep Birdie open while drafting a clause or reading a doc. A docked sidebar would compete with the matter view; a floating window stays out of the way and can be dragged off-screen. |
| **Brief by default** | The system prompt enforces 3–5 sentences. Lawyers waste enough time reading. The mentor only goes deeper when asked. |
| **Mentor persona, not assistant** | The prompt explicitly tells Birdie to be a *person who has been through this*, not a research engine. When a junior says "I'm scared to push back", a research-engine response is wrong. |
| **RBAC-aware** | Birdie searches the same Knowledge Bank as the main agent, with the same scope filters. A junior can't accidentally surface a firm-wide partner preference they shouldn't see. |

## How it works

```
[User opens Birdie] ──► fixed-position div, drag handle on header
        │
        ▼
[User types question] ──► POST /birdie/stream
        { message, history, matter_id, page_context }
        │
        ▼
[birdie_service.stream_birdie_response]
        │
        ├── list_memories (user's personal memory, pre-loaded)
        │
        ├── search_kb_for_chat (RBAC-filtered KB pull)
        │
        ├── format_page_context (natural-language summary of what the user is looking at)
        │
        ├── Build messages:
        │     BIRDIE_SYSTEM + memories + page context + KB context + history + question
        │
        └── DeepSeekProvider.stream_chat (Pro)
                │
                ▼
        Stream tokens back as SSE → frontend renders into chat
```

**`page_context`** is a small struct the frontend builds from the current React route and any selected item (thread title, document name, wiki page, KB entry, action). The backend converts it to a readable paragraph: *"The user is on the Documents page, reading 'Meridian NDA v2.pdf'. Active matter: Meridian Capital."*

**Statelessness**: Birdie has no DB persistence. The client manages the conversation history. This is deliberate — partners shouldn't be able to ask "what has this junior been asking the mentor?", or psychological safety is gone.

## Limitations

- **No long-term memory** within Birdie itself (by design — see above). If the user wants something remembered, they save it to their personal Memory. Birdie *reads* personal memories but does not write them.
- Mentor advice is grounded in firm KB but the LLM still hallucinates legal positions. Birdie is a **mentor**, not authority — every concrete legal claim should be verified against a real source.
- The "Progress" tab is currently illustrative; we don't yet track which skills the user has actually demonstrated.
- Page context is client-supplied and not validated beyond type-checking. A malicious client could send a misleading context string — this is acceptable given Birdie is a mentor assistant, not a security boundary.

## Where it lives in the code

| Concern | Path |
|---|---|
| Backend service | `backend/app/services/birdie_service.py` |
| Backend route | `backend/app/main.py` → `/birdie/stream` |
| Frontend widget | `frontend/src/components/BirdiePanel.tsx` |
| API client | `frontend/src/lib/api.ts` → `streamBirdieMessage` |
| Open/close state | `frontend/src/App.tsx` → `isBirdieOpen` |

## Related RFC

See [`rfc-birdie-context.md`](../rfc-birdie-context.md) for the engineering design of the page context, memory injection, and model upgrade.
