import type { ChatMessage, Settings } from '../../shared/types'
import { isConfigured } from './ai-config'

export type ChatStreamFn = (settings: Settings, history: ChatMessage[], onDelta: (delta: string) => void) => Promise<string>

// The default stream fn lazily imports agent-runtime (which statically
// imports the ESM-only Pi SDK) so this module stays loadable in the CJS
// test context — same pattern as session-factory.ts.
async function defaultStream(settings: Settings, history: ChatMessage[], onDelta: (delta: string) => void): Promise<string> {
  const { streamChat } = await import('./agent-runtime')
  return streamChat(settings, history, onDelta)
}

// In-memory conversation against the configured model — the debug chat, and
// (since v0.8) the task-grounded working-area chat panels. History is
// deliberately not persisted — it is a working surface, not a knowledge base.
// When a conversation starts with a task context block, it is injected ahead
// of the history so every reply is grounded in the task's inputs, pre-process
// outputs, and current note (spec learning-type: "Chat uses task context").
// The stream function is injectable so tests can script deltas without a
// provider.
export class ChatSession {
  private history: ChatMessage[] = []
  private context: string | null = null
  private busy = false

  constructor(private streamFn: ChatStreamFn = defaultStream) {}

  get messages(): ChatMessage[] {
    return this.history
  }

  async send(userText: string, settings: Settings, onDelta: (delta: string) => void, context?: string): Promise<string> {
    if (this.busy) throw new Error('a reply is already streaming')
    if (!isConfigured(settings)) {
      throw new Error('AI not configured: open Settings to configure a provider, model and API key')
    }
    const trimmed = userText.trim()
    if (!trimmed) throw new Error('empty message')
    // The context is captured by the first message of a conversation.
    if (context && !this.context) this.context = context
    this.busy = true
    this.history.push({ role: 'user', content: trimmed })
    const messages: ChatMessage[] = this.context
      ? [
          { role: 'user', content: `Task context for this conversation (answer grounded in it):\n\n${this.context}` },
          { role: 'assistant', content: 'Understood — I have the task context. Ask me anything.' },
          ...this.history
        ]
      : this.history
    try {
      const reply = await this.streamFn(settings, messages, onDelta)
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
    this.context = null
  }
}
