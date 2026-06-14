# Plan: Rename KB `action` → `skill`

## Why

The third KB category was originally called `action` to mean *"soft-skill / wellness guides"*. In practice the content this slot needs to hold is broader and more agent-facing:

- **Hard skills** — how to perform a specific legal task (drafting a survival clause, reviewing an indemnity cap, doing a due-diligence checklist).
- **Soft skills** — how to manage a workload conversation with a supervising partner, how to receive feedback, etc.

These are **reusable instructions** that can be loaded into the agent's context to make it act more like a senior. Calling them "actions" is misleading because the project also has the Workboard (kanban tickets). One word, two meanings → confusion.

Renaming to `skill` gives us:
- A clean noun the agent can describe (*"I'll apply the negotiation-skill before answering"*)
- Separation from the Workboard
- A future-proof name as the slot grows beyond the initial wellness-advice content

## What changes

### Data model

Enum literal everywhere goes from `action` → `skill`. The taxonomy becomes:

| Type | Purpose |
|---|---|
| `knowledge_bank` | Playbooks, precedents, templates |
| `style_guide` | Writing standards, partner preferences |
| **`skill`** *(renamed from `action`)* | Reusable hard/soft skill markdown blocks the agent can load |

### Agent integration

The bigger change is that **skill entries become first-class agent context**:

- `search_knowledge_bank` already returns all three types; no change there — the agent can pull a skill when it's relevant to the question.
- Add an optional **"always-on skills"** mechanism: when an entry is tagged as `always_load`, the agent injects its full body into the system prompt at the start of every conversation. Same RBAC rules apply (firm/team/matter/private scope).
- This lets a partner say *"these three skills should always be loaded for anyone in the M&A team"* without the agent having to discover them via search.

## Backend changes

### Migration `j7e8f9a0b1c2` — `rename_kb_action_to_skill`

```python
def upgrade() -> None:
    op.execute("UPDATE kb_entries SET entry_type = 'skill' WHERE entry_type = 'action'")

def downgrade() -> None:
    op.execute("UPDATE kb_entries SET entry_type = 'action' WHERE entry_type = 'skill'")
```

Safe — touches only the literal value. No schema change since `entry_type` is `String(40)`.

### Schemas

```python
KnowledgeBankEntryType = Literal["knowledge_bank", "style_guide", "skill"]
```

### Optional always-load mechanism (Phase 2)

Add a column to `kb_entries`:

```python
always_load: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
```

In `prepare_agent_context`, after loading memories:

```python
always_skills = list(db.scalars(
    select(KnowledgeBankEntry).where(
        KnowledgeBankEntry.always_load.is_(True),
        _user_kb_scope_filter(user),                # respect RBAC
        KnowledgeBankEntry.status == "ready",
    )
))
if always_skills:
    system_content += "\n\n## Always-loaded skills\n\n"
    system_content += "\n\n---\n\n".join(
        f"### {s.title}\n{s.body_markdown}" for s in always_skills
    )
```

Migration needs to add the column with a default; existing skills are off by default.

## Frontend changes

### Files touched

- `frontend/src/types/workspace.ts` — `KnowledgeBankEntryType` literal updated.
- `frontend/src/lib/api.ts` — no logic change; type tightens automatically.
- `frontend/src/components/KnowledgeBankPanel.tsx`:
  - `entryTypes` array: rename label from "Action" to "Skill". Update the description.
  - Default `entryType` in `EntryFormDialog`: `'skill'` if it was previously `'action'` (it currently defaults to `'knowledge_bank'`, no change).
  - Pill colors / icon: keep the existing green palette but change the icon to something like `Sparkles` or `Lightbulb` to reinforce "this is what the agent learns from".
- `frontend/src/components/BirdiePanel.tsx`:
  - Examples tab pulls KB entries by type; update its filter from `action` to `skill`.

### "Always-load" UI (Phase 2, after column shipped)

- Add a toggle in the KB entry editor: *"Always load into agent context (RBAC-respecting)"*. Only visible when `entryType === 'skill'`.
- Show an icon on the entry card if always-load is on so partners can scan which skills are baseline.

## Verification

1. Migration applies cleanly; `SELECT entry_type, COUNT(*) FROM kb_entries GROUP BY entry_type` shows no `action` rows after upgrade.
2. KB list filter for "Skill" returns the entries that used to be Actions.
3. Birdie's Examples tab still surfaces the same content (filter automatically updated).
4. (Phase 2) Toggling always-load on a skill, then asking the agent something that doesn't reference it, the agent demonstrates having read it (e.g., applies a style preference without being asked).

## Out of scope

- Wholesale rework of skill content. We're renaming the slot, not curating what goes in it.
- A separate skill marketplace / sharing layer.
- Agent's ability to *write* new skills back to the KB (would need a careful approval workflow).
