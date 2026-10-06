import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Brain, Trash2, Plus, Edit2, Check, X, Shield, Settings, Activity, Moon } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../shared/ui/Button'
import {
  createMemory,
  deleteMemory,
  getDreamJob,
  listMemories,
  startDreamJob,
  updateMemory,
} from '../../shared/api/api'
import type { DreamProposal, MemoryCategory } from '../../shared/types/workspace'
import { waitForDelay } from '../../shared/lib/async'
import { getErrorMessage, isAbortError } from '../../shared/lib/errors'
import { ErrorBanner } from '../../shared/ui/ErrorBanner'
import { PanelHeader } from '../../shared/ui/PanelHeader'
import type { HelpContent } from '../../shared/ui/FeatureHelp'

const MEMORY_HELP: HelpContent = {
  intro: 'LexCatalyst remembers things about you so every conversation picks up where the last one left off.',
  steps: [
    {
      emoji: '🧠',
      title: 'Memories are built automatically',
      body: 'After each chat session, the AI reviews the conversation and saves any new facts, preferences, or context it learned about you — your role, how you like drafts structured, matters you\'re working on.',
    },
    {
      emoji: '💤',
      title: 'Dream reviews your recent activity',
      body: 'Click "Dream" to run a one-off memory review right now. Dream merges duplicates, drops stale facts, and proposes updates for you to approve before anything changes.',
    },
    {
      emoji: '✏️',
      title: 'Edit or delete any memory',
      body: 'Click the pencil icon on any memory card to correct it, or the bin to remove it. You have full control — the AI only keeps what you allow.',
    },
    {
      emoji: '💬',
      title: 'Memories shape every answer',
      body: 'The AI injects your relevant memories into its context before each response, so it knows your seniority level, preferred style, and active matters without you having to repeat yourself.',
    },
  ],
  tips: [
    'Memories are personal — only you can see them. They are never shared with colleagues or attached to matters.',
    'Three categories: Semantic (facts), Procedural (how you work), Episodic (what happened in a session).',
    'If the AI gets something wrong, delete that memory and correct it manually — the AI will pick up the correction in the next session.',
  ],
}

const DREAM_POLL_INTERVAL_MS = 1000
const DREAM_POLL_TIMEOUT_MS = 120_000

export function MemoriesPanel() {
  const queryClient = useQueryClient()
  const memoriesQuery = useQuery({
    queryKey: ['memories'],
    queryFn: () => listMemories(),
  })
  const memories = memoriesQuery.data ?? []
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form states
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryCategory>('semantic')
  const [editContent, setEditContent] = useState('')

  // Dream state
  const [isDreaming, setIsDreaming] = useState(false)
  const [dreamResult, setDreamResult] = useState<DreamProposal | null>(null)
  const dreamAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    dreamAbortRef.current?.abort()
    dreamAbortRef.current = null
  }, [])

  const handleAdd = async () => {
    if (!newContent.trim()) return
    setIsMutating(true)
    try {
      await createMemory({ category: newCategory, content: newContent })
      setNewContent('')
      setIsAdding(false)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['memories'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create memory')
    } finally {
      setIsMutating(false)
    }
  }

  const handleUpdate = async (id: string) => {
    if (!editContent.trim()) return
    setIsMutating(true)
    try {
      await updateMemory(id, { content: editContent })
      setEditingId(null)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['memories'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update memory')
    } finally {
      setIsMutating(false)
    }
  }

  const handleDream = async () => {
    if (isDreaming) return
    setIsDreaming(true)
    setDreamResult(null)
    setError(null)
    const controller = new AbortController()
    dreamAbortRef.current = controller
    try {
      const { jobId } = await startDreamJob()
      const startedAt = Date.now()
      while (true) {
        await waitForDelay(DREAM_POLL_INTERVAL_MS, controller.signal)
        const status = await getDreamJob(jobId)
        controller.signal.throwIfAborted()
        if (status.status === 'completed' && status.proposal && status.memories) {
          queryClient.setQueryData(['memories'], status.memories)
          setDreamResult(status.proposal)
          break
        }
        if (status.status === 'failed') {
          throw new Error(status.errorMessage ?? 'Dream failed')
        }
        if (Date.now() - startedAt > DREAM_POLL_TIMEOUT_MS) {
          throw new Error('Dream timed out — try again')
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        setError(getErrorMessage(err, 'Dream failed'))
      }
    } finally {
      if (dreamAbortRef.current === controller) {
        dreamAbortRef.current = null
        setIsDreaming(false)
      }
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this memory?')) return
    setIsMutating(true)
    try {
      await deleteMemory(id)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['memories'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory')
    } finally {
      setIsMutating(false)
    }
  }

  const categories: Array<{
    id: MemoryCategory
    label: string
    icon: LucideIcon
    color: string
    description: string
  }> = [
    {
      id: 'semantic',
      label: 'Stable Facts',
      icon: Shield,
      color: 'text-blue-600 bg-blue-50',
      description: 'Stable information about you, your firm, or specific matters.',
    },
    {
      id: 'procedural',
      label: 'Working Style',
      icon: Settings,
      color: 'text-purple-600 bg-purple-50',
      description: 'Preferences for how the assistant should behave and format work.',
    },
    {
      id: 'episodic',
      label: 'Session Notes',
      icon: Activity,
      color: 'text-emerald-600 bg-emerald-50',
      description: 'Important events or actions remembered from recent chat sessions.',
    },
  ]

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface lg:my-2 lg:mr-2 lg:rounded-tl-2xl lg:border-l lg:border-t lg:border-neutral-200 lg:shadow-sm">
      <PanelHeader
        actions={
          <>
            <Button
              disabled={isDreaming}
              onClick={handleDream}
              size="sm"
              title="Review and refine your memories based on recent activity"
              variant="secondary"
            >
              <Moon size={14} />
              {isDreaming ? 'Dreaming…' : 'Dream'}
            </Button>
            <Button onClick={() => setIsAdding(true)} size="sm" variant="primary">
              <Plus size={14} />
              Add Memory
            </Button>
          </>
        }
        description="Review facts, working preferences, and session context."
        helpContent={MEMORY_HELP}
        icon={Brain}
        title="User Memory"
      />
      {isDreaming && (
        <div className="flex items-center gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50 bg-[length:200%_100%] px-6 py-2 text-xs text-indigo-700 animate-pulse">
          <Moon size={14} />
          Reviewing your recent conversations…
        </div>
      )}
      {dreamResult && (
        <div className="border-b border-emerald-100 bg-emerald-50/70 px-6 py-3 text-xs text-emerald-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">
                Dream applied {dreamChangeCount(dreamResult)} change
                {dreamChangeCount(dreamResult) === 1 ? '' : 's'} automatically.
              </p>
              <p className="mt-1 text-emerald-700">
                Reviewed {dreamResult.reviewedMessageCount} recent messages. Automated
                memories include the reason for the change.
              </p>
              {dreamChangeCount(dreamResult) > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">View justifications</summary>
                  <ul className="mt-2 space-y-1 text-emerald-800">
                    {dreamReasons(dreamResult).map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        <span className="font-semibold">{item.label}:</span> {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <Button
              aria-label="Dismiss Dream result"
              onClick={() => setDreamResult(null)}
              size="icon"
              variant="ghost"
            >
              <X size={16} />
            </Button>
          </div>
        </div>
      )}

      <div className="app-scroll-region min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-10">
          {(error || memoriesQuery.error) && (
            <ErrorBanner
              message={error ?? getErrorMessage(memoriesQuery.error, 'Failed to load memories')}
              onDismiss={error ? () => setError(null) : undefined}
            />
          )}

          {isAdding && (
            <div className="p-5 border border-neutral-200 rounded-2xl bg-neutral-50 shadow-sm animate-in fade-in slide-in-from-top-4 duration-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-tight">New Contextual Memory</h3>
                <Button
                  aria-label="Close memory form"
                  onClick={() => setIsAdding(false)}
                  size="icon"
                  variant="ghost"
                >
                  <X size={18} />
                </Button>
              </div>
              <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                  {categories.map((cat) => (
                    <Button
                      key={cat.id}
                      onClick={() => setNewCategory(cat.id)}
                      size="sm"
                      variant={newCategory === cat.id ? 'selected' : 'secondary'}
                    >
                      {cat.label}
                    </Button>
                  ))}
                </div>
                <textarea
                  autoFocus
                  className="w-full p-4 text-sm bg-white border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all min-h-[100px]"
                  placeholder="Enter content for the assistant to remember..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setIsAdding(false)}
                    size="sm"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={isMutating}
                    onClick={handleAdd}
                    size="sm"
                    variant="primary"
                  >
                    Save Memory
                  </Button>
                </div>
              </div>
            </div>
          )}

          {memoriesQuery.isLoading ? (
            <div className="rounded-2xl border border-dashed border-neutral-200 p-12 text-center text-sm text-neutral-500">
              Loading memories...
            </div>
          ) : (
          <div className="space-y-12">
            {categories.map((cat) => {
              const catMemories = memories.filter((m) => m.category === cat.id)
              return (
                <div key={cat.id} className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-2.5 rounded-xl ${cat.color} flex-shrink-0`}>
                      <cat.icon size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-tight">{cat.label}</h3>
                      <p className="text-xs text-neutral-500 mt-1">{cat.description}</p>
                    </div>
                  </div>

                  {catMemories.length > 0 ? (
                    <div className="grid gap-4">
                      {catMemories.map((memory) => (
                        <div
                          key={memory.id}
                          className="group relative p-4 bg-white border border-neutral-100 rounded-2xl hover:border-neutral-200 hover:shadow-md transition-all duration-200"
                        >
                          {editingId === memory.id ? (
                            <div className="space-y-4">
                              <textarea
                                autoFocus
                                className="w-full p-3 text-sm bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none"
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  aria-label="Cancel edit"
                                  onClick={() => setEditingId(null)}
                                  size="icon"
                                  variant="ghost"
                                >
                                  <X size={16} />
                                </Button>
                                <Button
                                  aria-label="Save edit"
                                  onClick={() => handleUpdate(memory.id)}
                                  size="icon"
                                  variant="primary"
                                >
                                  <Check size={16} />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-4">
                                <p className="text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap">
                                  {memory.content}
                                </p>
                                <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                  <Button
                                    disabled={isMutating}
                                    onClick={() => {
                                      setEditingId(memory.id)
                                      setEditContent(memory.content)
                                    }}
                                    size="icon"
                                    title="Edit memory"
                                    variant="secondary"
                                  >
                                    <Edit2 size={14} />
                                  </Button>
                                  <Button
                                    disabled={isMutating}
                                    onClick={() => handleDelete(memory.id)}
                                    size="icon"
                                    title="Delete memory"
                                    variant="danger"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-3 flex items-center gap-3">
                                <span className="text-meta font-medium text-neutral-500 tracking-wide">
                                  {new Date(memory.updatedAt).toLocaleDateString()}
                                </span>
                                <div className="h-1 w-1 rounded-full bg-neutral-200" />
                                <span className="text-meta font-medium text-neutral-500 tracking-wide">
                                  Confidence: {(memory.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                              {memory.justification && (
                                <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                                  <span className="font-semibold">Dream justification:</span>{' '}
                                  {memory.justification}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-12 text-center border border-dashed border-neutral-200 rounded-2xl bg-neutral-50/50">
                      <p className="text-xs text-neutral-400">No memories captured in this category yet.</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </div>
      </div>
    </section>
  )
}

function dreamChangeCount(proposal: DreamProposal): number {
  return (
    proposal.additions.length +
    proposal.merges.length +
    proposal.updates.length +
    proposal.drops.length
  )
}

function dreamReasons(proposal: DreamProposal): Array<{ label: string; reason: string }> {
  return [
    ...proposal.additions.map((item) => ({ label: 'Added', reason: item.reason })),
    ...proposal.merges.map((item) => ({ label: 'Merged', reason: item.reason })),
    ...proposal.updates.map((item) => ({ label: 'Updated', reason: item.reason })),
    ...proposal.drops.map((item) => ({ label: 'Dropped', reason: item.reason })),
  ]
}
