# Wellbeing — Weekly Team Check-ins

> A weekly survey with a partner dashboard showing every user's completion state and average score.

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

A weekly survey linked to each submitting user, plus a partner-facing team dashboard and aggregate trends.

### Identified weekly responses

The `survey_responses` table stores `user_id` for new submissions. A unique constraint on `(user_id, question_id, week_of)` means resubmitting updates the weekly answer instead of inflating aggregate counts. Rows created before migration `n1c2d3e4f5a6` keep a null `user_id` and remain visible only in aggregate trends.

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
| **Results** | Partners + admins. Every firm user, completion state, current-week average, and weekly aggregates per question. |
| **Manage questions** | Partners + admins. Create, edit, toggle questions on/off, group by category (workload, mental health, team dynamics, learning). |

## Why these specific design choices

| Choice | Why for lawyers |
|---|---|
| **One answer per user/question/week** | Prevents repeat submissions from skewing the dashboard while still allowing a user to correct an answer. |
| **Every user is listed** | Partners can distinguish a missing check-in from a low team response rate and follow up directly. |
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
[Current-week user dashboard + per-question weekly aggregation]
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
| View user dashboard and aggregate results | Partner or admin |

The API enforces this via `require_partner_or_admin`.

## What this is NOT

- **It's not a clinical mental-health intervention.** If a junior is in crisis, a weekly form is not enough. The firm's actual mental-health resources (EAP, etc.) sit outside this product.
- **It's not anonymous.** Partners and admins can see each user's completion and average score. The UI tells users this before submission.
- **It's not a substitute for 1:1s.** The survey surfaces patterns. A human still needs to act on them.

## Limitations

- No question-level pagination — surveys with 20+ questions would be a chore. We don't currently warn partners about question fatigue.
- The current form submits every active question using a default score of 3 when the slider was not changed.
- Existing rows created before migration `n1c2d3e4f5a6` cannot be linked back to a user and appear only in aggregate trends.

## Where it lives in the code

| Concern | Path |
|---|---|
| Service | `backend/app/services/survey_service.py` |
| Migrations | `backend/migrations/versions/d1e2f3a4b5c6_add_rbac_survey_actions.py`, `backend/migrations/versions/n1c2d3e4f5a6_identify_survey_responses.py` |
| Routes | `backend/app/routers/surveys.py` → `/survey/*` |
| Frontend panel | `frontend/src/features/wellbeing/WellbeingPanel.tsx` |
| Model | `backend/app/models.py` → `SurveyQuestion`, `SurveyResponse` |
