import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatSession, type ChatStreamFn } from '../src/main/ai/chat'
import type { ChatMessage, Settings } from '../src/shared/types'

const SETTINGS_ON: Settings = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  apiKey: 'sk-test',
  wikiPath: '',
  defaultListId: null,
  maxConcurrentJobs: 2,
  showWelcome: false
}

const SETTINGS_OFF: Settings = { ...SETTINGS_ON, apiKey: null }

// Scripted stream: emits two deltas then returns the full reply.
function scriptedStream(reply = 'hello from the model'): { fn: ChatStreamFn; deltas: string[] } {
  const deltas: string[] = []
  const fn: ChatStreamFn = async (_settings, _history, onDelta) => {
    const parts = reply.split(' ')
    for (const p of parts) {
      deltas.push(p + ' ')
      onDelta(p + ' ')
    }
    return reply
  }
  return { fn, deltas }
}

test('send streams deltas and accumulates history', async () => {
  const { fn, deltas } = scriptedStream()
  const s = new ChatSession(fn)
  let streamed = ''
  const reply = await s.send('ping', SETTINGS_ON, (d) => (streamed += d))
  assert.equal(reply, 'hello from the model')
  assert.equal(streamed, 'hello from the model ')
  assert.deepEqual(s.messages, [
    { role: 'user', content: 'ping' },
    { role: 'assistant', content: 'hello from the model' }
  ])
  assert.equal(deltas.length, 4, 'two tokens per scripted reply')
})

test('multi-turn: history grows and is passed to the stream function', async () => {
  const seen: ChatMessage[][] = []
  const fn: ChatStreamFn = async (_s, history, onDelta) => {
    seen.push([...history])
    onDelta('ok')
    return 'ok'
  }
  const s = new ChatSession(fn)
  await s.send('first', SETTINGS_ON, () => {})
  await s.send('second', SETTINGS_ON, () => {})
  assert.equal(seen.length, 2)
  assert.equal(seen[0]!.length, 1, 'first turn sees only its own user message')
  assert.equal(seen[1]!.length, 3, 'second turn sees user + assistant + user')
})

test('no-key send is rejected without contacting the model', async () => {
  const { fn } = scriptedStream()
  const s = new ChatSession(fn)
  await assert.rejects(() => s.send('ping', SETTINGS_OFF, () => {}), /AI not configured/)
  assert.equal(s.messages.length, 0, 'no user message pollutes history')
})

test('failed turn rolls back the user message', async () => {
  const fn: ChatStreamFn = async () => {
    throw new Error('rate limit exceeded')
  }
  const s = new ChatSession(fn)
  await assert.rejects(() => s.send('ping', SETTINGS_ON, () => {}), /rate limit/)
  assert.deepEqual(s.messages, [], 'history clean after a failed turn')
})

test('reset clears the conversation', async () => {
  const { fn } = scriptedStream()
  const s = new ChatSession(fn)
  await s.send('ping', SETTINGS_ON, () => {})
  s.reset()
  assert.deepEqual(s.messages, [])
})

test('empty message is rejected', async () => {
  const s = new ChatSession(scriptedStream().fn)
  await assert.rejects(() => s.send('   ', SETTINGS_ON, () => {}), /empty message/)
})

test('concurrent sends are rejected while streaming', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const fn: ChatStreamFn = async (_s, _h, onDelta) => {
    onDelta('waiting')
    await gate
    return 'done'
  }
  const s = new ChatSession(fn)
  const first = s.send('ping', SETTINGS_ON, () => {})
  await assert.rejects(() => s.send('second', SETTINGS_ON, () => {}), /already streaming/)
  release()
  await first
})
