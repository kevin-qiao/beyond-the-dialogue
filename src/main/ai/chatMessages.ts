import type { ChatMessage } from '../../shared/types'

// Our chat history as SDK-shaped messages.
//
// Deliberately free of any Pi SDK import: this is the rule that the SDK's
// context estimator depends on, so it has to be reachable from a test that
// never loads the runtime (the same reason chat.ts imports agent-runtime
// dynamically). agent-runtime.ts applies it at the one place the SDK is called.
//
// A `ChatMessage` is `{role, content}` — enough to render a transcript, not
// enough to be an SDK message. Two missing fields are load-bearing, and both
// fail *inside* the SDK's estimator rather than at the call, which is what made
// the failure so hard to see: the request comes back as an error terminal
// message carrying no content, and the chat renders that as an answer that
// never appears.
//
//   - an assistant entry must carry `usage`. The estimator reads
//     `usage.totalTokens` off the last assistant message with no guard, so a
//     bare entry throws.
//   - an assistant entry's `content` must be blocks, not a string. The same
//     estimator iterates it, and iterating a string walks its characters.

/** A usage record for a turn whose tokens this app never observed: the
 *  grounding pair injected ahead of the history, and every assistant turn
 *  recorded as a plain `{role, content}`. Zero is honest — the SDK then counts
 *  the text instead of trusting a number we do not have. */
export const UNKNOWN_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

export function toSdkMessages(history: readonly ChatMessage[], now: number = Date.now()): unknown[] {
  return history.map((m) =>
    m.role === 'assistant'
      ? {
          role: 'assistant',
          content: [{ type: 'text', text: m.content }],
          usage: UNKNOWN_USAGE,
          stopReason: 'stop',
          timestamp: now
        }
      : { role: 'user', content: m.content, timestamp: now }
  )
}
