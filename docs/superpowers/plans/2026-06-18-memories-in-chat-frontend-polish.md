# Memories in Chat + Frontend Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Memories entry point from the sidebar nav into the chat header as a Brain icon button, and apply focused frontend polish.

**Architecture:** Pure UI changes — no new routes, no new components, no API changes. The `/memories` route and `MemoriesPanel` stay untouched. Changes are confined to `App.tsx`, `Sidebar.tsx`, `ChatPanel.tsx`, and `MemoriesPanel.tsx`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, Bun, lucide-react

## Global Constraints

- Use `bun` not `npm` for all package/dev-server commands
- No new dependencies
- No new components or files — modify existing only
- The `/memories` route and `MemoriesPanel` are untouched (only the nav entry point moves)
- All icon sizes and button variants must follow existing patterns (`size="icon"`, `variant="ghost"`)

---

### Task 1: Remove Memories from sidebar nav

**Files:**
- Modify: `frontend/src/features/navigation/Sidebar.tsx`

**Interfaces:**
- Produces: sidebar with no Memories nav item; `selectMemories` no longer called anywhere in this file

- [ ] **Step 1: Remove `Brain` from lucide-react import**

In `Sidebar.tsx`, find:
```ts
import {
  BookMarked,
  Brain,
  BriefcaseBusiness,
```
Change to:
```ts
import {
  BookMarked,
  BriefcaseBusiness,
```

- [ ] **Step 2: Remove `selectMemories` from the `useWorkspaceNavigation` destructure**

Find (around line 78):
```ts
const {
  current,
  selectHome,
  selectThread,
  selectMemories,
  selectDocuments,
  selectKnowledgeBank,
  selectWellbeing,
  selectActions,
  selectSettings,
} = useWorkspaceNavigation()
```
Change to:
```ts
const {
  current,
  selectHome,
  selectThread,
  selectDocuments,
  selectKnowledgeBank,
  selectWellbeing,
  selectActions,
  selectSettings,
} = useWorkspaceNavigation()
```

- [ ] **Step 3: Remove `memories` case from `prefetchWorkspace`**

Find and remove this block inside `prefetchWorkspace`:
```ts
if (view === 'memories') {
  queryClient.prefetchQuery({ queryKey: ['memories'], queryFn: () => listMemories() })
  return
}
```

Also update the function's parameter type — find:
```ts
function prefetchWorkspace(view: 'documents' | 'knowledge_bank' | 'memories' | 'wellbeing' | 'actions') {
```
Change to:
```ts
function prefetchWorkspace(view: 'documents' | 'knowledge_bank' | 'wellbeing' | 'actions') {
```

- [ ] **Step 4: Remove the Memories nav button**

Find and delete this entire `<button>` block (approximately lines 298–311):
```tsx
<button
  onClick={() => {
    selectMemories()
    closeMobile()
  }}
  onFocus={() => prefetchWorkspace('memories')}
  onMouseEnter={() => prefetchWorkspace('memories')}
  className={`${sidebarActionClass} ${
    current.view === 'memories' ? sidebarNavActiveClass : sidebarNavClass
  }`}
  type="button"
>
  <Brain size={14} />
  Memories
</button>
```

- [ ] **Step 5: Check `listMemories` import is still used**

`listMemories` is imported at the top of `Sidebar.tsx`. Grep to confirm it's used elsewhere (it's used in the `prefetchWorkspace` `memories` branch we just removed). Remove the import if it's no longer referenced:

Find in the import block:
```ts
  listMemories,
```
Delete that line.

- [ ] **Step 6: Start dev server and visually verify**

```bash
cd frontend && bun run dev
```

Open the app. Confirm:
- "Memories" is gone from the workspace nav in the sidebar
- No TypeScript errors in terminal
- All other nav items still work

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/navigation/Sidebar.tsx
git commit -m "feat: remove Memories from sidebar nav"
```

---

### Task 2: Add Brain button to chat header

**Files:**
- Modify: `frontend/src/app/App.tsx`

**Interfaces:**
- Consumes: `selectMemories` from `useWorkspaceNavigation`
- Produces: a `Brain` icon button in the chat header that navigates to `/memories`; `Log out` button removed from chat header

- [ ] **Step 1: Add `Brain` to the lucide-react import in `App.tsx`**

Find:
```ts
import { Gauge, Menu, Sparkles } from 'lucide-react'
```
Change to:
```ts
import { Brain, Gauge, Menu, Sparkles } from 'lucide-react'
```

- [ ] **Step 2: Add `selectMemories` to the `useWorkspaceNavigation` destructure**

Find (around line 129):
```ts
const {
  current,
  isKnownRoute,
  selectHome,
  selectThread,
  startNewChat,
} = useWorkspaceNavigation()
```
Change to:
```ts
const {
  current,
  isKnownRoute,
  selectHome,
  selectMemories,
  selectThread,
  startNewChat,
} = useWorkspaceNavigation()
```

- [ ] **Step 3: Remove the `Log out` button from the chat header**

Find this block inside the chat header's right-side `<div className="flex items-center gap-2">`:
```tsx
<Button
  className="hidden sm:inline-flex"
  onClick={handleLogout}
  size="sm"
  variant="secondary"
>
  Log out
</Button>
```
Delete the entire `<Button>` block.

- [ ] **Step 4: Add the Brain button after the model switcher**

In the same `<div className="flex items-center gap-2">`, after the model switcher `<div aria-label="Chat model" ...>` closing `</div>`, add:
```tsx
<Button
  aria-label="Memories"
  onClick={selectMemories}
  size="icon"
  title="Memories"
  variant="ghost"
>
  <Brain size={18} />
</Button>
```

The right-side group should now read:
```tsx
<div className="flex items-center gap-2">
  <select
    aria-label="Active matter"
    className="hidden h-8 max-w-56 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs text-neutral-600 outline-none focus:border-neutral-400 md:block"
    onChange={(event) => handleMatterChange(event.target.value || null)}
    value={selectedMatterId ?? ''}
  >
    <option value="">No matter selected</option>
    {matters.map((matter) => (
      <option key={matter.id} value={matter.id}>
        {matter.caseNumber} · {matter.title}
      </option>
    ))}
  </select>
  <div
    className="flex items-center rounded-xl bg-neutral-100 p-1"
    aria-label="Chat model"
  >
    {CHAT_MODELS.map((model) => {
      const isSelected = selectedModel === model.id
      return (
        <Button
          key={model.id}
          aria-pressed={isSelected}
          title={model.description}
          onClick={() => handleModelChange(model.id)}
          className="sm:px-2.5"
          size="sm"
          variant={isSelected ? 'selected' : 'secondary'}
        >
          {model.id === 'deepseek-v4-flash' ? (
            <Gauge size={14} />
          ) : (
            <Sparkles size={14} />
          )}
          <span className="hidden sm:inline">{model.label}</span>
        </Button>
      )
    })}
  </div>
  <Button
    aria-label="Memories"
    onClick={selectMemories}
    size="icon"
    title="Memories"
    variant="ghost"
  >
    <Brain size={18} />
  </Button>
</div>
```

- [ ] **Step 5: Visually verify on desktop and mobile**

With dev server running:
- Desktop: confirm Brain button appears in chat header right side, Log out is gone, clicking Brain navigates to /memories
- Mobile (DevTools → responsive mode, width ~390px): confirm Brain button is visible and tappable in the compact header row
- Navigate back from /memories using the sidebar or browser back — confirm it works

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/App.tsx
git commit -m "feat: add Memories button to chat header, remove redundant logout"
```

---

### Task 3: Frontend polish — chat UI

**Files:**
- Modify: `frontend/src/features/chat/ChatPanel.tsx`

**Interfaces:**
- No interface changes — pure visual polish

- [ ] **Step 1: Polish the chat empty state**

Find the empty state block (inside the `messages.length > 0` else branch):
```tsx
<div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4 text-center">
  <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-sky-50 shadow-sm ring-1 ring-sky-100">
    <img
      alt=""
      aria-hidden="true"
      className="h-auto w-[155%] max-w-none"
      src={lexChatLogo}
    />
  </div>
  <div className="space-y-3">
    <h3 className="text-xl font-semibold text-neutral-900">Welcome to LexChat</h3>
    <p className="text-sm text-neutral-500 max-w-sm">
      I can help you analyze legal documents, research case law, or draft professional correspondence.
    </p>
    <div className="flex justify-center">
      <FeatureHelp title="LexChat" content={CHAT_HELP} />
    </div>
  </div>
</div>
```

Replace with:
```tsx
<div className="flex min-h-[50vh] flex-col items-center justify-center space-y-6 text-center">
  <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-3xl bg-sky-50 shadow-md ring-1 ring-sky-100">
    <img
      alt=""
      aria-hidden="true"
      className="h-auto w-[155%] max-w-none"
      src={lexChatLogo}
    />
  </div>
  <div className="space-y-3">
    <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Welcome to LexChat</h3>
    <p className="mx-auto max-w-xs text-sm leading-relaxed text-neutral-500">
      Ask about your documents, research case law, or draft correspondence.
    </p>
    <div className="flex justify-center pt-1">
      <FeatureHelp title="LexChat" content={CHAT_HELP} />
    </div>
  </div>
</div>
```

- [ ] **Step 2: Polish ToolStepRow**

Find:
```tsx
<div className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-[11px] text-neutral-500">
```
Replace with:
```tsx
<div className="rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-[11px] text-neutral-500">
```

- [ ] **Step 3: Visually verify**

- Open a new chat thread — confirm the empty state looks polished (larger logo, cleaner heading, tighter copy)
- Send a message that triggers tool steps (e.g. "search for something") — confirm ToolStepRow pills look clean
- Verify no layout regressions in the message thread

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/chat/ChatPanel.tsx
git commit -m "polish: refine chat empty state and tool step row appearance"
```

---

### Task 4: Frontend polish — MemoriesPanel spacing

**Files:**
- Modify: `frontend/src/features/memories/MemoriesPanel.tsx`

**Interfaces:**
- No interface changes — pure visual polish

- [ ] **Step 1: Tighten category section spacing**

Find:
```tsx
<div className="space-y-16">
```
Replace with:
```tsx
<div className="space-y-12">
```

Find (the outer scroll region content wrapper):
```tsx
<div className="max-w-4xl mx-auto space-y-12">
```
Replace with:
```tsx
<div className="mx-auto max-w-4xl space-y-10">
```

- [ ] **Step 2: Refine the Dream result banner**

Find:
```tsx
<div className="border-b border-emerald-100 bg-emerald-50 px-6 py-3 text-xs text-emerald-900">
```
Replace with:
```tsx
<div className="border-b border-emerald-100 bg-emerald-50/70 px-6 py-3 text-xs text-emerald-900">
```

- [ ] **Step 3: Visually verify**

Navigate to /memories. Confirm:
- Category sections have balanced spacing
- Dream banner (if visible) looks lighter and more elegant
- Add/edit forms still work correctly

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/memories/MemoriesPanel.tsx
git commit -m "polish: tighten MemoriesPanel spacing"
```
