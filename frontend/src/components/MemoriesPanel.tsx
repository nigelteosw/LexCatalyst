import { useState, useEffect } from 'react'
import { Brain, Trash2, Plus, Edit2, Check, X, Shield, Settings, Activity, AlertCircle } from 'lucide-react'
import { listMemories, createMemory, updateMemory, deleteMemory } from '../lib/api'
import type { Memory, MemoryCategory } from '../types/workspace'

export function MemoriesPanel() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form states
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryCategory>('semantic')
  const [editContent, setEditContent] = useState('')

  const fetchMemories = async () => {
    setIsLoading(true)
    try {
      const data = await listMemories()
      setMemories(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchMemories()
  }, [])

  const handleAdd = async () => {
    if (!newContent.trim()) return
    try {
      await createMemory({ category: newCategory, content: newContent })
      setNewContent('')
      setIsAdding(false)
      await fetchMemories()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create memory')
    }
  }

  const handleUpdate = async (id: string) => {
    if (!editContent.trim()) return
    try {
      await updateMemory(id, { content: editContent })
      setEditingId(null)
      await fetchMemories()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update memory')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this memory?')) return
    try {
      await deleteMemory(id)
      await fetchMemories()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory')
    }
  }

  const categories: { id: MemoryCategory; label: string; icon: any; color: string; description: string }[] = [
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
    <section className="flex flex-col flex-1 min-h-0 bg-white lg:rounded-tl-2xl lg:border-t lg:border-l lg:border-neutral-200 lg:shadow-sm lg:my-2 lg:mr-2 overflow-hidden">
      <header className="flex h-14 items-center justify-between border-b border-neutral-100 bg-white/80 backdrop-blur-md px-4 lg:px-6 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-neutral-900 text-white rounded-lg">
            <Brain size={18} />
          </div>
          <h2 className="text-sm font-semibold text-neutral-900">User Memory</h2>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition-all shadow-sm active:scale-95"
        >
          <Plus size={14} />
          Add Memory
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-12">
          {error && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl">
              <AlertCircle size={16} />
              {error}
              <button onClick={() => setError(null)} className="ml-auto hover:text-red-800">
                <X size={14} />
              </button>
            </div>
          )}

          {isAdding && (
            <div className="p-5 border border-neutral-200 rounded-2xl bg-neutral-50 shadow-sm animate-in fade-in slide-in-from-top-4 duration-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-tight">New Contextual Memory</h3>
                <button onClick={() => setIsAdding(false)} className="text-neutral-400 hover:text-neutral-600">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setNewCategory(cat.id)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                        newCategory === cat.id
                          ? 'bg-white border-neutral-900 text-neutral-900 shadow-sm'
                          : 'bg-transparent border-neutral-200 text-neutral-500 hover:border-neutral-300'
                      }`}
                    >
                      {cat.label}
                    </button>
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
                  <button
                    onClick={() => setIsAdding(false)}
                    className="px-4 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAdd}
                    className="px-4 py-2 text-xs font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 shadow-sm"
                  >
                    Save Memory
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-16">
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
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="p-1.5 text-neutral-400 hover:text-neutral-600"
                                >
                                  <X size={16} />
                                </button>
                                <button
                                  onClick={() => handleUpdate(memory.id)}
                                  className="p-1.5 text-emerald-600 hover:text-emerald-700"
                                >
                                  <Check size={16} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-4">
                                <p className="text-sm leading-relaxed text-neutral-700 whitespace-pre-wrap">
                                  {memory.content}
                                </p>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => {
                                      setEditingId(memory.id)
                                      setEditContent(memory.content)
                                    }}
                                    className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50 rounded-lg transition-all"
                                    title="Edit memory"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(memory.id)}
                                    className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                    title="Delete memory"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-3 flex items-center gap-3">
                                <span className="text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">
                                  {new Date(memory.updatedAt).toLocaleDateString()}
                                </span>
                                <div className="h-1 w-1 rounded-full bg-neutral-200" />
                                <span className="text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">
                                  Confidence: {(memory.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
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
        </div>
      </div>
    </section>
  )
}
