# UI Consistency Audit & Proposed Token System

**Date:** 2026-10-06
**Scope:** `frontend/` — typography, color, and type-scale consistency across the whole app
**Status:** Audit only. No code changed. This doc proposes the target token system and a migration plan.

---

## TL;DR

The app already has a tasteful, coherent visual identity — a warm cream surface, near-black ink, a muted warm-gray text ramp, a navy accent, and a small set of semantic tints (green / red / amber / purple), paired with Playfair Display as the display face. The problem is **that identity is expressed three different ways instead of once**:

1. **The intended body font (Inter) never loads.** It's declared in `--font-sans` but is neither linked as a webfont nor bundled, so every screen silently renders in Aptos → Helvetica.
2. **Two type-size systems coexist** — Tailwind's named scale (`text-xs/sm/base…`, ~380 uses) and **228 hardcoded pixel sizes across 11 distinct values**.
3. **Three color systems coexist** — ~553 raw hex literals, ~250 Tailwind `neutral-*/slate-*` utilities, and 3 `@theme` tokens — with duplicate "blacks," an uncoordinated gray ramp, and two competing page surfaces.

The fix is not a redesign. It's: **load Inter, promote the palette and type scale that already exist into named tokens, then migrate the literals onto those tokens.**

---

## Findings

### 1. Typography

| Issue | Evidence | Impact |
|---|---|---|
| **Inter never loads** | `index.css:4` declares `--font-sans: "Inter", "Aptos", …`; `index.html` only links Playfair Display; no `*.woff/ttf` bundled. | The whole app renders in the wrong typeface (Aptos→Helvetica). Highest-impact single fix. |
| **Two type-size systems** | ~380 uses of `text-xs/sm/base/lg/xl…` **plus** 228 arbitrary `text-[Npx]` across 11 values: `9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 15, 17px`. | `.5px` values are eyeballed one-offs; no rhythm between screens. |
| Playfair (display) | Used intentionally in 13 feature files via `font-serif`. | ✅ Consistent — keep as-is. |

**Arbitrary font-size hotspots** (files to touch first):

```
40  features/birdie/BirdiePanel.tsx
32  features/actions/components/ReviewPane.tsx
26  features/actions/components/AnnotationRail.tsx
14  features/navigation/Sidebar.tsx
14  features/actions/components/ActionDetailDialog.tsx
13  features/knowledge-bank/KnowledgeBankPanel.tsx
13  features/actions/ActionsPanel.tsx
12  features/wellbeing/WellbeingPanel.tsx
```

### 2. Color

| Family | Literals found (count) | Problem |
|---|---|---|
| **Ink / black** | `#0f0f0f` (76), `#171717` (5, the `:root` value), `#1a1a1a` (3), `#2a2a28`, `#292925`, `#333`, `#111827` | Three+ "blacks"; `:root` color (`#171717`) differs from the dominant ink (`#0f0f0f`). |
| **Warm gray ramp** | `#5a5a56` (60), `#76766f` (83), `#6f6f69` (19), `#8c8c86` (25), `#8a8a84` (11), `#aaa9a3` (7), `#9a9a94`, `#777770`, `#666660`, `#4f4f49` | Un-stepped ramp — ~10 near-identical grays doing the same job. |
| **Tailwind neutrals** | `neutral-500` (87), `neutral-900` (50), `neutral-400` (33), `neutral-600` (28)… + `slate-600` | A *second* gray system layered on the hex grays (cool vs. the warm hexes). |
| **Surfaces** | `#fafaf8` (22, the token), `#f4f3ef` (48 — used **more** than the token), `#eeecea` (8), `#f9f8f5`, `#f7f6f3`, `#fcfcfa`, `#e8e8e4`, `#d4d4d0` | Two competing page surfaces; no named "raised/card" surface. |
| **Accent (navy)** | `#1e3a8a` (41, token ✅), `#172e6e` (7, hover token ✅), `#1a4a8a` (7, stray), `#1d4ed8`, `#2e2585`; tint `#e8f0fe` (3) | Mostly consistent; one stray variant + an un-named tint. |
| **Success (green)** | `#1a6b4a` (29), `#2d9e6b` (14), `#155a3e`, `#14583d`; tints `#e8f5ee` (10), `#c8e6d7` (3), `#d0edde` | Coherent but never tokenized. |
| **Danger (red)** | `#8a1f1f` (15), `#8a2621`, `#9f1239`; tint `#fdeeed` (13) | Coherent but never tokenized. |
| **Warning (amber)** | `#8a5a00` (9), `#805400`, `#f0a000`, `#f59e0b`; tints `#fef3dc` (4), `#fff8d8` | Coherent but never tokenized. |
| **Purple (info/birdie)** | `#4a3db0` (11), `#2e2585`, `#7d7893`; tint `#eeecff` (7) | Coherent but never tokenized. |

Delivery: **551 of 553** hex values are applied via Tailwind arbitrary classes (`text-[#…]`, `bg-[#…]`), only 2 via inline `style`. That makes migration mechanical — swap `text-[#0f0f0f]` → `text-ink`, etc.

---

## Proposed token system

Add to `frontend/src/index.css` `@theme`. Naming them in `@theme` makes them available as Tailwind utilities automatically (`text-ink`, `bg-surface-raised`, `border-line`, `text-success`, …).

```css
@theme {
  /* Type families */
  --font-sans: "Inter", "Aptos", "Helvetica Neue", Helvetica, sans-serif;
  --font-serif: "Playfair Display", Georgia, serif;

  /* Type scale — collapses the 11 arbitrary px sizes into 7 steps */
  --text-micro: 0.625rem;   /* 10px  <- 9, 9.5, 10, 10.5 */
  --text-mini:  0.6875rem;  /* 11px  <- 11, 11.5 */
  --text-xs:    0.75rem;    /* 12px  <- 12, 12.5, 13 (Tailwind default) */
  --text-sm:    0.875rem;   /* 14px  <- 15 (Tailwind default) */
  --text-base:  1rem;       /* 16px  <- 17 (Tailwind default) */
  --text-lg:    1.125rem;   /* 18px */
  /* xl/2xl/3xl/4xl: keep Tailwind defaults for Playfair display headings */

  /* Ink + warm gray ramp (text) */
  --color-ink:        #0f0f0f;  /* primary text  (was #0f0f0f/#171717/#1a1a1a) */
  --color-ink-soft:   #5a5a56;  /* strong secondary */
  --color-muted:      #76766f;  /* secondary / labels */
  --color-subtle:     #8c8c86;  /* tertiary / placeholder */
  --color-faint:      #aaa9a3;  /* disabled / hints */

  /* Surfaces + lines */
  --color-surface:        #fafaf8;  /* page background */
  --color-surface-raised: #f4f3ef;  /* cards, panels, inputs */
  --color-surface-sunken: #eeecea;  /* hover / wells */
  --color-line:           #e8e8e4;  /* hairline borders */

  /* Accent (navy) */
  --color-accent:       #1e3a8a;
  --color-accent-hover: #172e6e;
  --color-accent-tint:  #e8f0fe;

  /* Semantic */
  --color-success:      #1a6b4a;  --color-success-strong: #2d9e6b;  --color-success-tint: #e8f5ee;
  --color-danger:       #8a1f1f;  --color-danger-tint:    #fdeeed;
  --color-warning:      #8a5a00;  --color-warning-tint:   #fef3dc;
  --color-info:         #4a3db0;  --color-info-tint:      #eeecff;  /* purple / birdie */
}
```

### Literal → token mapping (migration key)

**Blacks → `ink`:** `#0f0f0f`, `#171717`, `#1a1a1a`, `#2a2a28`, `#292925`, `#333`, `#111827`
**Grays → ramp:** `#5a5a56`→`ink-soft` · `#76766f`,`#6f6f69`,`#666660`→`muted` · `#8c8c86`,`#8a8a84`,`#9a9a94`→`subtle` · `#aaa9a3`→`faint`
**Tailwind neutrals → ramp:** `neutral-900/950`→`ink` · `neutral-600/700/800`→`ink-soft` · `neutral-500`→`muted` · `neutral-400`→`subtle` · `slate-*`→nearest ramp step
**Surfaces:** `#fafaf8`→`surface` · `#f4f3ef`,`#f9f8f5`,`#f7f6f3`→`surface-raised` · `#eeecea`,`#e8e8e4`→`surface-sunken`/`line`
**Accent:** `#1e3a8a`,`#1a4a8a`→`accent` · `#172e6e`→`accent-hover` · `#e8f0fe`→`accent-tint`
**Semantic:** greens→`success`/`success-strong`/`success-tint` · reds→`danger`/`danger-tint` · ambers→`warning`/`warning-tint` · purples→`info`/`info-tint`

### Font-size mapping (migration key)

`text-[9px]`,`[9.5px]`,`[10px]`,`[10.5px]` → `text-micro`
`text-[11px]`,`[11.5px]` → `text-mini`
`text-[12px]`,`[12.5px]`,`[13px]` → `text-xs`
`text-[15px]` → `text-sm`
`text-[17px]` → `text-base`

---

## Migration plan (when approved)

**Phase 0 — Foundation (1 commit, low risk)**
1. Link Inter in `index.html` (weights 400/500/600/700) alongside Playfair.
2. Set `:root { color: var(--color-ink); }` so the root matches the ink token.
3. Add all tokens above to `@theme`.
*No visual regression expected except the (intended) switch to Inter.*

**Phase 1 — Type scale**
4. Replace the 228 `text-[Npx]` literals per the font-size key. Start with the hotspot files (BirdiePanel, ReviewPane, AnnotationRail).

**Phase 2 — Color, by family** (one commit per family keeps diffs reviewable)
5. Ink/blacks → `ink`.
6. Gray ramp + Tailwind neutrals → ramp tokens.
7. Surfaces + lines.
8. Accent + semantic tints.

**Phase 3 — Verify**
9. `bun run build` + typecheck.
10. Screenshot each panel at desktop + mobile (Playwright config already present) and diff against pre-migration.
11. Grep guard: assert no raw `text-[#`, `bg-[#`, or `text-[Npx]` remain (optionally add an ESLint rule / CI grep to prevent regressions).

## Open questions for the build pass
- **Warm vs. cool gray:** the hex grays are warm (`#76766f`), Tailwind `neutral-*` is near-neutral, `slate-*` is cool. Proposal standardizes on the **warm** ramp to match the cream surface. Confirm.
- **`#f4f3ef` as the canonical card surface** (used 48×) — confirm it should be `surface-raised` rather than collapsing to `surface`.
- Whether to self-host Inter (no FOUT, no external request) vs. Google Fonts link (simplest). Current Playfair uses the Google link.
