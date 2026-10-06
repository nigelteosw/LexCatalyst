import type { SearchStep } from '../lib/api'

// What Birdie looked up for this answer, so the user can see (and question) each search.
export function SearchSteps({ steps }: { steps: SearchStep[] }) {
  if (!steps.length) return null
  return (
    <ul className="mb-2 space-y-0.5 text-xs text-[#76766f]">
      {steps.map((step) => (
        <li key={step.id}>
          {step.status === 'running' ? 'Searching eLitigation for' : 'Searched eLitigation for'} “{step.query}”
          {step.status === 'running' && '…'}
          {step.status === 'done' && step.summary && ` · ${step.summary}`}
          {step.status === 'failed' && ` · ${step.summary ?? 'failed'}`}
        </li>
      ))}
    </ul>
  )
}
