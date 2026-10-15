import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, saveSettings, getTask, type DB } from '../src/main/db'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createTask, setMyDay, updateTask } from '../src/core/services/taskService'
import { finishTask } from '../src/core/services/finishService'
import { createTypeDef } from '../src/main/types'
import { setUserDataRoot } from '../src/main/paths'
import { setSessionFactory, setSimplePromptOverride, type JobSessionLike } from '../src/main/ai/session-factory'
import { setMcpAdapterFactory } from '../src/main/adapters/agent/mcpAdapter'
import { folderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { isAssistantEnabled } from '../src/core/domain/assistant'
import type { Settings } from '../src/shared/types'
import type { AgentSessionPort } from '../src/core/ports/agent'
import type { FinishDeps } from '../src/core/services/finishService'

// FR-015/FR-021: with the switch off the harness is not just quiet — it is
// STRUCTURALLY unreachable from board work. Every seam that could construct
// an agent session, a single-shot prompt, or an MCP extension counts its
// constructions here, and the count must stay ZERO across a full board day.
//
// Feature 002 note: the run-preprocess refusal this file used to pin is
// deleted with the engine (D4) — there is no board interaction left that
// COULD start AI work, so the off-state guarantee is the stronger one: zero
// seams, period. The finish half below pins the 001-era off-state refusal;
// T016 re-argues it (off forces the as-written path rather than refusing) and
// updates these assertions with it.

let constructions: { kind: string[] } = { kind: [] }
let simplePrompts = 0
let mcpFactories = 0

function installCountingSeams(): void {
  constructions = { kind: [] }
  simplePrompts = 0
  mcpFactories = 0
  setSessionFactory(async (opts) => {
    constructions.kind.push(`session:${opts.purpose ?? '?'}`)
    return {
      subscribe: () => () => {},
      async prompt() {},
      messages: [],
      async abort() {},
      async dispose() {}
    } as JobSessionLike
  })
  setSimplePromptOverride(async () => {
    simplePrompts++
    return '[]'
  })
  setMcpAdapterFactory(((snapshot: unknown) => {
    mcpFactories++
    return { snapshot }
  }) as never)
}

afterEach(() => {
  setSessionFactory(null)
  setSimplePromptOverride(null)
  setMcpAdapterFactory(null)
})

function offSettings(): Settings {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    hasApiKey: true,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    uiLanguage: 'en',
    assistantRuntime: 'off',
    lastCheck: null,
    skills: [{ name: 'a-skill', description: '', path: '/skills/a-skill' }],
    mcpServers: [{ name: 'a-server', config: { command: 'npx' } }]
  }
}

function harness(): { conn: DB; settings: Settings; listId: string; minutesDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-switch-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  const settings = offSettings()
  saveSettings(conn.db, settings)
  const list = createList(conn.db, 'Work')
  const minutesDir = path.join(dir, 'minutes')
  ensureDestination(minutesDir)
  // A document type that WOULD organize-and-file: the type whose assistant
  // step the switch must stop. No grants exist any more (D9).
  createTypeDef(conn.db, {
    key: 'minutes',
    family: 'document',
    label: 'Minutes',
    emoji: '🗓',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: minutesDir, subdir: '' }
  })
  return { conn, settings, listId: list.id, minutesDir }
}

test('a full board day with the switch off constructs NOTHING at any seam (FR-015/FR-021)', () => {
  const { conn, settings, listId } = harness()
  installCountingSeams()
  const storage = createSqliteStorage(conn.db)

  // Capture, flesh out, My Day — every board action with configured plugins
  // present and keys stored. Since D4 no board interaction enqueues AI work
  // at all, in either switch state.
  const plain = createTask(storage, { listId, title: 'write the brief', type: 'plain' })
  assert.deepEqual(setMyDay(storage, plain.id, true, settings).enqueue, [])
  const doc = createTask(storage, { listId, title: 'draft the post', type: 'document' })
  assert.deepEqual(setMyDay(storage, doc.id, true, settings).enqueue, [])
  const minutes = createTask(storage, { listId, title: 'standup', type: 'plain', customTypeKey: 'minutes' })
  assert.deepEqual(setMyDay(storage, minutes.id, true, settings).enqueue, [])

  // An edit — which used to be hash-gated pre-process territory — is pure
  // board work now.
  const off: Settings = { ...settings, assistantRuntime: 'off' }
  assert.equal(isAssistantEnabled(off), false)
  assert.deepEqual(updateTask(storage, { id: doc.id, title: 'draft the post v2' }, off).enqueue, [])
  // And the same with the switch ON: the engines are gone, so there is
  // nothing a board action could start.
  assert.deepEqual(setMyDay(storage, doc.id, true, { ...settings, assistantRuntime: 'on' }).enqueue, [])

  assert.deepEqual(constructions.kind, [], 'no agent session was built')
  assert.equal(simplePrompts, 0, 'no single-shot prompt ran')
  assert.equal(mcpFactories, 0, 'no MCP extension was constructed')
  conn.close()
})

test('finish while off refuses a filing behaviour BEFORE completion — and complete-only still works', async () => {
  const { conn, settings, listId, minutesDir } = harness()
  installCountingSeams()
  const storage = createSqliteStorage(conn.db)

  // NOTE (T016): this pins the 001-era off-state: a non-complete-only finish
  // refuses with assistant.disabled. Feature 002 replaces the refusal with the
  // forced as-written path (FR-006/FR-021: the board never blocks on AI, and
  // off files the user's words with zero outbound calls); this assertion
  // flips with that task.
  const minutes = createTask(storage, { listId, title: 'standup', type: 'plain', customTypeKey: 'minutes' })
  const deps: FinishDeps = {
    language: 'en',
    assistantEnabled: false,
    paths: nodePathPort,
    storage,
    storeFor: () => folderArtifactStore,
    session: { isAvailable: () => true, async run() { constructions.kind.push('finish-session'); return '' } } as unknown as AgentSessionPort,
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: () => {}
  }
  await assert.rejects(
    () => finishTask(deps, minutes.id),
    (e: any) => e.name === 'FinishRefused' && e.issues[0]?.key === 'assistant.disabled'
  )
  assert.equal(getTask(conn.db, minutes.id)!.completed, false, 'refused before marking complete')
  assert.deepEqual(fs.readdirSync(minutesDir), [], 'and before writing anything')

  // The board half of finish still works while off: complete-only is board.
  const plain = createTask(storage, { listId, title: 'pay rent', type: 'plain' })
  const outcome = await finishTask(deps, plain.id)
  assert.equal(outcome.task.completed, true)

  assert.deepEqual(constructions.kind, [], 'not even the refused paths built a session')
  conn.close()
})
