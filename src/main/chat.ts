import type { ChatMessage, Settings } from '../shared/types'
import { isConfigured } from './ai-config'

export type ChatStreamFn = (settings: Settings, history: ChatMessage[], onDelta: (delta: string) => void) => Promise<string>

// The default stream fn lazily imports agent-runtime (which statically
// imports the ESM-only Pi SDK) so this module stays loadable in the CJS
// test context — same pattern as session-factory.ts.
async function defaultStream(settings: Settings, history: ChatMessage[], onDelta: (delta: string) => void): Promise<string> {
  const { streamChat } = await import('./agent-runtime')
  return streamChat(settings, history, onDelta)
}

// In-memory debug conversation against the configured model: a connection
// check the user can talk to. History is deliberately not persisted — it is
// a debugging surface, not a knowledge base. The stream function is
// injectable so tests can script deltas without a provider.
export class ChatSession {
  private history: ChatMessage[] = []
  private busy = false

  constructor(private streamFn: ChatStreamFn = defaultStream) {}

  get messages(): ChatMessage[] {
    return this.history
  }

  async send(userText: string, settings: Settings, onDelta: (delta: string) => void): Promise<string> {
    if (this.busy) throw new Error('a reply is already streaming')
    if (!isConfigured(settings)) {
      throw new Error('AI not configured: open Settings to configure a provider, model and API key')
    }
    const trimmed = userText.trim()
    if (!trimmed) throw new Error('empty message')
    this.busy = true
    this.history.push({ role: 'user', content: trimmed })
    try {
      const reply = await this.streamFn(settings, this.history, onDelta)
      this.history.push({ role: 'assistant', content: reply })
      return reply
    } catch (e) {
      // Roll back the user message so a failed turn doesn't pollute history.
      this.history.pop()
      throw e
    } finally {
      this.busy = false
    }
  }

  reset(): void {
    this.history = []
  }
}
