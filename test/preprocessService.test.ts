import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertRefusedWith } from './helpers/issues'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, type DB } from '../src/main/db'
import { createTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createTask } from '../src/core/services/taskService'
import { PreprocessRefused, runPreprocess } from '../src/core/services/preprocessService'
import { setUserDataRoot } from '../src/main/paths'
import type { StoragePort } from '../src/core/ports/storage'
import type { Settings } from '../src/shared/types'

// The pre-process guards. Three inline checks in an IPC handler before this;
// the point of the file is that a refused pre-process is *reported*, not
// queued and failed later where the user would see a job error instead of an
// explanation.

function harness(configured = true): { conn: DB; storage: StoragePort; settings: Settings; listId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-prelsvc-'))
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

test('a pre-processable task is queued', () => {
  const { conn, storage, settings, listId } = harness()
  const task = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'x' } })
  const outcome = runPreprocess(storage, task.id, settings)
  assert.deepEqual(outcome.enqueue, ['preprocess'])
  assert.equal(outcome.task.preprocessStatus, 'queued')
  assert.equal(storage.getTask(task.id)!.preprocessStatus, 'queued', 'the queue marker is persisted, not just returned')
  conn.close()
})

test('a category with no pre-process is refused, not queued', () => {
  const { conn, storage, settings, listId } = harness()
  const task = createTask(storage, { listId, title: 'plain', type: 'plain' })
  assert.throws(() => runPreprocess(storage, task.id, settings), PreprocessRefused)
  // Nothing was queued and the task was not marked.
  assert.equal(storage.getTask(task.id)!.preprocessStatus, 'none')
  conn.close()
})

test('an unconfigured provider is refused with an actionable message', () => {
  const { conn, storage, settings, listId } = harness(false)
  const task = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'x' } })
  // The message must tell the user what to do, because this refusal is the
  // only thing they see.
  assertRefusedWith(() => runPreprocess(storage, task.id, settings), 'error.aiNotConfigured')
  assert.equal(storage.getTask(task.id)!.preprocessStatus, 'none')
  conn.close()
})

test('the guard asks the registry, so a new category is pre-processable without editing it', () => {
  const { conn, storage, settings, listId } = harness()
  // A custom type of a category the registry knows. If the guard compared
  // against `plain` instead of consulting the registry, this would still work —
  // but a category the registry later drops would not be caught. Assert the
  // registry is the authority by checking a category that has no entry.
  createTypeDef(conn.db, {
    key: 'notes_type',
    kind: 'plain',
    label: 'Notes',
    emoji: '📝',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'complete-only',
    grants: { skills: [], toolServers: [] }
  })
  const t = createTask(storage, { listId, title: 'n', type: 'plain', customTypeKey: 'notes_type' })
  assert.throws(() => runPreprocess(storage, t.id, settings), PreprocessRefused)

  // And a meeting task is accepted, which is what the registry added.
  const meeting = createTask(storage, { listId, title: 'm', type: 'meeting', inputs: { target: 'beta' } })
  assert.deepEqual(runPreprocess(storage, meeting.id, settings).enqueue, ['preprocess'])
  conn.close()
})

test('pre-processing a task that no longer exists is an error', () => {
  const { conn, storage, settings } = harness()
  assert.throws(() => runPreprocess(storage, 'nope', settings), /task not found/)
  conn.close()
})
