import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSdkMessages } from '../src/main/ai/chatMessages'
import type { ChatMessage } from '../src/shared/types'

// The message shape the SDK will accept, pinned.
//
// This exists because the failure it guards against is silent. An assistant
// entry reaching the SDK without a `usage` makes the SDK's context estimator
// throw inside the provider call; the SDK reports that as an error terminal
// message with no content, and the chat rendered it as an answer that never
// appeared — no error, no text, nothing. The chat was unusable for every
// conversation that had a grounding context or more than one turn, and nothing
// in the suite noticed.

const CONTEXT_PAIR: ChatMessage[] = [
  { role: 'user', content: 'Task context for this conversation:\n\n## Objective' },
  { role: 'assistant', content: 'Understood — I have the task context. Ask me anything.' }
]

function assistantEntries(messages: unknown[]): Record<string, any>[] {
  return messages.filter((m: any) => m.role === 'assistant') as Record<string, any>[]
}

test('assistant entries carry a usage the estimator can read', () => {
  // The SDK's getLastAssistantUsageInfo reads `usage.totalTokens` unguarded.
  // A missing usage is a TypeError inside the provider call, not a warning.
  for (const m of assistantEntries(toSdkMessages([...CONTEXT_PAIR, { role: 'user', content: 'hi' }]))) {
    assert.ok(m.usage, 'an assistant entry must carry usage')
    assert.equal(typeof m.usage.totalTokens, 'number')
    // Zero is what keeps the estimator on its text-counting path rather than
    // trusting a token count this app never observed.
    assert.equal(m.usage.totalTokens, 0)
  }
})

test('assistant content is blocks, never a string', () => {
  // The estimator iterates content for non-user roles. A string is iterated
  // character by character, so each "block" is a character with no fields.
  for (const m of assistantEntries(toSdkMessages(CONTEXT_PAIR))) {
    assert.ok(Array.isArray(m.content), 'assistant content must be an array of blocks')
    assert.deepEqual(m.content, [{ type: 'text', text: CONTEXT_PAIR[1].content }])
  }
})

test('user entries keep their string content and every entry is timestamped', () => {
  const messages = toSdkMessages(CONTEXT_PAIR, 1234) as Record<string, any>[]
  assert.equal(messages[0].content, CONTEXT_PAIR[0].content)
  for (const m of messages) assert.equal(m.timestamp, 1234)
})

test('roles and order survive the mapping', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' }
  ]
  assert.deepEqual(
    toSdkMessages(history).map((m: any) => m.role),
    ['user', 'assistant', 'user']
  )
})
