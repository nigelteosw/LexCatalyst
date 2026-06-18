# Typography & Spacing Design

**Date:** 2026-06-18  
**Status:** Approved

## Goal

Replace the generic Inter-only look with a modern editorial typography system (Playfair Display serif headings + Inter body), and fix the three densest spacing areas to produce an unhurried, visually uncluttered UI that reads as trustworthy to a legal audience.

## Typography

### Font loading

Add Playfair Display via Google Fonts to `frontend/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet">
```

### CSS variable

In `frontend/src/index.css`, update the existing `--font-serif` theme variable:

```css
@theme {
  --font-sans: "Inter", "Aptos", "Helvetica Neue", Helvetica, sans-serif;
  --font-serif: "Playfair Display", Georgia, serif;
}
```

Also update the fallback `font-family` declaration in `:root` to keep it consistent (Inter unchanged; only serif fallback changes):

```css
:root {
  font-family: "Inter", Aptos, "Helvetica Neue", Helvetica, sans-serif;
  /* Playfair Display is applied via the font-serif utility class */
}
```

### Automatic upgrades (no code changes needed)

The following elements already use `font-serif` and will upgrade automatically:
- Sidebar "LexCatalyst" branding + "L" monogram (`font-serif italic`)
- Home hero greeting h1 (`font-serif italic`)

### PanelHeader title

In `frontend/src/shared/ui/PanelHeader.tsx`, change the `<h2>` from:
```tsx
<h2 className="truncate text-sm font-semibold text-neutral-900">{title}</h2>
```
to:
```tsx
<h2 className="truncate font-serif text-base font-semibold text-neutral-900">{title}</h2>
```

This applies to every panel simultaneously (Memories, Documents, Knowledge Bank, Workboard, Wellbeing, Settings).

## Spacing

### PanelHeader padding

In `frontend/src/shared/ui/PanelHeader.tsx`, increase vertical padding from `py-2` to `py-3`:

```tsx
<header className={`flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3 lg:px-6 ${className}`}>
```

### HomePanel feature list rows

In `frontend/src/features/home/HomePanel.tsx`, break the inline label+description into two lines and increase row padding:

From:
```tsx
<button className="group flex w-full items-center gap-4 py-3.5 text-left ...">
  ...
  <div className="min-w-0 flex-1">
    <span className="text-sm font-medium text-neutral-900">{label}</span>
    <span className="ml-2.5 text-xs text-neutral-400">{description}</span>
  </div>
```

To:
```tsx
<button className="group flex w-full items-center gap-4 py-5 text-left ...">
  ...
  <div className="min-w-0 flex-1">
    <span className="block text-sm font-medium text-neutral-900">{label}</span>
    <span className="block text-xs text-neutral-400">{description}</span>
  </div>
```

### Sidebar section labels

In `frontend/src/features/navigation/Sidebar.tsx`, change the two section label text sizes from `text-[11px]` to `text-xs` (applies to "Recent matters" and "Recent LexChats" labels):

```tsx
// Before
<div className="... text-[11px] font-medium uppercase tracking-[0.09em] text-white/30">

// After  
<div className="... text-xs font-medium uppercase tracking-[0.09em] text-white/30">
```

## Out of scope

- No changes to Inter (body text, UI labels, buttons remain Inter)
- No changes to MemoriesPanel, SettingsPanel, KnowledgeBankPanel, or ChatPanel spacing (already adequate)
- No changes to sidebar dark theme colours
- No new npm/bun packages beyond Google Fonts CDN
