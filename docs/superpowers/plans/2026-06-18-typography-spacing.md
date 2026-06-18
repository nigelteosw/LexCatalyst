# Typography & Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic Inter-only look with Playfair Display serif headings and fix the three densest spacing areas to create an unhurried, lawyer-appropriate UI.

**Architecture:** Pure CSS/JSX changes across 5 files — no new components, no new npm packages. Font loaded via Google Fonts CDN. Tailwind's existing `font-serif` utility class is already used in the codebase; this plan wires it to Playfair Display and extends its use to PanelHeader titles.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Vite, Bun, Google Fonts CDN

## Global Constraints

- Use `bun` not `npm` for all commands
- No new npm/bun packages — Playfair Display loaded via Google Fonts CDN only
- Inter stays unchanged as the body/UI font
- No changes to component logic, API calls, or dark-theme sidebar colours
- All Tailwind class changes must use exact values from this plan — no improvisation

---

### Task 1: Load Playfair Display and wire the serif CSS variable

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: `font-serif` Tailwind utility class resolves to `"Playfair Display", Georgia, serif` everywhere in the app

- [ ] **Step 1: Add Google Fonts preconnect and stylesheet to `index.html`**

Open `frontend/index.html`. Find the `<head>` section. Add these three lines immediately before the closing `</head>` tag (or after any existing `<link>` tags):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Update the serif CSS variable in `index.css`**

Open `frontend/src/index.css`. Find the `@theme` block:

```css
@theme {
  --font-sans: "Inter", "Aptos", "Helvetica Neue", Helvetica, sans-serif;
}
```

Replace it with:

```css
@theme {
  --font-sans: "Inter", "Aptos", "Helvetica Neue", Helvetica, sans-serif;
  --font-serif: "Playfair Display", Georgia, serif;
}
```

- [ ] **Step 3: Start dev server and visually verify**

```bash
cd frontend && bun run dev
```

Open the app. Confirm:
- Sidebar "LexCatalyst" brand text and "L" monogram render in Playfair Display italic (they already use `font-serif italic`)
- Home hero greeting h1 renders in Playfair Display italic
- All body text (buttons, labels, chat messages) remains Inter
- No layout shifts or flash of unstyled text on load

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/index.css
git commit -m "feat: load Playfair Display, wire font-serif CSS variable"
```

---

### Task 2: Apply Playfair Display to PanelHeader and increase its padding

**Files:**
- Modify: `frontend/src/shared/ui/PanelHeader.tsx`

**Interfaces:**
- Consumes: `font-serif` resolves to Playfair Display (Task 1)
- Produces: every panel header (Memories, Documents, Knowledge Bank, Workboard, Wellbeing, Settings) shows a Playfair Display title with more vertical breathing room

- [ ] **Step 1: Update the header `<header>` padding**

Open `frontend/src/shared/ui/PanelHeader.tsx`. Find:

```tsx
<header
  className={`flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-2 lg:px-6 ${className}`}
>
```

Change `py-2` to `py-3`:

```tsx
<header
  className={`flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3 lg:px-6 ${className}`}
>
```

- [ ] **Step 2: Apply font-serif to the panel title**

In the same file, find:

```tsx
<h2 className="truncate text-sm font-semibold text-neutral-900">{title}</h2>
```

Replace with:

```tsx
<h2 className="truncate font-serif text-base font-semibold text-neutral-900">{title}</h2>
```

- [ ] **Step 3: Visually verify all affected panels**

With dev server running, navigate to each panel and confirm:
- Memories, Documents, Knowledge Bank, Workboard, Wellbeing, Settings: all show a Playfair Display title at `text-base` size
- Header has comfortable vertical padding (8px more than before)
- No text overflow or truncation issues on any panel
- Action buttons (e.g. "Add Memory", "Dream") remain correctly right-aligned

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/ui/PanelHeader.tsx
git commit -m "polish: apply Playfair Display + more padding to PanelHeader"
```

---

### Task 3: HomePanel feature rows and sidebar section label sizes

**Files:**
- Modify: `frontend/src/features/home/HomePanel.tsx`
- Modify: `frontend/src/features/navigation/Sidebar.tsx`

**Interfaces:**
- No interface changes — pure visual polish

- [ ] **Step 1: Break feature row label+description onto two lines**

Open `frontend/src/features/home/HomePanel.tsx`. Find the feature row button (inside the `FEATURES.map(...)` block):

```tsx
<button
  key={label}
  className="group flex w-full items-center gap-4 py-3.5 text-left transition-colors hover:bg-neutral-50"
  onClick={() => navigate(navKey)}
  type="button"
>
  <div className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 transition group-hover:text-neutral-700">
    <Icon size={16} />
  </div>
  <div className="min-w-0 flex-1">
    <span className="text-sm font-medium text-neutral-900">{label}</span>
    <span className="ml-2.5 text-xs text-neutral-400">{description}</span>
  </div>
  <ArrowRight
    size={13}
    className="mr-1 shrink-0 text-neutral-200 transition group-hover:translate-x-0.5 group-hover:text-neutral-400"
  />
</button>
```

Replace with:

```tsx
<button
  key={label}
  className="group flex w-full items-center gap-4 py-5 text-left transition-colors hover:bg-neutral-50"
  onClick={() => navigate(navKey)}
  type="button"
>
  <div className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 transition group-hover:text-neutral-700">
    <Icon size={16} />
  </div>
  <div className="min-w-0 flex-1">
    <span className="block text-sm font-medium text-neutral-900">{label}</span>
    <span className="block text-xs text-neutral-400">{description}</span>
  </div>
  <ArrowRight
    size={13}
    className="mr-1 shrink-0 text-neutral-200 transition group-hover:translate-x-0.5 group-hover:text-neutral-400"
  />
</button>
```

Key changes: `py-3.5` → `py-5`, `<span>` elements get `block` class, description `ml-2.5` removed.

- [ ] **Step 2: Fix sidebar section label sizes**

Open `frontend/src/features/navigation/Sidebar.tsx`. There are two section label `<div>` elements — one for "Recent matters" and one for "Recent LexChats". Both use `text-[11px]`. Change both from `text-[11px]` to `text-xs`.

Find:
```tsx
<div className="mb-1 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.09em] text-white/30">
  <BriefcaseBusiness size={11} />
  Recent matters
</div>
```

Change `text-[11px]` to `text-xs`:
```tsx
<div className="mb-1 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.09em] text-white/30">
  <BriefcaseBusiness size={11} />
  Recent matters
</div>
```

Find:
```tsx
<div className="mb-1 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.09em] text-white/30">
  <Clock size={11} />
  Recent LexChats
</div>
```

Change `text-[11px]` to `text-xs`:
```tsx
<div className="mb-1 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.09em] text-white/30">
  <Clock size={11} />
  Recent LexChats
</div>
```

- [ ] **Step 3: Visually verify**

With dev server running:
- Home page: confirm feature rows show label on first line and description on second line, with generous vertical padding between rows
- Sidebar: confirm "Recent matters" and "Recent LexChats" labels are slightly more legible than before
- No layout regressions on mobile (check DevTools responsive mode at 390px width)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/home/HomePanel.tsx frontend/src/features/navigation/Sidebar.tsx
git commit -m "polish: two-line feature rows, readable sidebar section labels"
```
