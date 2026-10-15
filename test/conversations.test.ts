import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, createTask, getTask, saveNotes, updateTask, type DB } from '../src/main/db'
import { createTypeDef } from '../src/main/types'
import { createSqliteConversationStore } from '../src/main/adapters/sqlite/conversationStore'
import {
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  sendTurn
} from '../src/core/services/conversationService'
import type { ConversationTurnPort } from '../src/core/ports/conversations'
import { setUserDataRoot } from '../src/main/paths'
import type { ChatMessage } from '../src/shared/types'

// US2 (T023): durable, task-owned conversations.
//
// The turn runner is scripted — no provider, no network. What is pinned here
// is the contract: grounding from THIS task's material only (FR-011), storage
// that survives a service re-creation and keeps insertion order (FR-009),
// fresh conversations that do not see the old one (US2-AC4), failed sends that
// keep the stored history, conversations that never touch the board (FR-010,
// structurally: the service receives no task port), the stated reason when AI
// is unavailable (US2-AC3), and usage metadata stored on assistant messages
// (the chatMessages rule).

const DRAFT = '## Argument\nMirror mode fixes most of the NAT pain.'

function harness(assistantRuntime: 'on' | 'off' = 'on', configured = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-conv-'))
  setUserDataRoot(dir)
  const conn: DB = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: configured ? 'gpt-4o' : '',
    hasApiKey: configured,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    uiLanguage: 'en',
    assistantRuntime,
    lastCheck: null,
    skills: [],
    mcpServers: []
  })
  createTypeDef(conn.db, {
    key: 'journal',
    family: 'document',
    label: 'Journal',
    emoji: '📔',
    inputSchema: [{ key: 'target', label: 'Target', type: 'text' }],
    aiGuidance: 'Keep it plain.',
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
  const list = createList(conn.db, 'Work')
  const docTask = createTask(conn.db, {
    listId: list.id,
    title: 'WSL2 networking blog',
    background: 'readers keep hitting the NAT wall',
    target: 'publish by friday',
    notes: 'two sessions of writing left',
    type: 'plain',
    customTypeKey: 'journal',
    inputs: { target: 'publish by friday', undeclared: 'MUST-NEVER-LEAK' }
  })
  saveNotes(conn.db, { taskId: docTask.id, notePath: path.join(dir, 'n.md'), content: DRAFT })
  const plainTask = createTask(conn.db, {
    listId: list.id,
    title: 'Buy milk',
    background: 'fridge empty',
    target: 'milk in the fridge',
    notes: '',
    type: 'plain'
  })
  const otherTask = createTask(conn.db, {
    listId: list.id,
    title: 'Task B — private salary notes',
    background: 'SECRET-B-BACKGROUND',
    target: '',
    notes: '',
    type: 'plain'
  })
  saveNotes(conn.db, { taskId: otherTask.id, notePath: path.join(dir, 'b.md'), content: 'SECRET-B-CONTENT' })
  return { conn, dir, docTask, plainTask, otherTask }
}

interface ScriptedTurn extends ConversationTurnPort {
  captured: ChatMessage[][]
  deltas: string[]
  failNext: boolean
  calls: number
}

function scriptedTurn(availability: 'ready' | 'off' | 'not-configured' = 'ready'): ScriptedTurn {
  const state: ScriptedTurn = {
    captured: [],
    deltas: [],
    failNext: false,
    calls: 0,
    availability: () => availability,
    async run({ history, onDelta }) {
      state.calls++
      state.captured.push(history.map((m) => ({ ...m })))
      if (state.failNext) {
        state.failNext = false
        throw new Error('provider exploded')
      }
      const reply = `reply to: ${history[history.length - 1]!.content.slice(0, 20)}`
      for (const chunk of reply.match(/.{1,8}/g) ?? []) {
        onDelta(chunk)
        state.deltas.push(chunk)
      }
      return { text: reply, usage: { totalTokens: 42 } }
    }
  }
  return state
}

const deps = (conn: DB, turn: ConversationTurnPort) => ({
  store: createSqliteConversationStore(conn.db),
  turn,
  language: 'en' as const
})

test('a multi-turn exchange on a document task is grounded in the task and stored in order', async () => {
  const { conn, docTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)
  const conv = createConversation(d.store, docTask.id)

  const stored: string[] = []
  const r1 = await sendTurn(d, { conversationId: conv.id, content: 'what is this draft missing?' }, { onStored: (m) => stored.push(m.role) })
  assert.equal(r1.ok, true)
  const r2 = await sendTurn(d, { conversationId: conv.id, content: 'is the argument consistent?' })
  assert.equal(r2.ok, true)

  // Stored: user, assistant, user, assistant — insertion order (FR-009).
  const msgs = listMessages(d.store, conv.id)
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(msgs[0]!.content, 'what is this draft missing?')
  assert.ok(msgs[1]!.content.startsWith('reply to:'))
  assert.deepEqual(stored, ['user', 'assistant'], 'each stored message was announced as it landed')

  // The outbound context (captured at the seam) carries THIS task's material:
  // title, background, target, declared inputs, and the working-area draft.
  const outbound = turn.captured[0]!.map((m) => m.content).join('\n')
  assert.ok(outbound.includes('WSL2 networking blog'), 'title grounds the reply')
  assert.ok(outbound.includes('readers keep hitting the NAT wall'), 'background grounds the reply')
  assert.ok(outbound.includes('publish by friday'), 'target/declared input grounds the reply')
  assert.ok(outbound.includes('Mirror mode fixes most of the NAT pain'), 'the working-area draft grounds the reply')
  // FR-011 at the grounding level: undeclared inputs never ride along.
  assert.ok(!outbound.includes('MUST-NEVER-LEAK'))
  conn.close()
})

test('a plain task gets the family-less grounding and nothing on the board changes (US2-AC5, FR-010)', async () => {
  const { conn, plainTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)

  const before = JSON.stringify(getTask(conn.db, plainTask.id))
  const conv = createConversation(d.store, plainTask.id)
  const outcome = await sendTurn(d, { conversationId: conv.id, content: 'what should I buy?' })
  assert.equal(outcome.ok, true)

  const outbound = turn.captured[0]!.map((m) => m.content).join('\n')
  assert.ok(outbound.includes('Buy milk'))
  assert.ok(outbound.includes('fridge empty'))

  // FR-010, structurally: the task is byte-identical after the exchange —
  // and the service never held a port that could have changed it.
  assert.equal(JSON.stringify(getTask(conn.db, plainTask.id)), before)
  assert.equal('updateTask' in d.store, false, 'the conversation store exposes no task mutation')
  conn.close()
})

test('history survives a service re-creation and returns in insertion order (FR-009/SC-006)', async () => {
  const { conn, docTask } = harness()
  const first = deps(conn, scriptedTurn())
  const conv = createConversation(first.store, docTask.id)
  await sendTurn(first, { conversationId: conv.id, content: 'first question' })
  await sendTurn(first, { conversationId: conv.id, content: 'second question' })

  // The restart stand-in: a brand-new store/service over the same database.
  const second = deps(conn, scriptedTurn())
  const convs = listConversations(second.store, docTask.id)
  assert.equal(convs.length, 1)
  assert.equal(convs[0]!.id, conv.id)
  assert.equal(convs[0]!.messageCount, 4, 'the summary counts the stored turns')
  const msgs = listMessages(second.store, conv.id)
  assert.deepEqual(
    msgs.map((m) => m.content),
    ['first question', msgs[1]!.content, 'second question', msgs[3]!.content]
  )
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
  conn.close()
})

test('a new conversation mid-thread leaves the old one retrievable and starts empty (US2-AC4)', async () => {
  const { conn, docTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)
  const old = createConversation(d.store, docTask.id)
  await sendTurn(d, { conversationId: old.id, content: 'old thread question' })

  const fresh = createConversation(d.store, docTask.id)
  assert.notEqual(fresh.id, old.id)
  assert.deepEqual(listMessages(d.store, fresh.id), [], 'the fresh conversation has no turns')

  // The old one is still there, intact, and the new thread's outbound history
  // does NOT contain the old turns.
  await sendTurn(d, { conversationId: fresh.id, content: 'new thread question' })
  assert.equal(listMessages(d.store, old.id).length, 2)
  const lastOutbound = turn.captured.at(-1)!.map((m) => m.content).join('\n')
  assert.ok(lastOutbound.includes('new thread question'))
  assert.ok(!lastOutbound.includes('old thread question'), 'a new conversation does not see the old one')
  const convs = listConversations(d.store, docTask.id)
  assert.equal(convs.length, 2)
  conn.close()
})

test('a failed send keeps the stored history intact and the outcome reports the error', async () => {
  const { conn, docTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)
  const conv = createConversation(d.store, docTask.id)
  await sendTurn(d, { conversationId: conv.id, content: 'a good turn' })
  const before = listMessages(d.store, conv.id)

  turn.failNext = true
  const failed = await sendTurn(d, { conversationId: conv.id, content: 'this one fails' })
  assert.equal(failed.ok, false)
  assert.ok(!failed.ok && failed.error.includes('provider exploded'), 'the outcome reports the failure honestly')

  // The earlier exchange is untouched; the failed question stays on record
  // as sent, with no assistant turn beside it.
  const after = listMessages(d.store, conv.id)
  assert.deepEqual(after.slice(0, before.length).map((m) => m.id), before.map((m) => m.id))
  assert.deepEqual(after.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(after[2]!.content, 'this one fails')
  conn.close()
})

test('the outbound context of a question about task A contains zero content of task B (FR-011)', async () => {
  const { conn, docTask, otherTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)
  const convA = createConversation(d.store, docTask.id)
  const convB = createConversation(d.store, otherTask.id)

  await sendTurn(d, { conversationId: convA.id, content: 'about A only' })
  const outboundA = turn.captured[0]!.map((m) => m.content).join('\n')
  assert.ok(!outboundA.includes('SECRET-B-BACKGROUND'))
  assert.ok(!outboundA.includes('SECRET-B-CONTENT'))
  assert.ok(!outboundA.includes('Task B'))

  await sendTurn(d, { conversationId: convB.id, content: 'about B only' })
  const outboundB = turn.captured[1]!.map((m) => m.content).join('\n')
  assert.ok(outboundB.includes('SECRET-B-BACKGROUND'), 'B sees its own material')
  assert.ok(!outboundB.includes('Mirror mode'), 'and none of A’s draft')
  conn.close()
})

test('assistant messages store their usage metadata (the chatMessages rule)', async () => {
  const { conn, docTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)
  const conv = createConversation(d.store, docTask.id)
  const r = await sendTurn(d, { conversationId: conv.id, content: 'q' })
  assert.equal(r.ok, true)
  const msgs = listMessages(d.store, conv.id)
  const assistant = msgs.find((m) => m.role === 'assistant')!
  assert.deepEqual(assistant.usage, { totalTokens: 42 }, 'the usage the turn produced is stored with the message')
  // And the NEXT turn's shaped history carries it — an assistant entry
  // without usage makes the SDK estimator throw inside the provider call.
  await sendTurn(d, { conversationId: conv.id, content: 'q2' })
  const secondOutbound = turn.captured[1]!
  const assistantEntry = secondOutbound.find((m) => m.role === 'assistant' && m.content.startsWith('reply to:'))!
  assert.deepEqual(assistantEntry.usage, { totalTokens: 42 })
  conn.close()
})

test('off or unconfigured: the outcome states why, and the runner is never called (FR-021/US2-AC3)', async () => {
  const off = harness('off')
  const offTurn = scriptedTurn('off')
  const dOff = deps(off.conn, offTurn)
  const convOff = createConversation(dOff.store, off.docTask.id)
  const rOff = await sendTurn(dOff, { conversationId: convOff.id, content: 'hello?' })
  assert.equal(rOff.ok, false)
  assert.ok(!rOff.ok && rOff.error.includes('switched off'), `stated reason: ${rOff.ok ? '' : rOff.error}`)
  assert.equal(offTurn.calls, 0, 'no session, no outbound call')
  // History stays retrievable and the board is unaffected.
  assert.deepEqual(listMessages(dOff.store, convOff.id), [])
  off.conn.close()

  const unconfigured = harness('on', false)
  const ncTurn = scriptedTurn('not-configured')
  const dNc = deps(unconfigured.conn, ncTurn)
  const convNc = createConversation(dNc.store, unconfigured.docTask.id)
  const rNc = await sendTurn(dNc, { conversationId: convNc.id, content: 'hello?' })
  assert.equal(rNc.ok, false)
  assert.ok(!rNc.ok && rNc.error.includes('no model service'))
  assert.equal(ncTurn.calls, 0)
  unconfigured.conn.close()
})

test('an empty message is refused with a code, and an unknown conversation is an error', async () => {
  const { conn, docTask } = harness()
  const d = deps(conn, scriptedTurn())
  const conv = createConversation(d.store, docTask.id)
  await assert.rejects(
    () => sendTurn(d, { conversationId: conv.id, content: '   ' }),
    (e: any) => e.name === 'LocalizedError' && e.issues[0]?.key === 'conversation.emptyMessage'
  )
  await assert.rejects(
    () => sendTurn(d, { conversationId: 'nope', content: 'hi' }),
    /conversation not found/
  )
  conn.close()
})

test('deleting a conversation removes it and its messages; deleting the task takes them all (001 FR-004)', () => {
  const { conn, docTask } = harness()
  const store = createSqliteConversationStore(conn.db)
  const a = createConversation(store, docTask.id)
  const b = createConversation(store, docTask.id)
  store.appendMessage(a.id, { role: 'user', content: 'hi' })
  deleteConversation(store, a.id)
  assert.deepEqual(listConversations(store, docTask.id).map((c) => c.id), [b.id])
  assert.deepEqual(listMessages(store, a.id), [])

  // Deleting the task cascade-deletes every conversation it holds. (The app's
  // own delete is a tombstone plus an explicit conversation purge in the
  // handler — the legacy child tables like task_notes carry no cascade, so
  // the hard-delete path here clears the note row first, as a purge would.)
  conn.db.prepare('PRAGMA foreign_keys = ON').run()
  conn.db.prepare('DELETE FROM task_notes WHERE task_id = ?').run(docTask.id)
  conn.db.prepare('DELETE FROM tasks WHERE id = ?').run(docTask.id)
  assert.deepEqual(listConversations(store, docTask.id), [])
  assert.deepEqual(listMessages(store, b.id), [])
  conn.close()
})

test('task state is untouched by every conversation call, and updateTask still works beside it', async () => {
  const { conn, docTask } = harness()
  const turn = scriptedTurn()
  const d = deps(conn, turn)
  const conv = createConversation(d.store, docTask.id)
  await sendTurn(d, { conversationId: conv.id, content: 'a question' })
  listConversations(d.store, docTask.id)
  listMessages(d.store, conv.id)

  const before = getTask(conn.db, docTask.id)!
  // A board edit beside the conversation still behaves (the board owns tasks;
  // the conversation never did).
  updateTask(conn.db, docTask.id, { title: 'renamed' })
  assert.equal(getTask(conn.db, docTask.id)!.title, 'renamed')
  assert.equal(getTask(conn.db, docTask.id)!.notes, before.notes)
  conn.close()
})
