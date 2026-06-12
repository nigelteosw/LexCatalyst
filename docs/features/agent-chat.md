# Agent Chat — Matter-Aware Legal Q&A

> The main legal AI chat. A junior asks a clause question; the agent searches the firm's documents, KB, and the junior's own memory, and answers with citations.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**Chat function**:
- "Confidential to user"
- "Ask questions: work / hard skills, soft skills, advice on managing workload, stakeholder management"
- "Can search your docs / playbook"

**Senior partner pain**:
- "Lots of review of work → additional work"

A junior reviewing a clause has a real question: *is this market for an APAC PE-backed deal?* They could:
1. Ask the partner — wastes partner time, junior looks unsure.
2. Search Westlaw / firm playbooks — slow and the firm playbook is buried in a SharePoint folder.
3. Guess — partner re-drafts, junior loses learning opportunity.

Generic AI chat (ChatGPT, etc.) doesn't know the firm's positions, can't read uploaded matter docs, and produces confident-sounding but unverified legal claims.

## What we built

A streaming chat with a **ReAct agent loop** that gives the LLM five tools and lets it decide what to search:

| Tool | What it does |
|---|---|
| `search_documents` | Semantic search over the user's uploaded PDFs/DOCX (matter-scoped) |
| `search_knowledge_bank` | Search the firm KB respecting the user's role and matter access |
| `search_memories` | Pull personal context (working style, partner-specific preferences) |
| `get_kb_entry` | Read a specific KB summary in full |
| `read_document` | Pull the **full extracted text** of an uploaded document (up to 100KB) when the summary isn't detailed enough to quote |

The agent streams tokens to the user as it generates them, and **also** streams the tool calls so the user sees what the agent is doing in real time: *"searching documents... reading playbook... drafting answer"*.

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **ReAct loop, not single-shot RAG** | A junior's question often has multiple sub-parts. Single-shot RAG retrieves *once*, then guesses. ReAct lets the agent iterate: "What does the matter doc say? OK, what's the firm position? Now I can answer." |
| **Tool calls visible in UI** | Lawyers don't trust black-box answers. Seeing "searching firm KB → reading playbook → answering" makes the reasoning auditable. |
| **Citations on every claim** | The system prompt requires the agent to cite its sources. KB entries return their ID and source document. Document chunks return their citation label (filename + page + chunk). The lawyer can click through. |
| **`read_document` as escape hatch** | KB summaries are tight (350–600 words). If the agent needs to quote a specific clause verbatim, it calls `read_document` and pulls the source text. |
| **Cycle detection** | The agent will sometimes loop — searching the same query twice with no new info. We detect identical fingerprints across rounds and force a final answer. Burning client billable hours on an LLM debating itself is unacceptable. |
| **Audit log on KB reads** | Every `get_kb_entry` call is written to `kb_access_log`. If a junior reads a partner-preferences entry they shouldn't have, the firm can investigate. |

## How it works

```
[User message]
    │
    ▼
prepare_agent_context
    │   - load thread history + summary
    │   - inject user's memories into system prompt
    │   - do NOT inject KB/docs — those come via tools
    │
    ▼
run_agent_loop  ◄────────────────────┐
    │                                 │
    ├── stream_with_tools (DeepSeek)  │
    │                                 │
    ├── token? → yield to user       │
    │                                 │
    ├── tool_calls?                  │
    │      │                          │
    │      ├── cycle check (same     │
    │      │    fingerprint as       │
    │      │    previous round?)     │
    │      │                          │
    │      ├── execute tools         │
    │      │   (RBAC + audit applied)│
    │      │                          │
    │      └── feed results back ────┘
    │
    └── no tool_calls → stream final answer
```

**Max rounds = 5**. On round 6, tools are disabled entirely — the agent must answer with what it has.

## Roles & permissions

The agent inherits the calling user's RBAC. Specifically:
- `search_documents` is filtered by document ownership.
- `search_knowledge_bank` is filtered by scope + team/matter membership.
- `get_kb_entry` checks `check_kb_read` before returning the body.
- `read_document` checks document ownership.

A junior who shouldn't see a firm-wide partner-preference entry simply will not see it in the search results, and an attempt to fetch it by ID returns "access denied".

## Limitations

- The LLM still makes mistakes. Citations are honest about *what was searched*, not *whether the conclusion is right*. Always verify legal positions.
- `read_document` truncates at 100KB. For very long documents the agent gets only the start. This is a tradeoff between completeness and context-window cost.
- The agent doesn't currently write back to KB or memories — only reads. Promoting a chat finding to a KB entry is a manual user action.

## Where it lives in the code

| Concern | Path |
|---|---|
| Agent loop | `backend/app/services/agent_service.py` |
| Streaming route | `backend/app/main.py` → `/chat/stream` |
| Context builder | `backend/app/services/chat_service.py` → `prepare_agent_context` |
| Frontend chat UI | `frontend/src/components/ChatPanel.tsx` |
| Tool-step display | `frontend/src/components/ChatPanel.tsx` (per-message `steps` array) |
| Tool search functions | `app/services/rag_service.py`, `app/services/knowledge_bank_service.py`, `app/services/document_service.py` |

## Related RFC

See [`rfc-react-agent-loop.md`](../rfc-react-agent-loop.md) for the deeper engineering design including DeepSeek tool-call protocol and SSE event shapes.
