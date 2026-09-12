import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, savePreprocess, type DB } from '../src/main/db'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createTask, setMyDay, updateTask } from '../src/core/services/taskService'
import { setUserDataRoot } from '../src/main/paths'
import { createTypeDef, effectiveTypeDef, preprocessInputHash } from '../src/main/types'
import type { StoragePort } from '../src/core/ports/storage'
import type { Settings } from '../src/shared/types'

// The task use cases, exercised through the port rather than through an IPC
// handler. These rules used to live inside `src/main/index.ts`, where nothing
// could reach them without launching Electron — so the routing decisions
// (which job to enqueue, when a re-run is due) were the least tested part of
// the app.

function harness(configured = true): { conn: DB; storage: StoragePort; settings: Settings; listId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-tasksvc-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  const settings: Settings = {
    provider: 'openai',
    model: configured ? 'gpt-4o' : '',
    apiKey: configured ? 'sk-scripted' : null,
    wikiPath: path.join(dir, 'wiki'),
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: []
  }
  saveSettings(conn.db, settings)
  const list = createList(conn.db, 'Work')
  return { conn, storage: createSqliteStorage(conn.db), settings, listId: list.id }
}

test('createTask validates inputs against the effective type before persisting', () => {
  const { conn, storage, listId } = harness()
  assert.throws(
    () => createTask(storage, { listId, title: 'x', type: 'jira', inputs: { sourceKind: 'slack-message' } }),
    /must be one of/
  )
  assert.throws(() => createTask(storage, { listId, title: 'x', type: 'learning', inputs: { nope: '1' } }), /unknown input/)
  const ok = createTask(storage, { listId, title: 'x', type: 'learning', inputs: { target: 'eigenvalues' } })
  assert.equal(ok.inputs.target, 'eigenvalues')
  conn.close()
})

test('a first My Day add requests the category-appropriate work, never both', () => {
  const { conn, storage, settings, listId } = harness()

  const plain = createTask(storage, { listId, title: 'plain', type: 'plain' })
  assert.deepEqual(setMyDay(storage, plain.id, true, settings).enqueue, ['suggestion'])

  // A category with a pre-process gets that instead; its activity suggestions
  // arrive as chips from the pre-process output, so the two never both run.
  const learning = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'x' } })
  const added = setMyDay(storage, learning.id, true, settings)
  assert.deepEqual(added.enqueue, ['preprocess'])
  assert.equal(added.task.preprocessStatus, 'queued')

  // Re-adding (or removing) is not a first add.
  assert.deepEqual(setMyDay(storage, learning.id, true, settings).enqueue, [])
  assert.deepEqual(setMyDay(storage, plain.id, false, settings).enqueue, [])
  conn.close()
})

test('with no provider configured, a first add requests nothing', () => {
  const { conn, storage, settings, listId } = harness(false)
  const learning = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'x' } })
  assert.deepEqual(setMyDay(storage, learning.id, true, settings).enqueue, [])
  conn.close()
})

test('an edit that changes a relevant input re-runs pre-processing, an irrelevant one does not', () => {
  const { conn, storage, settings, listId } = harness()
  // A type declaring an INERT extra field, so the assertion is about the
  // mechanism rather than about the built-in learning schema (which no longer
  // declares one — the per-task skill/MCP placeholders were retired in v7).
  createTypeDef(conn.db, {
    key: 'learn_inert',
    kind: 'learning',
    label: 'Learn with inert',
    emoji: '🎓',
    inputSchema: [
      { key: 'target', label: 'Target', type: 'text', required: true },
      { key: 'purpose', label: 'Purpose', type: 'textarea' },
      { key: 'decoration', label: 'Decoration', type: 'text', inert: true }
    ],
    isBuiltin: false,
    finishBehaviour: 'complete-only',
    grants: { skills: [], toolServers: [] }
  })
  const task = createTask(storage, { listId, title: 'learn', type: 'plain', customTypeKey: 'learn_inert', inputs: { target: 'A' } })
  setMyDay(storage, task.id, true, settings)
  // Stand in for a completed run that consumed the current inputs.
  const def = effectiveTypeDef(conn.db, task)!
  savePreprocess(conn.db, {
    taskId: task.id,
    kind: 'learning',
    summary: '',
    analysis: '',
    suggestions: [],
    generatedPrompt: '',
    status: 'ready',
    inputsHash: preprocessInputHash(storage.getTask(task.id)!, def)
  })
  // A completed run: the gate refuses to re-run while one is in flight, so
  // without this both assertions below would pass vacuously.
  storage.updateTask(task.id, { preprocessStatus: 'ready' })

  // An inert field is declared but does not feed the pre-process, so changing
  // it must NOT invalidate the run.
  const inertOnly = updateTask(storage, { id: task.id, inputs: { target: 'A', decoration: 'x' } }, settings)
  assert.deepEqual(inertOnly.enqueue, [], 'an inert input change does not invalidate the outputs')

  const relevant = updateTask(storage, { id: task.id, inputs: { target: 'A', decoration: 'x', purpose: 'go deeper' } }, settings)
  assert.deepEqual(relevant.enqueue, ['preprocess'])
  assert.equal(relevant.task.preprocessStatus, 'queued')
  conn.close()
})

test('an edit never re-runs for a task that is not in My Day or is already running', () => {
  const { conn, storage, settings, listId } = harness()
  const task = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'A' } })

  // Not in My Day.
  assert.deepEqual(updateTask(storage, { id: task.id, inputs: { target: 'B' } }, settings).enqueue, [])

  setMyDay(storage, task.id, true, settings)
  // A run is in flight.
  assert.deepEqual(updateTask(storage, { id: task.id, inputs: { target: 'B' } }, settings).enqueue, [])

  storage.updateTask(task.id, { preprocessStatus: 'ready' })
  assert.deepEqual(updateTask(storage, { id: task.id, inputs: { target: 'C' } }, settings).enqueue, ['preprocess'])
  conn.close()
})

test('switching type discards inputs and does not trigger a re-run on its own', () => {
  const { conn, storage, settings, listId } = harness()
  const task = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'A' } })
  setMyDay(storage, task.id, true, settings)
  storage.updateTask(task.id, { preprocessStatus: 'ready' })

  const outcome = updateTask(storage, { id: task.id, type: 'jira', customTypeKey: null, inputs: { target: 'A' } }, settings)
  assert.equal(outcome.task.type, 'jira')
  assert.deepEqual(outcome.task.inputs, {}, 'the previous type’s inputs are not carried across')
  assert.deepEqual(outcome.enqueue, [], 'the My Day re-add is what re-runs, with the new type’s inputs')
  conn.close()
})

test('editing a task that no longer exists is an error, not a silent no-op', () => {
  const { conn, storage, settings } = harness()
  assert.throws(() => updateTask(storage, { id: 'nope', title: 'x' }, settings), /task not found/)
  assert.throws(() => setMyDay(storage, 'nope', true, settings), /task not found/)
  conn.close()
})

// ---- the settings use case (same extraction, same reason) ----

test('saveSettings applies the plugin rules and the first-run rule, then persists', async () => {
  const { conn, storage } = harness()
  const { saveSettings: save } = await import('../src/core/services/settingsService')
  const base = storage.loadSettings()

  assert.throws(
    () => save(storage, { ...base, skills: [{ name: 'dup', description: '', path: '/a' }, { name: 'dup', description: '', path: '/b' }] }),
    /name must be unique/
  )
  assert.throws(
    () => save(storage, { ...base, mcpServers: [{ name: 's', transport: { type: 'stdio', command: '' } }] }),
    /a command is required/
  )
  // A refused save persists nothing.
  assert.deepEqual(storage.loadSettings().skills, [])

  // Configuring a key completes first-run setup.
  const saved = save(storage, { ...base, apiKey: 'sk-x', showWelcome: true })
  assert.equal(saved.showWelcome, false)
  assert.equal(storage.loadSettings().apiKey, 'sk-x')
  conn.close()
})
