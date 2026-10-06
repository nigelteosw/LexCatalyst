import { useEffect, useRef, useState } from 'react'
import { Lightbulb, X } from 'lucide-react'

type Props = {
  /** The text the reviewer selected — pre-filled as the starting point for the suggested replacement. */
  selectedText: string
  onSave: (suggestedText: string, note: string) => void
  onCancel: () => void
  isSaving?: boolean
  /** Save failure to show inline; the draft is kept so the reviewer can retry. */
  error?: string | null
}

export function SuggestionEditor({ selectedText, onSave, onCancel, isSaving, error }: Props) {
  const [suggestedText, setSuggestedText] = useState(selectedText)
  const [note, setNote] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [])

  function handleSave() {
    if (!suggestedText.trim()) return
    onSave(suggestedText.trim(), note.trim())
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      className="z-50 w-80 rounded-xl border border-black/10 bg-white shadow-xl"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between border-b border-black/8 px-3 py-2">
        <div className="flex items-center gap-1.5 text-meta font-semibold text-blue-600">
          <Lightbulb size={12} />
          Suggest replacement
        </div>
        <button
          className="rounded p-0.5 text-[#76766f] hover:bg-[#f4f3ef] hover:text-[#0f0f0f]"
          onClick={onCancel}
          type="button"
          aria-label="Cancel"
        >
          <X size={13} />
        </button>
      </div>

      <div className="space-y-2.5 p-3">
        <div>
          <label className="mb-1 block text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">
            Suggested wording
          </label>
          <textarea
            ref={textareaRef}
            className="w-full resize-none rounded-lg border border-black/15 bg-white px-2.5 py-2 text-xs leading-5 text-[#0f0f0f] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            rows={4}
            value={suggestedText}
            onChange={(e) => setSuggestedText(e.target.value)}
            placeholder="Enter the proposed replacement text…"
          />
        </div>

        <div>
          <label className="mb-1 block text-meta font-semibold uppercase tracking-[0.08em] text-[#76766f]">
            Rationale <span className="font-normal normal-case text-[#c4c3bc]">(optional)</span>
          </label>
          <textarea
            className="w-full resize-none rounded-lg border border-black/15 bg-white px-2.5 py-2 text-xs leading-5 text-[#0f0f0f] outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this change? (supports markdown)"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-2 py-1 text-meta text-red-600">{error} — your draft is kept; try again.</p>
        )}

        <div className="flex items-center justify-between pt-0.5">
          <span className="text-meta text-[#c4c3bc]">⌘ Enter to save</span>
          <div className="flex gap-2">
            <button
              className="rounded-lg px-3 py-1.5 text-meta text-[#5a5a56] hover:bg-[#f4f3ef]"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-meta font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={!suggestedText.trim() || isSaving}
              onClick={handleSave}
              type="button"
            >
              {isSaving ? 'Saving…' : error ? 'Retry' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
