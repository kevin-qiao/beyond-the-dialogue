import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, saveSettings, getTask, type DB } from '../src/main/db'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createTask, setMyDay, updateTask } from '../src/core/services/taskService'
import { runPreprocess } from '../src/core/services/preprocessService'
import { finishTask } from '../src/core/services/finishService'
import { createTypeDef } from '../src/main/types'
import { setUserDataRoot } from '../src/main/paths'
import { setSessionFactory, setSimplePromptOverride, type JobSessionLike } from '../src/main/ai/session-factory'
import { setMcpAdapterFactory } from '../src/main/adapters/agent/mcpAdapter'
import { folderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { isAssistantEnabled } from '../src/core/domain/assistant'
import type { Settings, TaskTypeDef } from '../src/shared/types'
import type { AgentSessionPort } from '../src/core/ports/agent'
import type { FinishDeps } from '../src/core/services/finishService'

// FR-014/FR-015, research D1/D7: with the switch off the harness is not just
// quiet — it is STRUCTURALLY unreachable. Every seam that could construct an
// agent session, a single-shot prompt, or an MCP extension counts its
// constructions here, and the count must stay ZERO across a full board day.

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
  // A meeting type that WOULD polish-and-file: the type the switch must stop.
  createTypeDef(conn.db, {
    key: 'minutes',
    kind: 'meeting',
    label: 'Minutes',
    emoji: '🗓',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: minutesDir, subdir: '' },
    grants: { skills: ['a-skill'], toolServers: ['a-server'] }
  } as TaskTypeDef)
  return { conn, settings, listId: list.id, minutesDir }
}

test('a full board day with the switch off constructs NOTHING at any seam (FR-014/FR-015)', () => {
  const { conn, settings, listId } = harness()
  installCountingSeams()
  const storage = createSqliteStorage(conn.db)

  // Capture, flesh out, My Day — every board action with configured plugins
  // present and keys stored. D7's suggestion fire is the case that used to
  // reach the network from a plain interaction.
  const plain = createTask(storage, { listId, title: 'write the brief', type: 'plain' })
  assert.deepEqual(setMyDay(storage, plain.id, true, settings).enqueue, [])
  const learning = createTask(storage, { listId, title: 'read the paper', type: 'learning', inputs: { target: 'x' } })
  assert.deepEqual(setMyDay(storage, learning.id, true, settings).enqueue, [])
  const meeting = createTask(storage, { listId, title: 'standup', type: 'meeting' })
  assert.deepEqual(setMyDay(storage, meeting.id, true, settings).enqueue, [])

  // An edit that WOULD re-run a pre-process hash-wise (research D3's gate).
  setMyDay(storage, learning.id, true, { ...settings, assistantRuntime: 'on' })
  storage.updateTask(learning.id, { preprocessStatus: 'ready' })
  const off: Settings = { ...settings, assistantRuntime: 'off' }
  assert.equal(isAssistantEnabled(off), false)
  assert.deepEqual(updateTask(storage, { id: learning.id, inputs: { target: 'CHANGED' } }, off).enqueue, [])

  assert.deepEqual(constructions.kind, [], 'no agent session was built')
  assert.equal(simplePrompts, 0, 'no single-shot prompt ran')
  assert.equal(mcpFactories, 0, 'no MCP extension was constructed')
  conn.close()
})

test('assistant refusals are codes, not crashes: run-preprocess and finish while off', async () => {
  const { conn, settings, listId, minutesDir } = harness()
  installCountingSeams()
  const storage = createSqliteStorage(conn.db)

  // tasks:run-preprocess refuses with assistant.disabled.
  const learning = createTask(storage, { listId, title: 'paper', type: 'learning', inputs: { target: 'x' } })
  assert.throws(
    () => runPreprocess(storage, learning.id, settings),
    (e: any) => e.name === 'PreprocessRefused' && e.issues[0]?.key === 'assistant.disabled'
  )

  // tasks:finish on a wiki/folder-destined type refuses while off — BEFORE
  // completion (finishService ordering).
  const meeting = createTask(storage, { listId, title: 'standup', type: 'meeting', customTypeKey: 'minutes' })
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
    () => finishTask(deps, meeting.id),
    (e: any) => e.name === 'FinishRefused' && e.issues[0]?.key === 'assistant.disabled'
  )
  assert.equal(getTask(conn.db, meeting.id)!.completed, false, 'refused before marking complete')
  assert.deepEqual(fs.readdirSync(minutesDir), [], 'and before writing anything')

  // The board half of finish still works while off: complete-only is board.
  const plain = createTask(storage, { listId, title: 'pay rent', type: 'plain' })
  const outcome = await finishTask(deps, plain.id)
  assert.equal(outcome.task.completed, true)

  assert.deepEqual(constructions.kind, [], 'not even the refused paths built a session')
  conn.close()
})
