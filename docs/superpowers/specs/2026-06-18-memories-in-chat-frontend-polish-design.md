# Memories in Chat + Frontend Polish

**Date:** 2026-06-18  
**Status:** Approved

## Goal

Move the Memories entry point from the sidebar nav into the chat view, and apply a focused round of frontend polish.

## Changes

### 1. Memory button in chat header (`App.tsx`, `Sidebar.tsx`)

- Add a `Brain` icon button (icon-only, `aria-label="Memories"`) to the right side of the chat header, after the model switcher
- Clicking it calls `selectMemories()` from `useWorkspaceNavigation()`
- Fully visible on mobile — icon-only so it fits in the compact header row
- Remove the "Memories" `<button>` from the sidebar nav section in `Sidebar.tsx` (currently lines ~298–311)
- Remove the `memories` prefetch case from `prefetchWorkspace` in `Sidebar.tsx`
- Remove `selectMemories` from the `useWorkspaceNavigation()` destructure in `Sidebar.tsx`
- The `/memories` route and `MemoriesPanel` component are untouched

### 2. Remove redundant logout from chat header (`App.tsx`)

- Remove the `Log out` button from the chat header (lines ~675–683)
- Logout remains accessible in the sidebar footer
- Chat header right side becomes: `[matter select] [model switcher] [Brain button]`

### 3. General frontend polish

- **Chat empty state**: improve visual hierarchy — tighter spacing, slightly larger logo container, subtitle text refined
- **ToolStepRow**: sharpen pill — consistent border radius, slightly warmer background, cleaner icon/text alignment
- **Sidebar**: minor spacing/opacity consistency — section label tracking, thread dot alignment
- **MemoriesPanel**: tighten the category section spacing, ensure empty-state placeholder is visually consistent with the rest of the app

## Out of scope

- No new routes, no new components, no API changes
- The memories panel itself keeps all existing functionality (Dream, add, edit, delete)
- No changes to the wiki, documents, wellbeing, or knowledge bank panels
