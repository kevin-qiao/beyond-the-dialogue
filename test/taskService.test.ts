import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertRefusedWith } from './helpers/issues'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, type DB } from '../src/main/db'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createTask, setMyDay, updateTask } from '../src/core/services/taskService'
import { setUserDataRoot } from '../src/main/paths'
import { createTypeDef } from '../src/main/types'
import type { StoragePort } from '../src/core/ports/storage'
import type { Settings } from '../src/shared/types'

// The task use cases, exercised through the port rather than through an IPC
// handler.
//
// Feature 002 (D4): the pre-process/suggestion engines are deleted — no board
// interaction starts background AI work any more, so every mutation outcome
// carries an EMPTY enqueue, with the switch on or off. What remains here is
// the routing that survives: input validation against the effective type,
// input discarding on a type switch, and the honest no-op contract.

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
    assistantRuntime: 'on',
    lastCheck: null,
    skills: [],
    mcpServers: []
  }
  saveSettings(conn.db, settings)
  const list = createList(conn.db, 'Work')
  return { conn, storage: createSqliteStorage(conn.db), settings, listId: list.id }
}

/** A custom type with declared inputs, standing in for the retired built-ins. */
function surveyType(db: DB["db"]): void {
  createTypeDef(db, {
    key: 'survey',
    family: 'document',
    label: 'Survey',
    emoji: '🔎',
    inputSchema: [
      { key: 'target', label: 'Target', type: 'text', required: true },
      { key: 'purpose', label: 'Purpose', type: 'textarea' },
      {
        key: 'sourceKind',
        label: 'Source',
        type: 'select',
        options: [
          { value: 'issue', label: 'Issue' },
          { value: 'page', label: 'Page' }
        ]
      }
    ],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
}

test('createTask validates inputs against the effective type before persisting', () => {
  const { conn, storage, listId } = harness()
  surveyType(conn.db)
  // The refusal carries a code: the sentence is applied where the language is
  // known, so the code is what a caller at this layer can rely on.
  assertRefusedWith(
    () => createTask(storage, { listId, title: 'x', type: 'plain', customTypeKey: 'survey', inputs: { sourceKind: 'slack-message' } }),
    'validation.inputNotAnOption'
  )
  assertRefusedWith(
    () => createTask(storage, { listId, title: 'x', type: 'plain', customTypeKey: 'survey', inputs: { nope: '1' } }),
    'validation.unknownInput'
  )
  const ok = createTask(storage, { listId, title: 'x', type: 'plain', customTypeKey: 'survey', inputs: { target: 'eigenvalues' } })
  assert.equal(ok.inputs.target, 'eigenvalues')
  conn.close()
})

test('no board interaction enqueues background work any more (D4)', () => {
  const { conn, storage, settings, listId } = harness()
  surveyType(conn.db)

  // The first My Day add — which used to fire the suggestion job or the
  // category's pre-process — starts nothing.
  const plain = createTask(storage, { listId, title: 'plain', type: 'plain' })
  assert.deepEqual(setMyDay(storage, plain.id, true, settings).enqueue, [])

  const survey = createTask(storage, { listId, title: 'survey', type: 'plain', customTypeKey: 'survey', inputs: { target: 'x' } })
  const added = setMyDay(storage, survey.id, true, settings)
  assert.deepEqual(added.enqueue, [])
  // The retired status column keeps its stored values as history but nothing
  // new ever moves it to 'queued'.
  assert.equal(added.task.preprocessStatus, 'none')

  // Re-adding (or removing) is likewise inert.
  assert.deepEqual(setMyDay(storage, survey.id, true, settings).enqueue, [])
  assert.deepEqual(setMyDay(storage, plain.id, false, settings).enqueue, [])
  conn.close()
})

test('an edit enqueues nothing, whatever changed', () => {
  const { conn, storage, settings, listId } = harness()
  surveyType(conn.db)
  const task = createTask(storage, { listId, title: 'survey', type: 'plain', customTypeKey: 'survey', inputs: { target: 'A' } })
  setMyDay(storage, task.id, true, settings)

  // The hash-gated pre-process re-run is deleted with the engine: a relevant
  // input change is just an edit.
  const relevant = updateTask(storage, { id: task.id, inputs: { target: 'B', purpose: 'go deeper' } }, settings)
  assert.deepEqual(relevant.enqueue, [])
  assert.equal(relevant.task.inputs.target, 'B')
  assert.equal(relevant.task.preprocessStatus, 'none', 'no status ever moves')
  conn.close()
})

test('switching type discards the inputs the new type does not declare', () => {
  const { conn, storage, settings, listId } = harness()
  surveyType(conn.db)
  const task = createTask(storage, { listId, title: 'survey', type: 'plain', customTypeKey: 'survey', inputs: { target: 'A' } })

  const outcome = updateTask(storage, { id: task.id, type: 'document', customTypeKey: null, inputs: { target: 'A' } }, settings)
  assert.equal(outcome.task.type, 'document')
  assert.deepEqual(outcome.task.inputs, {}, 'the previous type’s inputs are not carried across')
  assert.deepEqual(outcome.enqueue, [])
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

// ---- the assistant switch: board work never depends on it (FR-021) ----

test('with the switch off, board interactions behave exactly as with it on', () => {
  const { conn, storage, settings, listId } = harness()
  surveyType(conn.db)
  const off: Settings = { ...settings, assistantRuntime: 'off' }

  // The honest form of the old gate: there is nothing left to gate. Adds and
  // edits are pure board work in both switch states.
  for (const s of [settings, off]) {
    const t = createTask(storage, { listId, title: `t-${s.assistantRuntime}`, type: 'plain', customTypeKey: 'survey', inputs: { target: 'x' } })
    assert.deepEqual(setMyDay(storage, t.id, true, s).enqueue, [])
    assert.deepEqual(updateTask(storage, { id: t.id, inputs: { target: 'CHANGED' } }, s).enqueue, [])
    assert.equal(storage.getTask(t.id)!.preprocessStatus, 'none')
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
