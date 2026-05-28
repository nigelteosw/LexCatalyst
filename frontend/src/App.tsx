import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { ContextPanel } from './components/ContextPanel'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { workspaceContent } from './content/workspaceContent'
import type { Message, Memory } from './types/workspace'

function App() {
  const [messages, setMessages] = useState<Message[]>(workspaceContent.chat.initialMessages)
  const [prompt, setPrompt] = useState('')
  const [activeThread, setActiveThread] = useState(workspaceContent.threads[0])
  const [memories, setMemories] = useState<Memory[]>(workspaceContent.memories.initialItems)
  const [uploadState, setUploadState] = useState(workspaceContent.upload.initialState)

  const documentCount = useMemo(() => {
    const readyDocuments = workspaceContent.documents.filter((document) => document.status === 'ready')
    return `${readyDocuments.length}/${workspaceContent.documents.length} ready`
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      return
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      { role: 'user', body: trimmedPrompt },
      workspaceContent.chat.followUpResponse,
    ])
    setPrompt('')
  }

  function saveDraftMemory() {
    setMemories((currentMemories) => [workspaceContent.memories.draftItem, ...currentMemories])
  }

  function handleUpload() {
    setUploadState(workspaceContent.upload.queuedState)
    window.setTimeout(() => setUploadState(workspaceContent.upload.processingState), 700)
    window.setTimeout(() => setUploadState(workspaceContent.upload.readyState), 1600)
  }

  return (
    <main className="grid min-h-screen bg-stone-50 text-stone-950 md:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[284px_minmax(0,1fr)]">
      <Sidebar
        activeThread={activeThread}
        brand={workspaceContent.brand}
        newChatLabel={workspaceContent.newChatLabel}
        onSelectThread={setActiveThread}
        threads={workspaceContent.threads}
        workspace={workspaceContent.workspace}
      />

      <section className="flex min-w-0 flex-col">
        <Topbar
          actions={workspaceContent.actions}
          label={workspaceContent.matterLabel}
          title={activeThread}
        />

        <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ChatPanel
            assistantInitials={workspaceContent.chat.assistantInitials}
            inputLabel={workspaceContent.chat.inputLabel}
            messages={messages}
            onPromptChange={setPrompt}
            onSubmit={handleSubmit}
            placeholder={workspaceContent.chat.placeholder}
            prompt={prompt}
            sendLabel={workspaceContent.chat.sendLabel}
            suggestions={workspaceContent.suggestions}
            userInitials={workspaceContent.chat.userInitials}
          />

          <ContextPanel
            addMemoryLabel={workspaceContent.memories.addLabel}
            documentCount={documentCount}
            documents={workspaceContent.documents}
            insight={workspaceContent.insight}
            memories={memories}
            memoryLabel={workspaceContent.memories.label}
            onAddMemory={saveDraftMemory}
            onUpload={handleUpload}
            uploadLabel={workspaceContent.upload.label}
            uploadState={uploadState}
          />
        </div>
      </section>
    </main>
  )
}

export default App
