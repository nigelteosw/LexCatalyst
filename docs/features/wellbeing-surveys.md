# Wellbeing — Anonymous Pulse Surveys

> A weekly survey juniors can fill in honestly because there is, structurally, no way to trace a response back to them.

## The lawyer's problem

From [`product-requirement.md`](../product-requirement.md):

**Junior pain**:
- "Overworked"
- "Scared to voice concerns"
- "Lack of recognition for non-billable hours"
- "Lack of psychological safety"

**Health × Wellbeing brief**:
- "Smart tech"
- "Anonymised team mental survey"
- "Weekly mandatory survey"

**Surveys brief**:
- "Figure out contributing factors"
- "Factors that affect burnout"
- "Figure out what data required for action"

Burnout in law firms is endemic. The standard firm response is: *we send an anonymous survey, but it's actually run by HR and they can see who responded.* Juniors know this and:

1. Don't answer.
2. Answer dishonestly.
3. Answer honestly and become "the negative one" in the next review cycle.

Any of those outcomes makes the survey useless for the firm and dangerous for the junior.

## What we built

A weekly survey that is **structurally anonymous**, plus a partner-facing aggregate dashboard.

### Structural anonymity

The `survey_responses` table has no `user_id` column. Not "we delete it after a while" — there's nowhere to put it in the first place.

```sql
CREATE TABLE survey_responses (
    id            UUID PRIMARY KEY,
    question_id   UUID REFERENCES survey_questions(id),
    score         SMALLINT,            -- 1-5
    week_of       TIMESTAMP,
    submitted_at  TIMESTAMP
    -- NO user_id column
);
```

A bad actor with database access cannot deanonymise responses, because the data simply isn't there.

### Three tabs

| Tab | Who sees it |
|---|---|
| **My check-in** | All users. A weekly form with a 1–5 slider per active question. Once submitted, the user sees confirmation; we don't track *whether* they submitted (that would be deanonymising). |
| **Results** | Partners + admins. Weekly aggregates per question: average score, response count. Shown as horizontal bars. |
| **Manage questions** | Partners + admins. Create, edit, toggle questions on/off, group by category (workload, mental health, team dynamics, learning). |

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **No `user_id` column** | The original whiteboard says "anonymised team mental survey". We took that literally. Any other design — pseudonymous, hashed, deleted-after-X-days — relies on people not abusing access. Removing the column removes the temptation. |
| **Aggregate-only results** | Partners get weekly averages, not individual responses. The smallest unit of insight is the team, not the person. |
| **No "X people responded out of Y" stat** | That would let a partner correlate response count with team size and identify who didn't answer. |
| **Weekly, not real-time** | Burnout is a trend, not a moment. Aggregating weekly smooths out the "I had one bad day" signal and surfaces the "this team is in trouble" signal. |
| **Category grouping** | Lets partners look at workload separately from team dynamics. The same week could show "workload OK, team dynamics terrible" — different interventions. |
| **Partners can edit questions** | The firm's burnout drivers change. The questions should change with them. Locking the question set defeats the point of surveying. |

## How it works

```
[Junior opens Wellbeing → My check-in]
        │
        ▼
GET /survey/questions?active_only=true
        │
        ▼
[Slider per question, 1–5]
        │
        ▼
POST /survey/responses (one per question)
        │   { question_id, score, week_of }
        │   No user identity in the payload.
        ▼
[Backend stores in survey_responses — anonymous]

────────────────────────────────────────────────

[Partner opens Wellbeing → Results]
        │
        ▼
GET /survey/results          (RBAC: partner or admin)
        │
        ▼
[Per-question weekly aggregation in SQL]
        │   SELECT week_of, AVG(score), COUNT(*)
        │   FROM survey_responses
        │   WHERE question_id = ?
        │   GROUP BY week_of
        ▼
[Frontend renders one bar chart per question]
```

## Roles & permissions

| Action | Required role |
|---|---|
| Submit response | Any authenticated user |
| Create / edit questions | Partner or admin |
| View aggregate results | Partner or admin |

The API enforces this via `require_partner_or_admin`.

## What this is NOT

- **It's not a clinical mental-health intervention.** If a junior is in crisis, no anonymous form helps. The firm's actual mental-health resources (EAP, etc.) sit outside this product.
- **It's not retaliation-proof in social terms.** Even with anonymous data, a partner could call a team meeting and say "this team's wellbeing scores are low, who has feedback?" — and juniors will still feel exposed. The product can guarantee technical anonymity; it cannot guarantee cultural psychological safety.
- **It's not a substitute for 1:1s.** The survey surfaces patterns. A human still needs to act on them.

## Limitations

- No question-level pagination — surveys with 20+ questions would be a chore. We don't currently warn partners about question fatigue.
- No "skip this question" tracking, because that would require knowing who answered what. So responses are required to be all-or-nothing per submission.
- Submission status is client-side only — a user could resubmit in the same week and skew their team's average. For an internal firm tool, we trust people not to do that.

## Where it lives in the code

| Concern | Path |
|---|---|
| Service | `backend/app/services/survey_service.py` |
| Migration | `backend/migrations/versions/d1e2f3a4b5c6_add_rbac_survey_actions.py` |
| Routes | `backend/app/main.py` → `/survey/*` |
| Frontend panel | `frontend/src/components/WellbeingPanel.tsx` |
| Model | `backend/app/models.py` → `SurveyQuestion`, `SurveyResponse` |
