# Workboard — Visible Work Delegation

> A kanban board for handing off work to juniors with priority, due date, and matter context. The senior who delegated and the junior who received both see it.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**Senior pain**:
- "Triage of work distribution / Who needs work / has too much"
- "Manage junior lawyers"
- "Lots of review of work → additional work"

**Junior pain**:
- "Overworked"
- "Scared to voice concerns"
- "Lack of recognition for non-billable hours"

**Trello / jira board brief**:
- "Meaningful delegation + smart tech"
- "Triage workload"
- "Manage juniors"

Most law firms delegate work via Slack, email, or a partner walking over and saying "do this by tomorrow". The result:

- **Junior load is invisible.** A trainee has six matters on their plate, the seventh partner assigning work doesn't know.
- **No paper trail.** When the partner forgets they asked for something, the junior either chases (awkward) or stays silent (work falls through).
- **Reviews don't reflect contribution.** Non-billable workload — research, mentoring, helping a peer — vanishes from the record.

Jira/Linear exist but they're built for engineering teams. Lawyers don't want sprints, story points, or status walls of jargon.

## What we built

A simple kanban board, one per firm. Columns: **To Do / In Progress / Review / Done**.

Each action item has:
- Title and optional description
- Assignee (the person doing the work)
- Assigner (the person who delegated — recorded automatically)
- Matter (optional — ties the work to a specific deal)
- Priority (low / medium / high)
- Due date

Filterable by matter. Clicking an action opens a detail dialog where the assignee can update status or the assigner can edit/delete.

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **Only seniors can delegate** | The route is gated on `is_senior_or_above` — partners and senior associates only. Associates can update their own actions but can't create new ones. This matches firm hierarchy: junior-to-junior delegation isn't a real workflow. |
| **Assigner and assignee both visible** | Lawyers care about accountability. A task without a clear assigner is a task no one owns. |
| **Matter linkage** | An action item without context — "review the indemnity caps" — is useless. With a matter attached, the assignee knows which deal, which counterparty, which set of documents. |
| **4 columns, no custom workflow** | Jira's "lawyer-led customisation" rabbit hole produces firms with 14-column boards that nobody uses. We picked the four states that match how legal work actually flows: queued, doing, reviewing (someone else is checking), done. |
| **Priority pills, not numeric scores** | Lawyers don't need 5-level priority. High / medium / low is enough to triage. |
| **No "story points" or estimates** | Time-to-completion for legal work is famously unpredictable. We don't pretend otherwise. |
| **Visible to the whole firm by default (with matter filter)** | Partners can see who's overloaded by glancing at the board. A junior with 15 pending actions is obvious. |

## How it works

```
[Senior creates action]
        │
        ▼
POST /actions          (RBAC: senior_associate or partner)
        │   assigner_id = current user
        │
        ▼
[Assignee sees it in their "To Do" column]
        │
        ▼
[Assignee moves to In Progress]
        │
        ▼
PATCH /actions/{id}    (RBAC: assigner OR assignee OR admin)
        │   status="in_progress"
        │
        ▼
[When done, assignee moves to Review or Done]
        │
        ▼
[Assigner can edit details; only assigner OR admin can delete]
```

## Roles & permissions

| Action | Required role |
|---|---|
| Create | Partner or senior associate |
| Update status (own action) | Assignee or assigner |
| Edit details | Assigner |
| Delete | Assigner or admin |
| View | Any authenticated user; filtered to actions they assigned, were assigned, or are visible on a matter they belong to |

## What this is NOT

- **It's not a time-tracking system.** Lawyers already have time entry; we're not duplicating it.
- **It's not a project management tool.** No dependencies, no Gantt charts, no sprint planning. This is a workflow board, not a project plan.
- **It's not a "performance review" record.** Although the data could be mined for that, the product doesn't surface it that way. Action items reflect a moment in time, not a verdict on a person.

## Limitations

- No notifications (email, push). The assignee has to check the board. Adding email notifications is a reasonable next step.
- No bulk actions. Reassigning 10 items at once requires 10 clicks.
- No history of who moved what when — useful for audit but adds UI complexity.
- The "Done" column has no archive — long-lived boards will accumulate completed items.

## Where it lives in the code

| Concern | Path |
|---|---|
| Service | `backend/app/services/action_service.py` |
| Migration | `backend/migrations/versions/d1e2f3a4b5c6_add_rbac_survey_actions.py` |
| Routes | `backend/app/main.py` → `/actions/*` |
| Frontend panel | `frontend/src/components/ActionsPanel.tsx` |
| Model | `backend/app/models.py` → `ActionItem` |
