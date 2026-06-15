# Wellbeing — Weekly Team Check-ins

> A weekly survey with partner-visible trends released only for sufficiently large cohorts.

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

A weekly survey linked to each submitting user for duplicate prevention, plus partner-facing aggregate trends that never return per-person results.

### Identified weekly responses

The `survey_responses` table stores `user_id` for new submissions. A unique constraint on `(user_id, question_id, week_of)` means resubmitting updates the weekly answer instead of inflating aggregate counts. Reporting never returns these identifiers, and rows without a user ID are excluded because they cannot contribute to a verified cohort size.

```sql
CREATE TABLE survey_responses (
    id            UUID PRIMARY KEY,
    user_id       UUID REFERENCES users(id),
    question_id   UUID REFERENCES survey_questions(id),
    score         SMALLINT,            -- 1-5
    week_of       TIMESTAMP,
    submitted_at  TIMESTAMP,
    UNIQUE (user_id, question_id, week_of)
);
```

### Three tabs

| Tab | Who sees it |
|---|---|
| **My check-in** | All users. A weekly form with a 1–5 slider per active question. A second submission updates that week's answers. |
| **Results** | Partners + admins. Weekly aggregates per question, released only when at least three people responded. |
| **Manage questions** | Partners + admins. Create, edit, toggle questions, and mark positive statements for reverse scoring. |

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **One answer per user/question/week** | Prevents repeat submissions from skewing the dashboard while still allowing a user to correct an answer. |
| **Minimum cohort of three** | Prevents a partner from identifying an individual score in a small or incomplete response group. |
| **Explicit scoring direction** | Positive statements are reverse scored so a higher reported score always means greater concern. |
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
        │   Identity comes from the authenticated JWT.
        ▼
[Backend upserts survey_responses for the current user and week]

────────────────────────────────────────────────

[Partner opens Wellbeing → Results]
        │
        ▼
GET /survey/results          (RBAC: partner or admin)
        │
        ▼
[Per-question weekly cohort aggregation]
        │   SELECT week_of, AVG(CASE ...), COUNT(DISTINCT user_id)
        │   FROM survey_responses
        │   GROUP BY week_of
        │   HAVING COUNT(DISTINCT user_id) >= 3
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

- **It's not a clinical mental-health intervention.** If a junior is in crisis, a weekly form is not enough. The firm's actual mental-health resources (EAP, etc.) sit outside this product.
- **It's not anonymous at rest.** User IDs remain stored to enforce one response per question per week, but the reporting API returns no per-user records.
- **It's not a substitute for 1:1s.** The survey surfaces patterns. A human still needs to act on them.

## Limitations

- No question-level pagination — surveys with 20+ questions would be a chore. We don't currently warn partners about question fatigue.
- The current form submits every active question using a default score of 3 when the slider was not changed.
- Existing rows created before migration `n1c2d3e4f5a6` cannot prove cohort size and are excluded from reports.

## Where it lives in the code

| Concern | Path |
|---|---|
| Service | `backend/app/services/survey_service.py` |
| Migrations | `backend/migrations/versions/d1e2f3a4b5c6_add_rbac_survey_actions.py`, `backend/migrations/versions/n1c2d3e4f5a6_identify_survey_responses.py`, `backend/migrations/versions/u6d7e8f9a0b1_add_survey_scoring_direction.py` |
| Routes | `backend/app/routers/surveys.py` → `/survey/*` |
| Frontend panel | `frontend/src/features/wellbeing/WellbeingPanel.tsx` |
| Model | `backend/app/models.py` → `SurveyQuestion`, `SurveyResponse` |
