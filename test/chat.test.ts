import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChatTurn, type ChatStreamFn } from '../src/main/ai/chat'
import type { ChatMessage, Settings } from '../src/shared/types'

// The per-turn runner (feature 002, D5). The in-memory ChatSession model is
// deleted: storage holds the history (pinned by test/conversations.test.ts),
// and this module is one short-lived call per turn — deltas out, text + usage
// back, nothing retained.

const SETTINGS_ON = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  hasApiKey: true,
  defaultListId: null,
  maxConcurrentJobs: 2,
  showWelcome: false,
  theme: 'light',
  uiLanguage: 'en',
  assistantRuntime: 'on',
  lastCheck: null,
  skills: [],
  mcpServers: []
} as unknown as Settings

const SETTINGS_OFF: Settings = { ...SETTINGS_ON, hasApiKey: false }

// Scripted stream: emits deltas then returns the reply WITH usage — the
// stored assistant message must carry it (the chatMessages rule).
function scriptedStream(reply = 'hello from the model'): { fn: ChatStreamFn; deltas: string[] } {
  const deltas: string[] = []
  const fn: ChatStreamFn = async (_settings, _history, onDelta) => {
    for (const p of reply.split(' ')) {
      deltas.push(p + ' ')
      onDelta(p + ' ')
    }
    return { text: reply, usage: { totalTokens: 7 } }
  }
  return { fn, deltas }
}

test('a turn streams deltas and returns the text with its usage', async () => {
  const { fn, deltas } = scriptedStream()
  let streamed = ''
  const result = await runChatTurn(SETTINGS_ON, [{ role: 'user', content: 'ping' }], (d) => (streamed += d), fn)
  assert.equal(result.text, 'hello from the model')
  assert.deepEqual(result.usage, { totalTokens: 7 })
  assert.equal(streamed, 'hello from the model ')
  assert.equal(deltas.length, 4)
})

test('the shaped history is passed through untouched — stored usage rides along', async () => {
  const seen: ChatMessage[][] = []
  const fn: ChatStreamFn = async (_s, history, onDelta) => {
    seen.push([...history])
    onDelta('ok')
    return { text: 'ok' }
  }
  const history: ChatMessage[] = [
    { role: 'user', content: 'Task context…' },
    { role: 'assistant', content: 'Understood.', usage: null },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'an answer', usage: { totalTokens: 12 } }
  ]
  await runChatTurn(SETTINGS_ON, [...history, { role: 'user', content: 'second' }], () => {}, fn)
  assert.deepEqual(seen[0], [...history, { role: 'user', content: 'second' }])
  assert.deepEqual(seen[0]![3]!.usage, { totalTokens: 12 }, 'the stored usage reaches the shaping layer')
})

test('no-key turn is rejected without contacting the model', async () => {
  const { fn } = scriptedStream()
  let called = false
  await assert.rejects(
    () =>
      runChatTurn(SETTINGS_OFF, [{ role: 'user', content: 'ping' }], () => {}, async (...args) => {
        called = true
        return fn(...args)
      }),
    /AI not configured/
  )
  assert.equal(called, false, 'the stream is never reached when unconfigured')
})

test('a failed turn rejects with the provider error — the caller keeps history intact', async () => {
  const fn: ChatStreamFn = async () => {
    throw new Error('rate limit exceeded')
  }
  await assert.rejects(() => runChatTurn(SETTINGS_ON, [{ role: 'user', content: 'ping' }], () => {}, fn), /rate limit/)
})
