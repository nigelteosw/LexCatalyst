import type { WorkspaceContent } from '../types/workspace'

export const workspaceContent: WorkspaceContent = {
  brand: {
    initials: 'LC',
    name: 'LexCatalyst',
    title: 'Legal workspace',
  },
  workspace: {
    label: 'Workspace',
    name: 'Acme Seed Round',
  },
  matterLabel: 'Matter chat',
  actions: ['Documents', 'Memories', 'Admin'],
  newChatLabel: 'New matter chat',
  threads: [
    'Shareholder agreement review',
    'Board consent checklist',
    'Employment clause risk',
    'Cap table questions',
  ],
  suggestions: ['Find unusual clauses', 'Draft review notes', 'Save memory'],
  documents: [
    { name: 'Shareholder Agreement.pdf', status: 'ready', detail: '42 chunks indexed' },
    { name: 'Founders Side Letter.docx', status: 'processing', detail: 'Extracting text' },
    { name: 'Board Consent Template.pdf', status: 'ready', detail: '18 chunks indexed' },
  ],
  upload: {
    label: 'Upload',
    initialState: 'Drop PDF or DOCX',
    queuedState: 'Upload queued',
    processingState: 'Processing document',
    readyState: 'Ready for chat',
  },
  chat: {
    inputLabel: 'Ask LexCatalyst',
    placeholder: 'Ask about the agreement, precedent, or matter memory...',
    sendLabel: 'Send',
    assistantInitials: 'LC',
    userInitials: 'NT',
    followUpResponse: {
      role: 'assistant',
      body: 'The strongest next review point is whether the matter-specific playbook allows this consent threshold. I would compare the investor vetoes against the client instructions, then save any recurring position as a matter memory.',
      meta: 'Sources: Shareholder Agreement, section 6.1; Memory: Investor consent pattern',
    },
    initialMessages: [
      {
        role: 'assistant',
        body: 'Upload the agreement, choose the matter, then ask what needs review. I will answer from the document set and show the source sections I used.',
        meta: 'LexCatalyst',
      },
      {
        role: 'user',
        body: 'What should I know before reviewing this shareholder agreement?',
      },
      {
        role: 'assistant',
        body: 'Start with transfer restrictions, reserved matters, drag and tag mechanics, information rights, and founder vesting. The current agreement gives investors consent rights over hiring, debt, and annual budget changes, so those terms should be checked against the client playbook before signing off.',
        meta: 'Sources: Shareholder Agreement, sections 4.2, 6.1, 8.3',
      },
    ],
  },
  memories: {
    label: 'Memory review',
    addLabel: 'Add',
    initialItems: [
      {
        title: 'Investor consent pattern',
        body: 'For seed-stage shareholder agreements, flag reserved matters that require investor consent for routine operating decisions.',
        status: 'Personal',
      },
      {
        title: 'Founder vesting check',
        body: 'Always compare vesting acceleration language against the latest founder-side checklist.',
        status: 'Matter',
      },
    ],
    draftItem: {
      title: 'Review consent thresholds',
      body: 'When a shareholder agreement gives investors consent rights over ordinary-course operations, escalate before marking the clause acceptable.',
      status: 'Draft',
    },
  },
  insight: {
    label: 'Admin insight',
    title: 'Repeated junior question',
    body: 'Three recent chats asked whether investor consent applies to normal hiring. Add a playbook note before the next review cycle.',
  },
}
