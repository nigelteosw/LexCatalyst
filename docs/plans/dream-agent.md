# Plan: Dream agent — memory consolidation

## Why

Personal memories are the agent's long-term context about a user — their working style, their supervising partner's preferences, the matters they're working on. Today they're entered manually: you type a note, it sits there forever. Over time the memory bank gets:

- **Duplicated** — "I work in M&A" and "I'm an M&A trainee" added six months apart.
- **Contradictory** — "James Whitmore is my supervisor" + "Sarah Chen is my supervisor" because of a rotation the user forgot to update.
- **Stale** — memories about a matter that closed last quarter still firing into every prompt.
- **Incomplete** — the user's chat history reveals patterns the agent would benefit from knowing (*"I always ask for worked examples"*) that were never written down.

The whiteboard captured this: *"User Memory — Style guide, Instructions, Editable to individual / admin team?"* It's currently editable, not curated.

The fix is an explicit **Dream** action: a button the user presses when they want the system to take a pass over recent activity and propose updates. Like REM sleep — consolidate, dedupe, surface patterns.

## What we're building

### UI

A "Dream" button **immediately left of** the "+ Add memory" button in the Memories panel.

Clicking it:
1. Spinner + status text ("Reviewing your recent conversations…").
2. After 5–15 seconds, opens a review modal showing a **diff** — proposed memory changes:
   - **Add** — new memories drawn from chat patterns. Each with the category (semantic/procedural/episodic), the text, and a short *"because…"* explanation citing the conversation it came from.
   - **Merge** — two or more existing memories the agent thinks are duplicates, with a proposed merged text.
   - **Update** — an existing memory with a proposed revision (e.g., "supervising partner: James → Sarah").
   - **Drop** — memories the agent thinks are stale or contradicted by newer activity.
3. The user can accept/reject each item individually before committing.

### Dream agent prompt

Separate system prompt, lives in `app/services/dream_service.py`. Skeleton:

```
You are a memory consolidation agent. You review a user's recent chat
history and their existing memory bank, then propose a minimal set of
changes that make the memory bank more accurate and useful, without
deleting anything the user clearly still relies on.

Rules:
- Be conservative. Default to keeping existing memories. Only delete
  when there is clear evidence in the chat history that the fact has
  changed (e.g. user states a new supervising partner).
- Group near-identical memories into a single merged version.
- New memories must be specific and durable. "Asked about clause 7" is
  too episodic; "prefers worked examples in answers" is durable.
- Never propose memories that are sensitive personal information unless
  the user has already stored similar themselves.
- Return JSON only — no commentary.

Output shape:
{
  "additions": [{"category": "semantic|procedural|episodic", "content": "...", "reason": "..."}],
  "merges":    [{"replace_ids": ["..."], "content": "...", "reason": "..."}],
  "updates":   [{"memory_id": "...", "content": "...", "reason": "..."}],
  "drops":     [{"memory_id": "...", "reason": "..."}]
}
```

### Inputs to the agent

- The user's existing memories (id + category + content).
- The last N chat messages across all their threads (N ≈ 50; capped to keep cost predictable).
- The current date so the agent can reason about staleness.

### Model

`deepseek-v4-pro`. Consolidation is a thoughtful, structured task — flash isn't deep enough to spot contradictions reliably.

## Backend changes

### New service: `app/services/dream_service.py`

```python
async def dream_consolidate(
    db: Session, *, user: User,
) -> DreamProposal:
    memories = list_memories(db, user_id=user.id)
    recent_messages = _load_recent_messages(db, user_id=user.id, limit=50)

    prompt = _build_dream_prompt(memories=memories, messages=recent_messages)
    raw_response, _ = await DeepSeekProvider().chat(prompt, model="deepseek-v4-pro")
    return _parse_dream_proposal(raw_response, existing_memory_ids={m.id for m in memories})


def apply_dream_proposal(
    db: Session, *, user: User, accepted: AcceptedDreamProposal,
) -> DreamApplyResult:
    """Apply only the items the user accepted, atomically.
    Validates every memory_id belongs to the calling user (RBAC).
    """
```

### Schemas

```python
class DreamAddition(BaseModel):
    category: Literal["semantic", "procedural", "episodic"]
    content: str
    reason: str

class DreamMerge(BaseModel):
    replace_ids: list[str]
    content: str
    reason: str

class DreamUpdate(BaseModel):
    memory_id: str
    content: str
    reason: str

class DreamDrop(BaseModel):
    memory_id: str
    reason: str

class DreamProposal(BaseModel):
    additions: list[DreamAddition]
    merges:    list[DreamMerge]
    updates:   list[DreamUpdate]
    drops:     list[DreamDrop]
    # Echo back what the agent saw so the UI can show context.
    reviewed_message_count: int

class AcceptedDreamProposal(BaseModel):
    # The frontend sends back only the items the user kept (subset of the
    # IDs/indexes returned in the proposal).
    additions: list[DreamAddition]
    merges:    list[DreamMerge]
    updates:   list[DreamUpdate]
    drops:     list[DreamDrop]
```

### Routes

`POST /memories/dream` (auth required) → returns `DreamProposal`. No DB writes.

`POST /memories/dream/apply` (auth required, body = `AcceptedDreamProposal`) → applies the accepted subset in a single transaction. Returns the updated memory list so the frontend can replace cached state.

Both routes verify every referenced `memory_id` belongs to the calling user — no cross-user mischief even if the LLM hallucinates an ID.

### Token cost guardrails

- Cap recent-messages payload at 50 messages or ~30KB, whichever is smaller.
- If the memory bank is already empty AND chat history is empty, return an empty proposal without calling DeepSeek.
- Per-user rate limit: at most one dream every 5 minutes. Stored in-memory for now (a simple `dict[user_id, datetime]`); rejected calls return 429 with a friendly message.

## Frontend changes

### Files touched

- `frontend/src/lib/api.ts` — `dreamMemories()`, `applyDream(accepted)`.
- `frontend/src/types/workspace.ts` — DreamProposal types mirror the backend.
- `frontend/src/components/MemoriesPanel.tsx`:
  - Add Dream button next to + Add memory. Icon: `Moon` from lucide. Tooltip: "Review and refine your memories based on recent activity".
  - On click, fire `dreamMemories()`. While pending, show a banner: "Dreaming…" with a moon icon and a moving gradient.
  - On success, open `DreamReviewDialog` with the proposal.
  - On error, show a toast.
- New `frontend/src/components/DreamReviewDialog.tsx`:
  - Tabbed view: **Add (N)**, **Merge (N)**, **Update (N)**, **Drop (N)**. Each tab lists the items with a per-item checkbox.
  - Each item shows the proposal text, the reason, and (for merges/updates/drops) the existing memory text for comparison.
  - "Apply selected" button is enabled when at least one item is checked.
  - Cancel discards the proposal.

### Empty/edge states

- "Nothing to consolidate" — when the proposal is empty across all four buckets, show a friendly "Your memory is already tidy" panel instead of an empty modal.
- "Rate limited" — if the API returns 429, show the user when they can try again.

## Verification

1. With zero memories and zero chat history, hitting Dream returns an empty proposal without calling DeepSeek.
2. With a handful of memories including two obvious duplicates and one contradicted fact, the proposal lists exactly those changes — no spurious additions.
3. Accepting a subset of the proposal applies *only* the accepted items in a single transaction. Rolling back any one item rolls them all back.
4. Trying to apply with a `memory_id` belonging to another user → 403.
5. Calling Dream twice within 5 minutes → 429.

## Out of scope

- Scheduled/automatic dreaming (nightly cron). Make it explicit and user-initiated first; automate later if the UX justifies it.
- Cross-user knowledge transfer — Dream is strictly personal.
- Adding skills/KB entries from chat. Different consolidation problem; different agent.
