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
| **Always uses `deepseek-v4-flash`** | A mentor needs to feel conversational, not like submitting a brief and waiting. Flash is fast enough to be casual. |
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
        │
        ▼
[birdie_service.stream_birdie_response]
        │
        ├── search_kb_for_chat (RBAC-filtered KB pull)
        │
        ├── Build messages: BIRDIE_SYSTEM + KB context + history + question
        │
        └── DeepSeekProvider.stream_chat (Flash)
                │
                ▼
        Stream tokens back as SSE → frontend renders into chat
```

**Statelessness**: Birdie has no DB persistence. The client manages the conversation history. This is deliberate — partners shouldn't be able to ask "what has this junior been asking the mentor?", or psychological safety is gone.

## Limitations

- **No long-term memory** within Birdie itself (by design — see above). If the user wants something remembered, they save it to their personal Memory.
- Mentor advice is grounded in firm KB but the LLM still hallucinates legal positions. Birdie is a **mentor**, not authority — every concrete legal claim should be verified against a real source.
- The "Progress" tab is currently illustrative; we don't yet track which skills the user has actually demonstrated.

## Where it lives in the code

| Concern | Path |
|---|---|
| Backend service | `backend/app/services/birdie_service.py` |
| Backend route | `backend/app/main.py` → `/birdie/stream` |
| Frontend widget | `frontend/src/components/BirdiePanel.tsx` |
| API client | `frontend/src/lib/api.ts` → `streamBirdieMessage` |
| Open/close state | `frontend/src/App.tsx` → `isBirdieOpen` |
