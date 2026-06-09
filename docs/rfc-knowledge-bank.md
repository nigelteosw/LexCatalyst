# RFC: Knowledge Bank & RBAC Rework

Status: Implemented for hackathon mockup  
Date: 2026-06-09  
Owner: LexCatalyst product/backend  
Supersedes: `docs/rfc-llm-wiki.md`

Implementation note: the additive schema, matter-aware chat context, Knowledge Bank CRUD,
audit log, encrypted sensitive fields, promotion/redaction review flow, and v2-styled dashboard
are implemented. The target role matrix remains deliberately unenforced under §4.1 super-user
mode. Existing `/wiki/*` routes and tables remain for compatibility.

---

## 1. Problem Statement

The current Lex-Wiki is a flat, user-scoped layer of LLM-generated pages. It has no organisational hierarchy, no access control, no confidentiality boundaries, and no concept of firm vs team vs matter. The LLM's context pipeline pulls from everything the current user owns — no scoping.

Specific gaps:

- Wiki pages are per-user. No multi-user visibility, no team or firm layer.
- No concept of a matter (case). Knowledge floats free of its context.
- LLM memory has no access control. The agent can bleed knowledge across cases it should not see.
- No audit trail on knowledge reads or writes.
- No PII stripping when a clause or note is reused across matter boundaries.
- No style guide or partner preferences as first-class objects.
- Cross-team collaboration on a single matter is not supported.

This RFC replaces the Lex-Wiki with a **Knowledge Bank (KB)** — a structured, access-controlled knowledge layer with firm/team/matter hierarchy, an LLM-assisted PII redaction pipeline, a lawyer-supervised cross-boundary sharing gate, and a new dashboard shell matching the v2 design.

---

## 2. Product Narrative

Law firms are hierarchical and confidentiality-sensitive by nature. A trainee reviewing a clause in matter A should be able to draw on firm precedents and team playbooks, but must not see client names, financial details, or strategy notes from matter B — unless they are a participant on matter B.

At the same time, the firm benefits when good work product flows upward: a well-drafted clause from a closed deal should be promotable to a team-level precedent, with all client-identifying information stripped and a supervising lawyer's sign-off.

The Knowledge Bank makes this explicit:

```
Matter KB  →  (lawyer redacts + approves)  →  Team KB  →  Firm-wide KB
```

The agent only sees what the current user is permitted to see, scoped to the matter they are working in.

---

## 3. Organisational Model

```
Single Firm
├── Teams  (e.g. M&A · Disputes · IP)
│   ├── Members  →  role: partner | associate | trainee
│   └── Matters  (cases)
│       ├── Matter Members  (can span multiple teams)
│       ├── Documents
│       └── KB Entries  (scope: matter)
└── Firm-wide KB  (playbooks · precedents · style guides, scope: firm_wide)
```

A matter is owned by one primary team but can have members from other teams. The `matter_members` join table captures this with a `granted_by` field for audit. Single firm only — no multi-tenant isolation.

---

## 4. RBAC

### 4.1 Mockup: super-user mode

For the initial build all authenticated users are treated as super users — they can read and write all KB entries, matters, and documents within the single firm. Role and scope fields are persisted in the database so enforcement can be layered on later without a schema change.

### 4.2 Target role model (enforced post-mockup)

| | Firm-wide KB | Own team KB | Assigned matters | Other team matters | All firm matters |
|---|---|---|---|---|---|
| **Partner** | read / write | read / write | read / write | read | read |
| **Associate** | read / write | read / write | read / write | — | — |
| **Trainee** | read only | read / write | read / write | — | — |

Partners see down, not across. A partner in M&A can see all M&A matters and firm-wide KB, but not Disputes team-private entries unless explicitly added as a matter member.

### 4.3 KB Entry Scopes

Each KB entry carries a `scope` field. In super-user mode this is stored but not enforced. Post-mockup enforcement:

| Scope | Visible to |
|---|---|
| `firm_wide` | All authenticated users |
| `team` | Owning team members + all Partners |
| `matter` | Matter participants + Partners |
| `private` | Creator only |

Promoting an entry to a broader scope (e.g. `matter` → `team`) requires the PII gate described in §7.

### 4.4 Agent Context Scoping

The LLM context pipeline (`build_provider_messages`) gains a `UserContext` carrying team, active matter, and role. In super-user mode the RAG query pulls from all KB entries regardless of scope. Post-mockup the query enforces:

| Source | Condition to include |
|---|---|
| Firm-wide KB entries | Always (if `pii_status` is `clean` or `redacted`) |
| Team KB entries | User is a member of that team |
| Matter KB entries | User is a matter participant, OR Partner |
| Personal memories | Always |
| Matter-scoped memories | User has matter access |

**Matter selector**: selecting a matter is explicit. The chat composer gains a matter selector. Without one selected, only personal memories and firm-wide KB are in scope. This mirrors Harvey's case-number scoping model.

---

## 5. Data Model

### New tables

**`teams`**
```
id, name, practice_area, created_at
```

**`team_members`**
```
id, team_id, user_id, role (partner|associate|trainee), joined_at
```

**`matters`**
```
id, team_id (primary owning team),
title, case_number,
client_name (encrypted at rest),
status (active|closed|archived),
created_at, updated_at
```

**`matter_members`**
```
id, matter_id, user_id, role,
granted_by (user_id), granted_at
```

**`kb_entries`**  ← replaces `wiki_pages`
```
id,
team_id (nullable), matter_id (nullable),
scope (firm_wide|team|matter|private),
entry_type (see §6),
title, body_markdown, tags (text[]),
pii_status (clean|flagged|pending_review|redacted),
created_by (user_id), created_by_role (partner|associate|trainee),
version (int),
created_at, updated_at
```

**`kb_access_log`**  ← audit trail
```
id, kb_entry_id, user_id,
action (read|write|share|redact_applied),
context_matter_id (nullable),
context_thread_id (nullable),
ip_address, timestamp
```

**`pii_redactions`**  ← records what was stripped on cross-boundary shares
```
id, kb_entry_id, source_matter_id, target_scope,
redacted_fields (jsonb),
approved_by (user_id), approved_at,
original_content (encrypted),
redacted_content
```

Example `redacted_fields`:
```json
{
  "company_name": "Meridian Holdings → [Counterparty]",
  "case_number": "A-2024-1234 → [Matter Reference]",
  "consideration": "£50M → [Consideration Amount]"
}
```

### Modified tables

**`users`** — add `default_team_id`, `firm_role (partner|associate|trainee)`

**`documents`** — add `matter_id (nullable)`, `team_id (nullable)`

**`memories`** — add `scope (personal|matter|team|firm)`, `matter_id (nullable)`, `team_id (nullable)`. Memory is now matter-scoped or personal. There is no global memory.

### Dropped tables

`wiki_pages`, `wiki_page_revisions`, `wiki_page_sources`, `wiki_links` — all migrated into `kb_entries` (see §10 Migration).

---

## 6. KB Entry Types

Replaces wiki `page_type`:

| Type | Description | Default scope |
|---|---|---|
| `precedent` | Reusable clause templates | `firm_wide` |
| `playbook` | Matter-type playbooks (NDA, SPA, W&I) | `firm_wide` / `team` |
| `matter_note` | Case-specific analysis and summaries | `matter` |
| `partner_pref` | Partner drafting preferences and redline positions | `team` |
| `style_guide` | Writing and formatting standards | `firm_wide` / `team` |
| `entity` | Client or party profiles (PII-tagged) | `matter` |
| `clause` | Individual clause analysis | `matter` / `team` |

---

## 7. PII Stripping Pipeline

When a user wants to reuse a `matter`-scoped entry in a broader context (e.g. extract a well-drafted clause from a closed deal into the team library):

1. **User triggers share** — "Promote to team library" action on a matter KB entry.
2. **LLM PII scan** — identifies: company names, party names, case/matter numbers, financial figures, transaction-specific dates, personal names of individuals.
3. **Redaction proposal** — system proposes substitutions and highlights each one. The user (must be associate or above) can adjust before submitting for approval.
4. **Lawyer review gate** — entry enters `pending_review`. The owning matter's supervising associate or partner receives a review task. This is the mandatory human gate; the system cannot approve its own redactions.
5. **Approval** — the reviewing lawyer can accept, edit, or reject each redaction. On approval, the redacted entry is saved at the target scope. The original `matter`-scoped entry is unchanged.
6. **Audit** — `kb_access_log` row with `action = redact_applied`, `pii_redactions` row with full before/after.

**LLM enforcement**: the RAG query never surfaces entries with `pii_status = 'flagged'` or `'pending_review'` outside their matter scope. Only `clean` or `redacted` entries cross boundaries.

**Scope of stripping**: stripping applies when knowledge crosses matter or team boundaries. Users working within their own matter always see unredacted entries they have access to.

---

## 8. Style Guide

A `style_guide` KB entry stores:

- **Voice and tone** — e.g. active voice, plain English, no legalese
- **Clause ordering** — defined terms before operative provisions
- **Preferred language** — e.g. "reasonable endeavours" not "best efforts", "shall" not "will"
- **Formatting rules** — numbering scheme, defined term capitalisation, section heading style

Style guides are attached at firm or team level. When the LLM generates or reviews a document, it receives the applicable style guide in the system prompt. It also flags deviations in user-submitted drafts — displayed as inline warning flags in the chat response, consistent with the mentor panel pattern in the v2 UI.

---

## 9. Dashboard Shell

The v2 UI (`lexcatalyst-v2.html`) defines the target layout. The new shell has three columns:

```
[ Sidebar 215px ] [ Main area flexible ] [ Context panel 295px ]
```

### Sidebar (dark, left)

```
Logo + firm name
──────────────────
New chat
──────────────────
Knowledge Bank
Memories
──────────────────
[stub] Value Tracker
[stub] Wellbeing
──────────────────
Recent chats / Recent matters
──────────────────
User name · role · plan tag
```

Matter context is surfaced in the topbar breadcrumb (e.g. "Meridian / NDA · Draft v2"), not in the sidebar.

### Main area (white, centre)

Tabs are context-sensitive:

**No matter selected:**
- Chat
- Knowledge Bank (firm-wide + team scope only)

**Matter selected:**
- Chat
- Knowledge Bank (matter + team + firm-wide)
- Documents
- Audit Log (Partners and supervising Associates only)

### Context panel (right, collapsible)

Replaces the current WikiPanel:

- KB entry viewer (replaces the existing wiki page reader)
- Document viewer (existing)
- Redaction review queue — shown when `pending_review` entries exist in scope

The context panel can be toggled off. When toggled off the main area expands to fill the space (matching the mentor toggle in the mockup).

---

## 10. Migration Plan

The migration is additive. No existing data is deleted until the new layer is confirmed working. Single firm only — no `firm_id` column needed.

1. **Schema** — add `teams`, `team_members`, `matters`, `matter_members`. Create a default team for each existing user. Add `default_team_id`, `firm_role` to `users`.

2. **KB entries** — migrate `wiki_pages` rows:
   - `scope = matter` if `source_document_id` is set, else `scope = private`
   - `page_type` maps to `entry_type` directly
   - `pii_status = flagged` on all migrated rows — they require review before cross-boundary sharing

3. **Documents** — no data migration needed; gain `matter_id (nullable)` column, backfilled as null.

4. **Memories** — gain `scope = personal`, `matter_id = null`. No matter context exists for existing memories.

5. **Alembic** — all changes are additive (new tables, new nullable columns). Drop the wiki tables only after the KB is confirmed in production.

---

## 11. API Plan

```
GET    /kb/entries
POST   /kb/entries
GET    /kb/entries/{entry_id}
PATCH  /kb/entries/{entry_id}
DELETE /kb/entries/{entry_id}
POST   /kb/entries/{entry_id}/promote        ← trigger PII pipeline
POST   /kb/entries/{entry_id}/approve-redaction

GET    /matters
POST   /matters
GET    /matters/{matter_id}
PATCH  /matters/{matter_id}

GET    /matters/{matter_id}/members
POST   /matters/{matter_id}/members
DELETE /matters/{matter_id}/members/{user_id}

GET    /audit-log                            ← Partners / supervising Associates only
```

The existing `/wiki/*` routes remain until clients are migrated.

---

## 12. Build Order

1. Schema migrations — firms, teams, matters, kb_entries, kb_access_log, pii_redactions.
2. RBAC middleware — UserContext resolution, scope enforcement on every KB query.
3. KB entry CRUD — replacing wiki CRUD, same page types migrated to new entry types.
4. Matter CRUD — create/list/archive matters, matter member management.
5. Matter selector in chat composer — scopes agent context to the selected matter.
6. Agent context scoping — update `build_provider_messages` to filter by UserContext.
7. Dashboard shell — new 3-column layout, sidebar nav, context panel toggle.
8. PII stripping pipeline — LLM scan, redaction proposal UI, lawyer review queue.
9. Style guide — `style_guide` entry type, system prompt injection, deviation flagging.
10. Audit log view — read-only, Partners and supervising Associates.

---

## 13. Resolved Decisions

1. **Multi-firm support** — single firm only. No `firm_id` foreign keys or multi-tenant isolation. If multi-firm is needed later it is a schema migration, not a design change.

2. **Trainee write approvals** — KB entries publish immediately regardless of role. A `created_by_role` field is stored so reviewers can filter, but no approval gate blocks publication.

3. **Entity vs partner preference entries** — kept as separate entry types (`entity` for clients/parties, `partner_pref` for partner drafting preferences). See §6.

4. **RBAC for the mockup** — all authenticated users are treated as super users. Scope and role fields are stored in the data model so enforcement can be layered on later, but no access checks are enforced during the initial build.

---

## 14. Out of Scope for this RFC

- Value Tracker, Sustainability Principles, Wellbeing, IHC Tools — separate RFCs
- Client-facing portal access
- External counsel panel management
- Full-text document viewer (existing document viewer is sufficient for now)

---

## References

- `docs/rfc-llm-wiki.md` — superseded by this RFC
- `docs/rfc-semantic-document-search.md`
- `docs/llm-wiki.md`
- `lexcatalyst-v2.html` — v2 UI reference (3-column shell, KB, Mentor panel)
