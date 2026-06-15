# RBAC & Roles — Confidentiality at the Right Granularity

> Three lawyer roles and four content scopes, enforced at the route layer. A trainee can't see a partner's notes by accident; a partner can't accidentally leak a client's matter to the whole firm.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**Target payer pain (managing partners)**:
- "Good privacy / confidentiality"
- "Firm specific"

**Training data brief**:
- "Sanitise data for confidential info"
- "Firm-only confidential"
- "Access control (important)"

**Senior partner pain**:
- "Not confident in knowledge" (i.e. doesn't trust juniors with everything)

Law firms operate under a deep web of confidentiality:
- **Client confidentiality** — a matter for Client A must not be visible to lawyers working on Client A's competitor.
- **Internal hierarchy** — partner-level negotiation tactics shouldn't be browsed by trainees who don't yet understand the context.
- **Cross-team segregation** — a corporate team shouldn't see litigation team's matter notes by default.

Without enforced access control, an AI knowledge bank becomes a confidentiality liability. The firm's risk officer says no, and the product dies on the vine.

## What we built

### Three lawyer roles + one admin flag

| Role | Who they are |
|---|---|
| `partner` | Equity / non-equity partner. Approves firm-wide content. Sees survey results. |
| `senior_associate` | Senior associate. Can delegate work, manage team/matter knowledge. |
| `associate` | Junior associate / trainee. Default. |
| `is_admin` (flag) | Firm IT / ops. Bypasses all checks. Used for the firm administrator who needs to clean up data. |

The three roles match how firms actually talk about hierarchy. We deliberately did not invent a separate "senior partner" / "junior partner" / "of counsel" axis — that's firm-by-firm political detail the product shouldn't encode.

### Four KB content scopes

| Scope | Read access | Write/delete access |
|---|---|---|
| `firm_wide` | All authenticated users | Partner or admin only |
| `team` | Team members | Team members |
| `matter` | Matter members | Matter members |
| `private` | Creator only | Creator only |

This matches how legal knowledge actually flows:
- **Firm-wide** = the firm's official position (style guide, signed-off playbook).
- **Team** = the corporate team's internal notes that the litigation team doesn't need.
- **Matter** = work product specific to one deal — never visible outside the team working on it.
- **Private** = your own draft, your own annotations.

### Matter & membership rules

| Action | Who can |
|---|---|
| Create a matter | Senior associate or partner (not associates) |
| View matter list | Partners/admins see all; others see only matters they belong to |
| View matter detail / member list | Matter members, partners, admins |
| Edit matter metadata | Partners and admins only |
| Add / remove matter members | Partners and admins — OR a senior associate who is already a member of that matter |
| Create a KB `firm_wide` entry | Partners and admins only |
| KB backfill (operational) | Admins only |

### Enforcement points

| Layer | Enforced where |
|---|---|
| **Matter list** | `list_matters` / `list_teams` add EXISTS subquery filtering to SQL; partners/admins skip the filter. |
| **Matter detail / members** | `require_matter_member` on GET routes — 403 if not a member (partners/admins exempt). |
| **Matter edit** | `require_partner_or_admin` on PATCH /matters. |
| **Member add/remove** | `_require_membership_manager` — partner/admin unconditionally; senior associate only if a member of that matter. |
| **KB list** | `list_kb_entries` adds a scope-filter WHERE clause built from the user's team and matter memberships. Users literally cannot retrieve entries they don't have access to. |
| **KB write** | `require_kb_write` on PATCH/DELETE routes. Hidden from the UI as well, but the route enforces. |
| **KB read (specific)** | `require_kb_read` on the detail route — even if the user knows the UUID, the route returns 403. |
| **Scope changes** | `require_kb_owner` permits only the creator to change `scope`, `team_id`, or `matter_id`; the service then validates target membership. |
| **KB firm-wide create** | `require_partner_or_admin` on POST /kb/entries when scope=firm_wide. |
| **KB redaction detail** | `require_kb_owner` — only entry creator can see original_content. |
| **KB backfill** | `current_user.is_admin` check on POST /kb/backfill-embeddings. |
| **Agent tool calls** | Semantic search reuses `_user_kb_scope_filter`, and `get_kb_entry` calls `check_kb_read`. An LLM that hallucinates a UUID cannot fetch private content. |
| **Survey results** | `require_partner_or_admin`. |
| **Action creation** | `is_senior_or_above`. |
| **Action delete** | Assignee, assigner, or senior+ only (returns 404 for everyone else, same as not found). |

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **Scope filter at the SQL query level, not application-layer filter** | Means we can't accidentally leak by paging or by misusing a search. The DB itself doesn't return inaccessible rows. |
| **No "deny" rules — only positive grants** | Default-deny. If the system can't prove the user should see an entry, they don't. No "everyone except X" logic — too easy to break. |
| **Admin flag, not "admin" role** | Admins are humans with their own firm_role. An admin partner is `is_admin=true` AND `firm_role="partner"`. Means we never have to ask "which is more powerful, admin or partner?" |
| **No team-level write restriction beyond membership** | Inside a team, anyone can edit team-scope entries. Lawyers self-police; we don't model "team lead" as a distinct permission tier. |
| **Admin-managed role changes** | Users cannot change their own role. Admins manage roles through the authenticated user roster. |
| **All KB edits audited** | `kb_access_log` records edit, share, and redact changes without logging reads. |

## How it works

```
[User logs in via Google OAuth]
        │
        ▼
get_or_create_user
        │   sets firm_role=associate by default
        │   sets is_admin=false by default
        │
        ▼
[Every request goes through get_current_user → loads User from DB]
        │
        ▼
[Route handler]
        │
        ├── For KB list:
        │     list_kb_entries(db, user=current_user, ...)
        │       │
        │       └── _user_kb_scope_filter builds WHERE clause:
        │             - firm_wide (always)
        │             - team scope AND team_id IN user's teams
        │             - matter scope AND matter_id IN user's matters
        │             - private AND created_by = user.id
        │
        ├── For KB write:
        │     require_kb_write(db, user, entry) → 403 if denied
        │
        ├── For KB scope change:
        │     require_kb_owner(user, entry) → validate target team/matter
        │
        └── For agent tool:
              check_kb_read returns bool
              → tool replies "access denied" inside the LLM context
```

## What this is NOT

- **It's not row-level security in Postgres.** We could push the filter into the DB role itself, but it's overkill for a hackathon. The application-layer filter is enforced everywhere queries are issued.
- **It's not auditable cross-team disclosure.** If a partner adds an associate to a matter they shouldn't be on, the partner is the breach — the system trusted the partner's grant. We log the grant in `matter_members.granted_by`; humans review.
- **It's not encrypted-per-user.** Knowledge bank entries are stored plaintext in the DB (except `client_name` which is Fernet-encrypted). Encryption-at-rest is a separate infrastructure concern.

## Limitations

- Role changes don't cascade to historical audit log entries. If you change role from associate to partner, old log lines still show you as associate at write time (which is actually correct behaviour for an audit log).
- No "read-only" mode. A user with read access has the option to write to private scope; they can't be denied private-scope writes.
- The `team` model is firm-wide-singleton in the demo (`ensure_default_team` puts everyone in "LexCatalyst Legal"). Real multi-team configuration is an admin task we haven't UI'd.

## Where it lives in the code

| Concern | Path |
|---|---|
| Role definition | `backend/app/models.py` → `User.firm_role`, `User.is_admin` |
| Permission helpers | `backend/app/dependencies.py` → `is_partner_or_admin`, `require_kb_write`, etc. |
| KB scope filter | `backend/app/services/knowledge_bank_service.py` → `_user_kb_scope_filter` |
| Audit log | `backend/app/models.py` → `KnowledgeBankAccessLog` |
| Role-change route | `backend/app/routers/auth.py` → `PATCH /users/{user_id}/role` |
| Settings UI | `frontend/src/features/settings/SettingsPanel.tsx` |
