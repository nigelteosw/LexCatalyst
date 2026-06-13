import type {
  KnowledgeBankEntryType,
  KnowledgeBankScope,
} from '../../shared/types/workspace'

export const entryTypes: Array<{
  id: KnowledgeBankEntryType
  label: string
  description: string
}> = [
  {
    id: 'knowledge_bank',
    label: 'Knowledge Bank',
    description: 'Playbooks, precedents, templates, and formats',
  },
  {
    id: 'style_guide',
    label: 'Style Guide',
    description: 'Writing standards, partner preferences, and formatting rules',
  },
  {
    id: 'action',
    label: 'Action',
    description: 'Soft-skill guides, wellness resources, and advice content',
  },
]

export const scopeLabels: Record<KnowledgeBankScope, string> = {
  firm_wide: 'Firm-wide',
  team: 'Team',
  matter: 'Matter',
  private: 'Private',
}

export const scopeDescriptions: Record<KnowledgeBankScope, string> = {
  firm_wide: 'Visible to everyone in the firm.',
  team: 'Visible to everyone in the selected team.',
  matter: 'Visible only to people with access to the selected matter.',
  private: 'Visible only to you.',
}
