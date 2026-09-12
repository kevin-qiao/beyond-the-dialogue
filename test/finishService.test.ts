import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createTask, saveNotes, getTask, listIngest, createList } from '../src/main/db'
import { createTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { folderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, FinishRefused, type FinishDeps } from '../src/core/services/finishService'
import { setUserDataRoot } from '../src/main/paths'
import type { AgentSessionPort } from '../src/core/ports/agent'
import type { DB } from '../src/main/db'
import type { TaskTypeDef } from '../src/shared/types'

// The finish service: ordering and refusal guarantees that the strategies
// cannot express on their own, because they are about what happens AROUND the
// behaviour — specifically, that nothing is marked complete until the finish
// is known to have succeeded.

const MINUTES = 'Decision: ship the beta in March.\n\nAna raised the onboarding drop-off.\n'

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-finsvc-'))
  setUserDataRoot(dir)
  const conn: DB = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-scripted',
    wikiPath: path.join(dir, 'wiki'),
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: []
  })
  const destDir = path.join(dir, 'minutes')
  ensureDestination(destDir)

  createTypeDef(conn.db, {
    key: 'minutes',
    kind: 'meeting',
    label: 'Minutes',
    emoji: '🗓',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: destDir, subdir: '' },
    grants: { skills: [], toolServers: [] }
  } as TaskTypeDef)

  const list = createList(conn.db, 'Work')
  const task = createTask(conn.db, { listId: list.id, title: 'Weekly sync', type: 'meeting', customTypeKey: 'minutes', inputs: {} })
  saveNotes(conn.db, { taskId: task.id, notePath: path.join(dir, 'note.md'), content: MINUTES })

  return { dir, conn, destDir, task }
}

function depsFor(conn: DB, session: AgentSessionPort, wikiRoot: string): FinishDeps {
  return {
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: () => folderArtifactStore,
    session,
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    wikiRoot: () => wikiRoot,
    enqueueCurate: () => {}
  }
}

const polishedSession = (): AgentSessionPort => ({
  isAvailable: () => true,
  async run() {
    return JSON.stringify({
      polished: '**Decision:** ship the beta in March.\n\nAna raised the onboarding drop-off.',
      actionItems: ['Ana raised the onboarding drop-off'],
      preservedFacts: ['ship the beta in March']
    })
  }
})

test('a successful finish marks the task complete and records the artifact', async () => {
  const { conn, destDir, task } = harness()
  const outcome = await finishTask(depsFor(conn, polishedSession(), destDir), task.id)

  assert.equal(outcome.behaviour, 'polish-then-file')
  assert.equal(outcome.deferred, false)
  assert.equal(getTask(conn.db, task.id)!.completed, true)

  const file = fs.readdirSync(destDir)
  assert.deepEqual(file, ['weekly-sync.md'])
  const written = fs.readFileSync(path.join(destDir, 'weekly-sync.md'), 'utf-8')
  assert.ok(written.includes('## Action items'), 'the action-items section is present')

  // The outcome reached the activity record, with the files it touched.
  const activity = listIngest(conn.db)
  assert.equal(activity.length, 1)
  assert.equal(activity[0]!.state, 'done')
  assert.deepEqual(activity[0]!.touchedFiles, ['weekly-sync.md'])
  conn.close()
})

test('the destination is validated BEFORE the task is marked complete', async () => {
  const { conn, dir, task } = harness()
  // The configured folder disappears between saving the type and finishing.
  const gone = path.join(dir, 'vanished')
  const deps = depsFor(conn, polishedSession(), gone)
  deps.storage.listTypes = () =>
    [
      {
        key: 'minutes',
        kind: 'meeting',
        label: 'Minutes',
        emoji: '🗓',
        inputSchema: [],
        isBuiltin: false,
        finishBehaviour: 'polish-then-file',
        destination: { store: 'folder', rootPath: gone, subdir: '' },
        grants: { skills: [], toolServers: [] }
      } as TaskTypeDef
    ]

  await assert.rejects(() => finishTask(deps, task.id), /does not exist/)

  // Not completed, so the user can fix the destination and try again (FR-027).
  assert.equal(getTask(conn.db, task.id)!.completed, false)
  // ...and nothing was written anywhere.
  assert.equal(fs.existsSync(gone), false)
  conn.close()
})

test('the task is NOT marked complete when the artifact step fails', async () => {
  const { conn, destDir, task } = harness()
  // The destination exists and is writable, but the write itself fails.
  const deps = depsFor(conn, polishedSession(), destDir)
  deps.storeFor = () => ({
    ...folderArtifactStore,
    async prepare() {},
    async writeArtifact() {
      throw new Error('disk on fire')
    }
  })

  await assert.rejects(() => finishTask(deps, task.id), FinishRefused)
  assert.equal(getTask(conn.db, task.id)!.completed, false, 'a failed artifact step leaves the task open')
  assert.equal(fs.readdirSync(destDir).length, 0, 'no partial file was left behind')
  conn.close()
})

test('a failure reaches the activity record', async () => {
  const { conn, destDir, task } = harness()
  const deps = depsFor(conn, polishedSession(), destDir)
  deps.storeFor = () => ({
    ...folderArtifactStore,
    async prepare() {},
    async writeArtifact() {
      throw new Error('disk on fire')
    }
  })
  await assert.rejects(() => finishTask(deps, task.id))

  const activity = listIngest(conn.db)
  assert.equal(activity.length, 1, 'the failure is recorded, not swallowed')
  assert.equal(activity[0]!.state, 'failed')
  assert.equal(activity[0]!.error, 'disk on fire')
  conn.close()
})

test('missing required inputs refuse the finish before anything else happens', async () => {
  const { conn, destDir, task } = harness()
  const deps = depsFor(conn, polishedSession(), destDir)
  deps.storage.listTypes = () =>
    [
      {
        key: 'minutes',
        kind: 'meeting',
        label: 'Minutes',
        emoji: '🗓',
        inputSchema: [{ key: 'target', label: 'Objective', type: 'text', required: true }],
        isBuiltin: false,
        finishBehaviour: 'polish-then-file',
        destination: { store: 'folder', rootPath: destDir, subdir: '' },
        grants: { skills: [], toolServers: [] }
      } as TaskTypeDef
    ]

  await assert.rejects(() => finishTask(deps, task.id), /missing required input\(s\): Objective/)
  assert.equal(getTask(conn.db, task.id)!.completed, false)
  assert.deepEqual(fs.readdirSync(destDir), [])
  conn.close()
})

test('no AI provider still completes the finish and files the user content', async () => {
  const { conn, destDir, task } = harness()
  const unavailable: AgentSessionPort = { isAvailable: () => false, async run() {
    throw new Error('must not be called')
  } }
  const outcome = await finishTask(depsFor(conn, unavailable, destDir), task.id)

  assert.equal(outcome.task.completed, true, 'finishing never fails solely because AI is unavailable')
  assert.equal(outcome.result!.assistantStep, 'failed')
  assert.equal(fs.readFileSync(path.join(destDir, 'weekly-sync.md'), 'utf-8'), MINUTES)

  const activity = listIngest(conn.db)
  assert.equal(activity[0]!.state, 'done')
  assert.ok(activity[0]!.error?.includes('no AI provider'), 'the skipped assistant step is reported')
  conn.close()
})

test('finishing twice leaves both versions, neither overwritten', async () => {
  const { conn, destDir, task } = harness()
  await finishTask(depsFor(conn, polishedSession(), destDir), task.id)
  await finishTask(depsFor(conn, polishedSession(), destDir), task.id)

  assert.deepEqual(fs.readdirSync(destDir).sort(), ['weekly-sync-2.md', 'weekly-sync.md'])
  conn.close()
})
