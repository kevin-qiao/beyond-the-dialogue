import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertRefusedWith } from './helpers/issues'
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
    hasApiKey: configured,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    uiLanguage: 'en',
    // These pins exercise the ASSISTANT paths (the hash-gate, the My Day
    // first-add rules), so the switch is on. The off-gate pins below flip it.
    assistantRuntime: 'on',
    lastCheck: null,
    skills: [],
    mcpServers: []
  }
  saveSettings(conn.db, settings)
  const list = createList(conn.db, 'Work')
  return { conn, storage: createSqliteStorage(conn.db), settings, listId: list.id }
}

test('createTask validates inputs against the effective type before persisting', () => {
  const { conn, storage, listId } = harness()
  // The refusal carries a code: the sentence is applied where the language is
  // known, so the code is what a caller at this layer can rely on.
  assertRefusedWith(
    () => createTask(storage, { listId, title: 'x', type: 'jira', inputs: { sourceKind: 'slack-message' } }),
    'validation.inputNotAnOption'
  )
  assertRefusedWith(() => createTask(storage, { listId, title: 'x', type: 'learning', inputs: { nope: '1' } }), 'validation.unknownInput')
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

  assertRefusedWith(
    () => save(storage, { ...base, skills: [{ name: 'dup', description: '', path: '/a' }, { name: 'dup', description: '', path: '/b' }] }),
    'plugin.skill.nameUnique'
  )
  assertRefusedWith(
    () => save(storage, { ...base, mcpServers: [{ name: 's', config: { command: '' } }] }),
    'plugin.mcp.transportAmbiguous'
  )
  // A refused save persists nothing.
  assert.deepEqual(storage.loadSettings().skills, [])

  // Configuring a key completes first-run setup.
  const saved = save(storage, { ...base, hasApiKey: true, showWelcome: true })
  assert.equal(saved.showWelcome, false)
  assert.equal(storage.loadSettings().hasApiKey, true)
  conn.close()
})

// ---- the assistant switch gates the enqueues (feature 001, T004, FR-015,
// research D7) ----

test('with the switch off, no My Day add enqueues anything and nothing is queued', () => {
  const { conn, storage, settings, listId } = harness()
  const off: Settings = { ...settings, assistantRuntime: 'off' }

  // The plain-task suggestion — the one place a BOARD interaction used to
  // reach the network (D7) — never fires.
  const plain = createTask(storage, { listId, title: 'plain', type: 'plain' })
  const plainAdd = setMyDay(storage, plain.id, true, off)
  assert.deepEqual(plainAdd.enqueue, [])

  // A pre-processable category neither enqueues nor flips preprocess_status.
  const learning = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'x' } })
  const learnAdd = setMyDay(storage, learning.id, true, off)
  assert.deepEqual(learnAdd.enqueue, [])
  assert.equal(learnAdd.task.preprocessStatus, 'none', 'no queued status while off')

  // Meeting likewise.
  const meeting = createTask(storage, { listId, title: 'standup', type: 'meeting' })
  assert.deepEqual(setMyDay(storage, meeting.id, true, off).enqueue, [])
  conn.close()
})

test('with the switch off, an edit never re-runs pre-processing — even a relevant input change', () => {
  const { conn, storage, settings, listId } = harness()
  const off: Settings = { ...settings, assistantRuntime: 'off' }
  const task = createTask(storage, { listId, title: 'learn', type: 'learning', inputs: { target: 'A' } })
  setMyDay(storage, task.id, true, off) // no-op
  storage.updateTask(task.id, { preprocessStatus: 'ready' })

  const outcome = updateTask(storage, { id: task.id, inputs: { target: 'CHANGED' } }, off)
  assert.deepEqual(outcome.enqueue, [])
  assert.equal(outcome.task.preprocessStatus, 'ready', 'the status never moves to queued')
  conn.close()
})

test('the switch is read from settings at the service edge, not from a kind comparison', () => {
  // The gate covers EVERY category identically: plain, learning, meeting all
  // get zero enqueue while off — there is no branch that could forget one
  // (Principle I). The three assertions above are the census; this one names
  // the mechanism.
  const { conn, storage, settings, listId } = harness()
  const off: Settings = { ...settings, assistantRuntime: 'off' }
  for (const type of ['plain', 'learning', 'meeting'] as const) {
    const t = createTask(storage, { listId, title: `t-${type}`, type, inputs: type === 'learning' ? { target: 'x' } : {} })
    assert.deepEqual(setMyDay(storage, t.id, true, off).enqueue, [], type)
  }
  conn.close()
})

// ---- the redaction / split rules (feature 001, T016, FR-020) ----

test('toRedacted keeps Settings secret-free and flags MCP env presence', async () => {
  const { conn, storage } = harness()
  const { toRedacted, saveSettings } = await import('../src/core/services/settingsService')
  // A server row as it persists post-v10: shape without env.
  saveSettings(storage, { ...storage.loadSettings(), mcpServers: [{ name: 'jira', config: { command: 'npx' } }] })
  const stored = { machineFingerprint: 'm', providerKeys: { openai: 'sk-x' }, mcpEnv: { jira: { TOKEN: 't' } } }
  const redacted = toRedacted(storage.loadSettings(), stored)
  assert.equal('apiKey' in redacted, false)
  const servers = redacted.mcpServers as { name: string; hasEnv?: boolean }[]
  assert.equal(servers.find((s) => s.name === 'jira')?.hasEnv, true)
  assert.equal(servers.length, 1, 'rows only — the env from the store never becomes a server')
  conn.close()
})

test('splitInput merges by the write-only rule: present stores, absent keeps, never clears', async () => {
  const { conn, storage } = harness()
  const { splitInput } = await import('../src/core/services/settingsService')
  const base = storage.loadSettings()
  const existing = { machineFingerprint: 'm', providerKeys: { openai: 'sk-old' }, mcpEnv: {} }

  // No key in the payload ⇒ no instruction, presence stands from the row.
  const keep = splitInput({ ...base, hasApiKey: true }, existing)
  assert.equal(keep.secrets.providerKey, undefined)
  assert.equal(keep.settings.hasApiKey, true)

  // A typed key ⇒ it is the instruction; the persisted shape never carries it.
  const store = splitInput({ ...base, apiKey: 'sk-new' }, existing)
  assert.deepEqual(store.secrets.providerKey, { provider: 'openai', value: 'sk-new' })
  assert.equal('apiKey' in store.settings, false)

  // An empty string is absent, not a clear.
  assert.equal(splitInput({ ...base, apiKey: '' }, existing).secrets.providerKey, undefined)

  // A pasted server's env is split out of the config into the instruction.
  const envSplit = splitInput(
    { ...base, mcpServers: [{ name: 'gh', config: { command: 'x', env: { TOKEN: 'g' } } }] },
    existing
  )
  assert.deepEqual(envSplit.secrets.mcpEnv.gh, { TOKEN: 'g' })
  assert.deepEqual(envSplit.settings.mcpServers[0]!.config, { command: 'x' })
  conn.close()
})

// ---- FR-001 at the core edge (T021) ----

test('a title-less create and a blanking edit are refused as codes in the core', async () => {
  const { conn, storage, settings, listId } = harness()
  assertRefusedWith(() => createTask(storage, { listId, title: '  ', type: 'plain' }), 'task.field.titleRequired')
  const t = createTask(storage, { listId, title: 'ok', type: 'plain' })
  assertRefusedWith(() => updateTask(storage, { id: t.id, title: '' }, settings), 'task.field.titleRequired')
  conn.close()
})
