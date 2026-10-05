export type SseEvent = { event: string; data: Record<string, string> }

// Mirrors the parser in frontend/src/shared/api/api.ts (streamBirdie).
export function splitSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: SseEvent[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7)
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6)
    if (!event || !data) continue
    events.push({ event, data: JSON.parse(data) as Record<string, string> })
  }
  return { events, rest }
}
