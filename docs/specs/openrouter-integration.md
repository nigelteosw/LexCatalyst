# Spec: OpenRouter key security and model switching

Status: proposed · 2026-10-08

## Goal

1. Store each user's OpenRouter key so that a database leak alone reveals nothing usable, and the key is never sent back to the browser.
2. Make choosing and switching models in Settings fast and clear: search, compare, save favourites, and see which model each feature will actually use.

## Non-goals

- A firm-wide OpenRouter key. Every call stays on the acting user's own key.
- Changing embeddings (they stay on OpenAI).
- Adding tiers beyond High and Mid.
- OpenRouter OAuth (PKCE) sign-in. Worth doing later; see "Future".

## Why not a plain hash

A hash is one-way. We have to send the real key to OpenRouter on every call, so a hash alone cannot be the stored form. What we can do:

- **Encrypt** the key for use (reversible only with a secret that never lives in the database).
- **Hash** the key for everything else: identifying it, showing it, checking for duplicates and auditing changes, without decrypting it.

So the stored record is *encrypted key + keyed hash (fingerprint)*. The plaintext only exists in memory for the length of an OpenRouter request.

## Current state

- `UserSetting.openrouter_api_key` (`backend/app/models.py:1001`) is Fernet-encrypted through `field_encryption.encrypt_text`, under `FIELD_ENCRYPTION_KEY` (`enc:v1:`) or, in development, a key derived from `JWT_SECRET_KEY` (legacy `enc:`).
- The same key encrypts every PII field (client names etc.). One leaked secret exposes everything.
- `llm_settings_payload` decrypts the key just to show `key_last4`.
- No key check on save: a bad key only fails on the first chat.
- Settings shows two free-text/autocomplete fields for High and Mid plus a per-feature tier toggle. No search by provider, price or context length, no favourites, no indication of which model a feature resolves to.

## Backend design

### Storage

New columns on `user_settings` (Alembic migration, then drop the old column):

| Column | Type | Purpose |
|---|---|---|
| `openrouter_key_ciphertext` | `Text` | AES-256-GCM ciphertext, `v2:<key_id>:<nonce>:<ct>` |
| `openrouter_key_fingerprint` | `String(64)` | `HMAC-SHA256(KEY_FINGERPRINT_SECRET, key)` hex |
| `openrouter_key_last4` | `String(4)` | Display only, stored at save time |
| `openrouter_key_label` | `String(120)`, nullable | OpenRouter's label for the key, from `/api/v1/key` |
| `openrouter_key_verified_at` | `DateTime`, nullable | Last successful check |
| `openrouter_key_status` | `String(20)` | `valid`, `invalid`, `rate_limited`, `unchecked` |

Rules:

- **Separate secret.** New env var `OPENROUTER_KEY_ENCRYPTION_KEY` (32 random bytes, base64). Config refuses to start without it outside development, like `FIELD_ENCRYPTION_KEY`. A database dump plus a PII-key leak still does not give OpenRouter keys.
- **Associated data.** Encrypt with `user_id` as AES-GCM associated data, so a ciphertext copied onto another user's row will not decrypt.
- **Key rotation.** `key_id` in the ciphertext names which secret encrypted it. `OPENROUTER_KEY_ENCRYPTION_KEYS_OLD` (comma-separated) can still decrypt; a `make rotate-openrouter-keys` script re-encrypts under the current one.
- **Fingerprint, not plaintext, for everything else.** Last-4, label and status are read from their own columns. Nothing outside `llm_service.key_for` decrypts the key.
- **Never return the key.** API responses carry only `has_key`, `key_last4`, `key_label`, `key_status`, `key_verified_at`, `key_source`.
- **Never log it.** Add a logging filter that masks `sk-or-` tokens, and make sure `OpenRouterProvider` errors don't echo headers.

New module `backend/app/services/secret_store.py`:

```py
encrypt_secret(plaintext: str, *, user_id: str) -> str
decrypt_secret(ciphertext: str, *, user_id: str) -> str
fingerprint(plaintext: str) -> str
```

`UserSetting.openrouter_api_key` keeps its property name so callers don't change, but reads/writes through `secret_store`.

### Validation on save

`PUT /settings/llm` with a new key:

1. Strip, check prefix `sk-or-` and length.
2. Call `GET https://openrouter.ai/api/v1/key` with the key (5 s timeout). 200 → store with status `valid` and the returned label/limit; 401 → reject with 400 "OpenRouter rejected this key"; network error → store with status `unchecked` and a warning.
3. If the fingerprint matches the stored one, skip re-encryption and just refresh status.

New route: `POST /settings/llm/openrouter-key/verify` (authenticated, own key only) re-runs the check and returns the payload. Also returns remaining credit if OpenRouter reports it.

### Migration

1. Alembic adds the new columns.
2. A data migration decrypts each existing `openrouter_api_key` with `field_encryption.decrypt_text`, writes ciphertext, fingerprint and last-4, sets status `unchecked`.
3. A follow-up migration drops `openrouter_api_key` once deployed.
4. Update the "Current head" line in `AGENTS.md`.

## Model selection design

### Data

Extend `list_openrouter_models()` to return, per model: `id`, `name`, `provider` (prefix before `/`), `context_length`, `prompt_price_per_million`, `completion_price_per_million`, `supports_tools` (from `supported_parameters`), `created`. Tool support matters: LexChat's tool loop needs it.

New `user_settings` column `favourite_models` (`JSONB`, list of ids, max 12).

### Validation

On saving `model_high` / `model_mid`, check the id is in the cached catalogue. Unknown ids are still accepted (OpenRouter may be ahead of our cache) but flagged `unverified` in the response. Warn, don't block, if the High/Mid model lacks tool support and LexChat or Birdie use that tier.

### API

| Route | Auth | Change |
|---|---|---|
| `GET /settings/llm/models` | user | Adds the new fields above; optional `?q=`, `?provider=`, `?tools=true` |
| `PUT /settings/llm` | user | Accepts `favourite_models`; validates key and models as above |
| `POST /settings/llm/openrouter-key/verify` | user | New, see above |
| `GET /settings/llm` | user | Adds `resolved` map: feature → `{tier, model}` |

### Settings UI (`frontend/src/features/settings/ModelSettingsSection.tsx`)

Split into three cards:

1. **OpenRouter key.** Status chip (Valid / Invalid / Not checked), label and `…last4`, "Verify", "Replace", "Remove". Password-style input; the key is cleared from state right after save. Keep the disclosure that prompts and document excerpts go to OpenRouter and the chosen provider.
2. **Models.** Two slots, High and Mid. Each opens a picker dialog:
   - Search box (name, id, provider), filters for provider, "supports tools", max price.
   - Rows show name, provider, context length, input/output price per million, tools badge.
   - Favourites pinned at the top with a star toggle; "Recent" section for the last few picked.
   - "Reset to default" shows the env default.
   - Free-text fallback for ids not in the list.
3. **Features.** Table of `FEATURES`: label, High/Mid segmented control, and the resolved model name in grey so the effect is visible. "Reset all to defaults".

Composer pill (LexChat, Birdie): keep High/Mid, add a tooltip showing the resolved model, and a "Change…" link to Settings → Models. Optionally let the pill list favourites as a one-off override for that prompt (sends `model` explicitly; `resolve_model` already accepts it).

All calls go through `shared/api/api.ts` with camelCase mapping; use the existing `bg-accent` and `font-serif` tokens, not hex values.

## Testing

- `secret_store`: round trip, wrong `user_id` fails, old key id decrypts after rotation, fingerprint stable.
- Settings routes: response never contains the key; invalid key rejected; unchecked on network error.
- Migration: existing `enc:` / `enc:v1:` keys come through readable.
- Log filter masks `sk-or-...`.
- Frontend: picker search/filter, favourites persist, resolved model updates after a tier change.

## Rollout

1. Backend storage + migration + verify route (no UI change needed; payload is backward compatible).
2. Settings UI cards and model picker.
3. Composer tooltip and favourite overrides.
4. Drop the old column; update README env vars (`OPENROUTER_KEY_ENCRYPTION_KEY`, `OPENROUTER_KEY_ENCRYPTION_KEYS_OLD`, `KEY_FINGERPRINT_SECRET`) and the route docs.

## Future

- OpenRouter OAuth PKCE so users connect without pasting a key.
- Per-user spend shown from OpenRouter's key endpoint.
- A KMS (e.g. cloud-provider key management) holding the encryption key instead of an env var.
