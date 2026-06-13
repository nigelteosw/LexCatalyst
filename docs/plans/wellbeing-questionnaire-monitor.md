# Plan: Wellbeing questionnaire polish + team monitor

## Why

The existing wellbeing surface is too thin to be useful. The check-in is a row of sliders with no progress feedback and no way to capture context. The partner-facing "Results" tab is a static list of bars — partners can't actually see whether things are getting better or worse, and there's no way for the system to flag a category that's trending badly.

Both pieces tie back to whiteboard pain points: *"Lack of psychological safety"* (juniors won't say anything they can't say anonymously) and *"Triage of work distribution"* (seniors need a real signal, not a quarterly survey).

## What we're building

### Part A — Polish the check-in (`SurveyTab`)

| Change | Detail |
|---|---|
| **Progress indicator** | Pill at the top showing `N of M answered` plus a thin progress bar across the panel header. |
| **Draft auto-save** | Score + comment state persists in `localStorage` keyed by `"survey-draft:" + weekIso`. Loads on mount, clears on successful submit. Avoids losing a half-finished check-in when the user navigates away. |
| **Optional comment per question** | Each question gets a "Add context (optional)" collapsible textarea. Stored alongside the response. Still anonymous — no `user_id` on the row. |
| **Submit button disabled until at least one question answered** | Today the submit fires whether anything was answered or not; we should require at least one score so the aggregates don't get noise. |

### Part B — Replace `ResultsTab` with `MonitorTab`

| Section | Detail |
|---|---|
| **Header banner** | Current week label + total respondents this week. If any category is flagged, show an amber "Attention needed in N categories" banner. |
| **Snapshot grid** | One card per category. Each card shows the current-week average (or "—" if no responses yet), a small trend arrow with the absolute change vs last week, and the response count. Flagged categories get a red border. |
| **Trend chart** | One sparkline per category over the last 8 weeks. Simple SVG — no charting lib needed. Y-axis is fixed at 1–5; missing weeks plot as gaps. |
| **Recent comments stream** | Last 25 anonymous comments, week-bucketed, sorted by recency. Each shows the comment text, the question's category, and the week. No author. |
| **K-anonymity safety** | If a category has fewer than 5 responses in the current week, we hide the average (show "—") and don't flag it. Prevents identifying individuals through low-N reads. |

## Backend changes

### Migration `i6d7e8f9a0b1` — `survey_response_comment`

```python
op.add_column(
    "survey_responses",
    sa.Column("comment", sa.Text(), nullable=True),
)
```

Purely additive. Existing rows stay valid with `comment IS NULL`.

### Model

`SurveyResponse.comment: Mapped[str | None] = mapped_column(Text, nullable=True)` — explicit "still anonymous — no user_id on the row" comment so the next reader doesn't worry.

### Schemas (additions)

```python
class SurveyResponseCreate(BaseModel):
    question_id: str
    score: int = Field(ge=1, le=5)
    week_of: datetime
    comment: str | None = Field(default=None, max_length=2000)

class SurveyCategorySnapshot(BaseModel):
    category: str
    avg_score: float | None   # null when below k-anonymity floor
    response_count: int
    change_vs_last_week: float | None
    flagged: bool

class SurveyCategoryTrendPoint(BaseModel):
    week_of: datetime
    avg_score: float
    response_count: int

class SurveyCategoryTrend(BaseModel):
    category: str
    points: list[SurveyCategoryTrendPoint]

class SurveyCommentSample(BaseModel):
    week_of: datetime
    category: str
    comment: str

class SurveyMonitorResponse(BaseModel):
    current_week_of: datetime
    snapshots: list[SurveyCategorySnapshot]
    trends: list[SurveyCategoryTrend]
    recent_comments: list[SurveyCommentSample]
    alert_threshold: float                 # default 2.5
    min_responses_for_signal: int          # default 5
```

### Service

In `app/services/survey_service.py`:

- Update `submit_survey_response` to write `comment`.
- Add `get_survey_monitor(db) -> SurveyMonitorResponse`:
  - Compute current ISO week start (Mon 00:00 UTC).
  - One SQL pass: aggregate by `(category, week_of)` for the last 8 weeks via a JOIN with `survey_questions`. Returns the trend.
  - From the trend, derive snapshots (current week per category) + flagged (avg < 2.5 AND response_count >= 5).
  - Pull the 25 most recent non-null comments with category + week.

### Route

`GET /survey/monitor` (partner/admin only via `require_partner_or_admin`) → `SurveyMonitorResponse`.

Keep `GET /survey/results` for backward compat; the new monitor is the primary surface.

## Frontend changes

### Files touched

- `frontend/src/lib/api.ts` — add `getSurveyMonitor()`, extend `submitSurveyResponse` to take optional `comment`.
- `frontend/src/types/workspace.ts` — `SurveyMonitor`, `SurveyCategorySnapshot`, `SurveyCategoryTrend`, `SurveyCommentSample`.
- `frontend/src/components/WellbeingPanel.tsx`:
  - `SurveyTab`:
    - Replace the inline state with `useState<Record<string, { score: number; comment: string }>>`, hydrate from `localStorage`.
    - Persist on change (debounced).
    - Progress bar + count chip.
    - Collapsible textarea per question.
    - Clear draft on successful submit.
  - Replace `ResultsTab` with `MonitorTab`:
    - Header banner (current week + flagged categories).
    - Snapshot grid (4 cards, one per category, with sparkline).
    - Trend chart (per category, 8-week sparkline as inline SVG).
    - Recent comments list.

### Sparkline (no chart lib)

A simple 120×24 SVG: `points` polyline computed from `(week_index, score)` with linear scaling. Stroke colour reflects the latest score's bucket (green ≥ 4, amber 3–4, red < 3). Gaps for missing weeks. Around 30 lines.

## Verification

1. `alembic upgrade head` applies cleanly. Existing rows have `comment = NULL`.
2. Submit a check-in with comments → row appears with comment stored, no `user_id`, no FK to user anywhere.
3. As partner, hit `GET /survey/monitor` → shape matches the schema; categories with < 5 responses show `avg_score: null` and `flagged: false`.
4. Monitor tab renders sparkline, snapshot cards, recent comments. Flagged category shows red border + amber banner.
5. As associate, navigating to the wellbeing panel only shows the check-in tab (no Monitor tab visible).

## Out of scope (later)

- Slack/email alerting when a category goes red — for now, partners must visit the page.
- Per-team breakdown — adding a `team_id` would re-identify small teams. Skip until we have a strict k ≥ 10 threshold and a multi-team firm.
- Historical export (CSV) for compliance audits.
