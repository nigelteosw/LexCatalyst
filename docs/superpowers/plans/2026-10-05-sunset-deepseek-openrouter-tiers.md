# Sunset DeepSeek → OpenRouter with High / Mid tiers

**Goal:** Remove the firm DeepSeek key entirely. Every LLM call is made with the *acting user's* OpenRouter key. Each user picks any OpenRouter model for two tiers, **High** and **Mid**, and chooses which tier each feature uses. LexChat and Birdie (web + extension) get a composer pill like `Mid · Sonnet 5.5 ▾` to switch tier (or a specific model) per prompt.

**Out of scope:** embeddings stay on OpenAI `text-embedding-3-small` (firm key). Changing that would mean re-embedding every chunk.

## Decisions (flag if wrong)

1. **Firm fallback is `DEMO_OPENROUTER_KEY`, and only in demo mode.** Key lookup: the user's own key, then `DEMO_OPENROUTER_KEY` (only when `DEMO_MODE=true`), then `409 openrouter_key_required`, which the UI shows as "Add your OpenRouter key in Settings". Upload, extraction and embedding still work without a key. The UI says when the demo key is in use, so prompts aren't silently billed to the firm.
2. **Background jobs use the key of the user who started them.** KB ingestion → uploader; Dream → requester; wiki ingest → requester; thread summaries → thread owner. If that key is missing or rejected, the job fails with a clear `error_message` and does not retry in a loop.
3. **Each feature uses the tier the user picks in Settings.** Defaults:

   | Feature key | Call site | Default tier |
   |---|---|---|
   | `lexchat` | `agent_service` (composer default; switchable per prompt) | Mid |
   | `birdie` | `birdie_service` (composer default; switchable per prompt) | Mid |
   | `lessons` | `lesson_service` | Mid |
   | `dream` | `dream_service` | High |
   | `wiki` | `wiki_service` | Mid |
   | `kb_summary` | `knowledge_bank_service` | Mid |
   | `kb_format` | `kb_ingestion_service` | Mid |
   | `thread_summary` | `chat_service` | Mid |
   | `memory` | `memory_service` | Mid |

   The `FEATURES` dict in `llm_service.py` is the single source of truth for this list (key, label, default tier). Settings renders its rows from that dict.

4. **Seeded defaults** for anyone who hasn't chosen models: High `anthropic/claude-opus-5.5`, Mid `anthropic/claude-sonnet-5.5`. Overridable via env (`OPENROUTER_DEFAULT_{HIGH,MID}`).
5. **Tool calling:** the LexChat agent loop needs a model that supports `tools`. Settings only lists models whose OpenRouter `supported_parameters` include `tools`. On an unsupported-tools 400, show a clear error.

## Phase 1 — Backend provider

**`backend/app/providers/openrouter.py`** becomes the only chat provider:
- Rename `complete` → `chat(messages, *, model) -> (content, usage)` so the call sites that used `DeepSeekProvider.chat` still work.
- Add `stream_chat(messages, *, model)` and `stream_with_tools(messages, tools, *, model)`, ported from `deepseek.py`. Drop the DeepSeek-only `reasoning_content` echo. Remove the inline tool-markup filter in `agent_service.py:21-60` only once we've confirmed no OpenRouter model needs it.
- Send `HTTP-Referer` / `X-Title: LexCatalyst` headers.
- Keep `OpenRouterError` and `_translate` (401/402/403/429 → "key rejected or out of credit").
- Add `list_models(api_key)`, which calls `GET /api/v1/models`, caches the result in-process for 1 hour, and returns `{id, name, context_length, pricing, supports_tools}`.

**New `backend/app/services/llm_service.py`** (replaces `birdie_provider.py`):
```py
Tier = Literal["high", "mid"]
FEATURES: dict[str, tuple[str, Tier]]   # key -> (label, default tier)
class OpenRouterKeyMissing(RuntimeError): ...
def resolve_model(db, user_id, *, feature: str, tier: Tier | None = None, model: str | None = None) -> str
def get_llm(db, user_id) -> OpenRouterProvider   # user key → DEMO_OPENROUTER_KEY (DEMO_MODE only) → raises OpenRouterKeyMissing
```
Precedence: explicit `model` > explicit `tier` (per-prompt pill) > user's tier for `feature` > the feature's default tier. The tier then maps to the user's model for that tier, or the env default if they haven't set one. Allow any model the user has chosen; don't keep a hard-coded allow-list like `SUPPORTED_CHAT_MODELS`.

**Delete:** `providers/deepseek.py`, `services/birdie_provider.py`, `DEEPSEEK_*` in `config.py`, and the `deepseek_*` fields in `routers/system.py`. In `schemas.py`, change the `ChatModel` Literal to `str` and add `tier: Tier | None`.

## Phase 2 — Data model + migration

`UserSetting`:
- keep `openrouter_api_key` (encrypted)
- replace `openrouter_model` with `model_high`, `model_mid` (String(200), nullable)
- add `feature_tiers` (JSONB, default `{}`), e.g. `{"dream": "high", "memory": "mid"}`. Missing keys fall back to `FEATURES` defaults; unknown keys are ignored.

Alembic migration from `x9a0b1c2d3e4`: add the new columns, copy `openrouter_model` → `model_mid`, then drop `openrouter_model`. Update the "Current head" line in AGENTS.md.

Keep `ChatMessage.model` storing the resolved OpenRouter id (e.g. `anthropic/claude-sonnet-5.5`). Old `deepseek-*` rows remain as history and only need a label fallback in the UI.

## Phase 3 — Rewire call sites

Replace `DeepSeekProvider()` with `get_llm(db, user_id)` and `resolve_model(..., feature="<key>")` in:
`chat_service.py` (147, 286), `agent_service.py` (312), `dream_service.py` (246), `wiki_service.py` (393), `knowledge_bank_service.py` (643), `kb_ingestion_service.py` (224), `memory_service.py` (120), `birdie_service.py` (150), `lesson_service.py` (191).

Each function needs a `user_id`. Background workers read it from the job row (document `uploaded_by`, dream job `user_id`, and so on). Check each worker's claim function to confirm the owner id is available.

Routers (`chat.py`, `birdie.py`, `wiki.py`): catch `OpenRouterError` / `OpenRouterKeyMissing` instead of `DeepSeekError`. Missing key → 409 `{"code": "openrouter_key_required"}`; rejected key → 402 with the existing message. In `chat.py:66`, fall back to the resolved model, not `settings.deepseek_model`.

Request bodies for `POST /chat/.../stream` and `POST /birdie/stream`: `{ tier?: "high"|"mid", model?: string }`.

## Phase 4 — Settings API + UI

Routes (auth: logged-in user, own settings only):
- `GET /settings/llm` → `{ has_key, key_source, models: {high, mid}, feature_tiers: {<key>: tier}, features: [{key, label, default_tier}] }` (the key itself is never returned)
- `PUT /settings/llm` → `{ api_key?, models?, feature_tiers? }`. Reject unknown feature keys and tiers with 422. Validate the key with a cheap `GET /api/v1/key` call before saving.
- `GET /settings/llm/models` → the cached OpenRouter catalogue (needs the user's key)

Frontend: rename `features/settings/BirdieSettingsSection.tsx` → `ModelSettingsSection.tsx`, containing:
- an OpenRouter key field with a Test button
- two searchable model selects (High / Mid) that accept **any** OpenRouter model, each showing price per 1M tokens and a "tools" badge
- a "Feature tiers" table: one row per feature (label + a High/Mid segmented toggle), plus a "Reset to defaults" button
- the disclosure: *"All AI features send prompts — including document excerpts — to OpenRouter and the selected model's provider."*

Add the mappers to `shared/api/api.ts` and types to `shared/types/workspace.ts`.

## Phase 5 — Composer model pill (LexChat + Birdie + extension)

New shared component `shared/ui/ModelPicker.tsx`, matching the screenshot:
```
[ Mid  Sonnet 5.5 ▾ ]
  ├ High   Opus 5.5
  ├ Mid    Sonnet 5.5   ✓
  └ Other model…  (search the catalogue)
```
- Each row shows the tier name in bold and the model's short name muted (`name` from the catalogue, with the vendor prefix stripped).
- The pill starts on the user's Settings tier for that feature (`lexchat` / `birdie`). A per-prompt override is kept per surface in `localStorage` (`lex.chat.tier`, `lex.birdie.tier`) inside try/catch, and is sent with each prompt.
- Use it in `features/chat/ChatPanel.tsx`, replacing the current deepseek `modelLabel` / "Choose your model" block (~lines 30, 300), and in `features/birdie/`. Remove the DeepSeek pro/flash switch from `app/App.tsx`.
- Extension: `extension/src/sidepanel/BirdieSidePanel.tsx` gets the same pill. Copy the component, because the extension is a separate bundle. Fetch tiers from `GET /settings/llm`.
- With no key, the pill reads "Add OpenRouter key" and links to Settings, and the send button is disabled.

## Phase 6 — Docs, env, cleanup

- `backend/.env.example` and `config.py`: remove `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` and `DEEPSEEK_TEMPERATURE`. Add `DEMO_OPENROUTER_KEY` and the optional `OPENROUTER_DEFAULT_{HIGH,MID}`. Temperature becomes a code constant (0.2) in the provider.
- README + AGENTS.md: update the LLM Provider Guidance section (DeepSeek default → per-user OpenRouter tiers), the provider disclosure line, the extension disclosure line, and the migration head.
- Demo seed (`demo_seed_service.py`): demo users have no key of their own and use `DEMO_OPENROUTER_KEY`. `GET /settings/llm` returns `key_source: "user"|"demo"|null` so the pill and Settings can show "Using demo key".
- Railway: add `DEMO_OPENROUTER_KEY`, then delete all four `DEEPSEEK_*` vars once the deploy is verified. Never set `DEMO_OPENROUTER_KEY` in a deployment with real client data, the same rule as `DEMO_MODE`.
- Run `grep -ri deepseek backend/app frontend/src extension/src`. It should return nothing except label fallbacks for historical messages.

## Testing

- Unit: `resolve_model` precedence (explicit model > explicit tier > user's feature tier > feature default; tier → user model → env default); missing key raises `OpenRouterKeyMissing`; migration copies `openrouter_model` into `model_mid`; `PUT` rejects unknown feature keys.
- Provider: mock `AsyncOpenAI` and check streaming, tool-call accumulation, and error translation (401 and 402 both → key-rejected message).
- Workers: when the job owner has no key, the job ends `failed` with a readable message and is not re-claimed.
- Manual: set a key → pick High/Mid models → set Dream to Mid and KB format to High → LexChat with tool use on Mid → switch to High for one prompt → Birdie in the web app and the extension → upload a doc (KB format uses High model) → run Dream (uses Mid model) → remove the key and confirm the 409 banner.

## Rollout order

1. Phases 1–3 behind a temporary `LLM_BACKEND=openrouter|deepseek` switch, so main stays demoable.
2. Phase 4 (users add keys), then Phase 5.
3. Phase 6: remove DeepSeek and the switch. Skip the switch if a demo isn't coming up soon.
