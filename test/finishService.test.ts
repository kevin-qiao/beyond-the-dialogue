import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueKeysOf, issueParamsOf } from './helpers/issues'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createTask, saveNotes, getTask, listIngest, createList } from '../src/main/db'
import { createTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { folderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import {
  finishTask,
  resolveBehaviour,
  defaultFinishMode,
  resolveFinishMode,
  FinishRefused,
  type FinishDeps
} from '../src/core/services/finishService'
import { setUserDataRoot } from '../src/main/paths'
import type { AgentSessionPort } from '../src/core/ports/agent'
import type { DB } from '../src/main/db'
import type { TaskTypeDef } from '../src/shared/types'

// The finish service: ordering and refusal guarantees that the strategies
// cannot express on their own, because they are about what happens AROUND the
// behaviour — specifically, that nothing is marked complete until the finish
// is known to have succeeded, and (since feature 002) the mode machinery: the
// declaration's default, the off-state forcing, and the contract report.

const DRAFT = 'Decision: ship the beta in March.\n\nAna raised the onboarding drop-off.\n'

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-finsvc-'))
  setUserDataRoot(dir)
  const conn: DB = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
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
  })
  const destDir = path.join(dir, 'filed')
  ensureDestination(destDir)

  createTypeDef(conn.db, {
    key: 'journal',
    family: 'document',
    label: 'Journal',
    emoji: '📔',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: destDir, subdir: '' }
  })

  const list = createList(conn.db, 'Work')
  const task = createTask(conn.db, { listId: list.id, title: 'Weekly sync', type: 'plain', customTypeKey: 'journal', inputs: {} })
  saveNotes(conn.db, { taskId: task.id, notePath: path.join(dir, 'note.md'), content: DRAFT })

  return { dir, conn, destDir, task }
}

function depsFor(conn: DB, session: AgentSessionPort, assistantEnabled = true): FinishDeps {
  return {
    // Tests render English; the language is explicit rather than absent so a
    // missing one cannot hide as a silent fallback.
    language: 'en',
    assistantEnabled,
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: () => folderArtifactStore,
    session,
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: () => {}
  }
}

const polishedSession = (): AgentSessionPort => ({
  isAvailable: () => true,
  async run() {
    return JSON.stringify({
      polished: '**Decision:** ship the beta in March.\n\nAna raised the onboarding drop-off.',
      preservedFacts: ['ship the beta in March']
    })
  }
})

test('a successful assisted finish marks the task complete, records the artifact, and reports the path', async () => {
  const { conn, destDir, task } = harness()
  const outcome = await finishTask(depsFor(conn, polishedSession()), task.id, { mode: 'assisted' })

  assert.equal(outcome.behaviour, 'polish-then-file')
  assert.equal(outcome.deferred, false)
  assert.equal(outcome.mode, 'assisted')
  assert.equal(getTask(conn.db, task.id)!.completed, true)

  // The contract report: where the copy went and which path ran (FR-003).
  assert.deepEqual(outcome.report, {
    ok: true,
    artifact: { path: path.join(destDir, 'weekly-sync.md'), store: 'folder' },
    path: 'organized',
    assistantStep: 'ran'
  })

  const file = fs.readdirSync(destDir)
  assert.deepEqual(file, ['weekly-sync.md'])
  const written = fs.readFileSync(path.join(destDir, 'weekly-sync.md'), 'utf-8')
  assert.ok(written.includes('**Decision:**'), 'the organized document was filed')

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
  const deps = depsFor(conn, polishedSession())
  deps.storage.listTypes = () =>
    [
      {
        key: 'journal',
        family: 'document',
        label: 'Journal',
        emoji: '📔',
        inputSchema: [],
        isBuiltin: false,
        finishBehaviour: 'polish-then-file',
        destination: { store: 'folder', rootPath: gone, subdir: '' }
      } as TaskTypeDef
    ]

  // The destination's own refusal, passed through with its code intact
  // (US1-AC5: destination.unreachable — never half-filed, never substituted).
  await assert.rejects(() => finishTask(deps, task.id), (e: unknown) => {
    assert.deepEqual(issueKeysOf(e), ['destination.unreachable'])
    return true
  })

  // Not completed, so the user can fix the destination and try again.
  assert.equal(getTask(conn.db, task.id)!.completed, false)
  // ...and nothing was written anywhere.
  assert.equal(fs.existsSync(gone), false)
  conn.close()
})

test('the task is NOT marked complete when the artifact step fails', async () => {
  const { conn, destDir, task } = harness()
  // The destination exists and is writable, but the write itself fails.
  const deps = depsFor(conn, polishedSession())
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
  const deps = depsFor(conn, polishedSession())
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
  const deps = depsFor(conn, polishedSession())
  deps.storage.listTypes = () =>
    [
      {
        key: 'journal',
        family: 'document',
        label: 'Journal',
        emoji: '📔',
        inputSchema: [{ key: 'target', label: 'Objective', type: 'text', required: true }],
        isBuiltin: false,
        finishBehaviour: 'polish-then-file',
        destination: { store: 'folder', rootPath: destDir, subdir: '' }
      } as TaskTypeDef
    ]

  await assert.rejects(() => finishTask(deps, task.id), (e: unknown) => {
    assert.deepEqual(issueKeysOf(e), ['finish.missingInputs'])
    assert.deepEqual(issueParamsOf(e).fields, 'Objective')
    return true
  })
  assert.equal(getTask(conn.db, task.id)!.completed, false)
  assert.deepEqual(fs.readdirSync(destDir), [])
  conn.close()
})

test('no AI provider still completes the finish and files the user content as written (FR-006)', async () => {
  const { conn, destDir, task } = harness()
  let sessionCalls = 0
  const unavailable: AgentSessionPort = {
    isAvailable: () => false,
    async run() {
      sessionCalls++
      throw new Error('must not be called')
    }
  }
  // The caller asked for assisted; the unconfigured state forces as-written —
  // and the report says plainly that the organizing step did not run.
  const outcome = await finishTask(depsFor(conn, unavailable), task.id, { mode: 'assisted' })

  assert.equal(outcome.task.completed, true, 'finishing never fails solely because AI is unavailable')
  assert.equal(outcome.mode, 'as-written')
  assert.equal(sessionCalls, 0, 'no session was constructed')
  assert.equal(outcome.report.path, 'as-written')
  assert.equal(outcome.report.assistantStep, 'skipped')
  assert.equal(fs.readFileSync(path.join(destDir, 'weekly-sync.md'), 'utf-8'), DRAFT)

  const activity = listIngest(conn.db)
  assert.equal(activity[0]!.state, 'done')
  assert.equal(activity[0]!.error, null, 'nothing failed — the step was skipped, and the report says so')
  conn.close()
})

test('finishing twice leaves both versions, neither overwritten', async () => {
  const { conn, destDir, task } = harness()
  await finishTask(depsFor(conn, polishedSession()), task.id, { mode: 'assisted' })
  await finishTask(depsFor(conn, polishedSession()), task.id, { mode: 'assisted' })

  assert.deepEqual(fs.readdirSync(destDir).sort(), ['weekly-sync-2.md', 'weekly-sync.md'])
  conn.close()
})

test('a destination with no location is refused, not defaulted — for either store', async () => {
  const { conn, task } = harness()
  // The seeded shape: a Type that ships (or was left) without a location.
  // There is no global location to inherit and no built-in default, so this
  // must refuse while the task is still actionable (FR-007/Q1).
  const deps = depsFor(conn, polishedSession())
  deps.storage.listTypes = () =>
    [
      {
        key: 'journal',
        family: 'document',
        label: 'Journal',
        emoji: '📔',
        inputSchema: [],
        isBuiltin: false,
        finishBehaviour: 'polish-then-file',
        destination: { store: 'wiki', rootPath: '', subdir: 'learning-notes' }
      } as TaskTypeDef
    ]

  await assert.rejects(() => finishTask(deps, task.id), (e: unknown) => {
    assert.deepEqual(issueKeysOf(e), ['destination.notConfigured'])
    return true
  })
  assert.equal(getTask(conn.db, task.id)!.completed, false, 'refused while still actionable, never half-completed')
})

// ---- the mode machinery (feature 002, D8/FR-021) ----

test('resolveBehaviour reads the declaration with no gating and no fallback', () => {
  const mk = (finishBehaviour: TaskTypeDef['finishBehaviour']) =>
    ({ key: 'k', family: null, label: 'K', emoji: '·', inputSchema: [], isBuiltin: false, finishBehaviour }) as TaskTypeDef
  // Every declared behaviour is reachable — the off-switch no longer refuses;
  // it forces the as-written MODE (the resolver below).
  assert.equal(resolveBehaviour(mk('complete-only')), 'complete-only')
  assert.equal(resolveBehaviour(mk('file-as-is')), 'file-as-is')
  assert.equal(resolveBehaviour(mk('polish-then-file')), 'polish-then-file')
  assert.equal(resolveBehaviour(mk('deposit-then-curate')), 'deposit-then-curate')
  // An undeclared behaviour is a refusal, never a guess.
  assert.throws(
    () => resolveBehaviour(mk(undefined as never)),
    (e: any) => e.name === 'FinishRefused' && e.issues[0]?.key === 'finish.noBehaviour'
  )
})

test('the declaration sets the default mode; the off state forces as-written', () => {
  const mk = (finishBehaviour: TaskTypeDef['finishBehaviour']) =>
    ({ key: 'k', family: 'document', label: 'K', emoji: '·', inputSchema: [], isBuiltin: false, finishBehaviour }) as TaskTypeDef
  // An organize-capable Type defaults to assisted; everything else to
  // as-written — from the declaration, never from a type key (D8).
  assert.equal(defaultFinishMode(mk('polish-then-file')), 'assisted')
  assert.equal(defaultFinishMode(mk('file-as-is')), 'as-written')
  assert.equal(defaultFinishMode(mk('deposit-then-curate')), 'as-written')
  assert.equal(defaultFinishMode(mk('complete-only')), 'as-written')
  // With the assistant unavailable the resolution is forced, whatever was
  // requested (FR-021).
  assert.equal(resolveFinishMode(mk('polish-then-file'), 'assisted', false), 'as-written')
  assert.equal(resolveFinishMode(mk('polish-then-file'), undefined, false), 'as-written')
  // Available: the request wins, the declaration fills the gap.
  assert.equal(resolveFinishMode(mk('polish-then-file'), 'as-written', true), 'as-written')
  assert.equal(resolveFinishMode(mk('polish-then-file'), undefined, true), 'assisted')
})

test('with the switch off, a writing type FILES AS WRITTEN and completes — the 001 refusal is deleted (FR-021)', async () => {
  const { conn, destDir, task } = harness()
  let sessionCalls = 0
  const deps = depsFor(
    conn,
    {
      isAvailable: () => true,
      async run() {
        sessionCalls++
        return ''
      }
    },
    false // switch off
  )

  // The document type declares polish-then-file: while off it stays reachable
  // on its as-written path — the user's own words file with zero sessions.
  const outcome = await finishTask(deps, task.id, { mode: 'assisted' })
  assert.equal(outcome.task.completed, true, 'the board never blocks on AI')
  assert.equal(sessionCalls, 0, 'no session was constructed while off')
  assert.equal(outcome.report.path, 'as-written')
  assert.equal(outcome.report.assistantStep, 'skipped')
  assert.equal(fs.readFileSync(path.join(destDir, 'weekly-sync.md'), 'utf-8'), DRAFT)

  // A complete-only type finishes normally while off: completing is board work.
  const plainList = createList(conn.db, 'P')
  const plain = createTask(conn.db, { listId: plainList.id, title: 'plain', type: 'plain' })
  const plainOutcome = await finishTask(deps, plain.id)
  assert.equal(plainOutcome.task.completed, true)
  assert.equal(plainOutcome.report.path, 'as-written')
  conn.close()
})

test('a blank draft refuses with document.empty before the destination is even resolved (US1-AC6)', async () => {
  const { conn, destDir, task } = harness()
  saveNotes(conn.db, { taskId: task.id, notePath: 'notes/x.md', content: '' })
  const deps = depsFor(conn, polishedSession())
  // A destination that would ALSO refuse — proving the ordering: the user
  // hears about the blank draft, the thing they can act on first.
  const gone = path.join(destDir, 'nope')
  deps.storeFor = () => ({
    ...folderArtifactStore,
    async prepare() {
      throw new Error('must not be reached')
    }
  })
  await assert.rejects(() => finishTask(deps, task.id), (e: unknown) => {
    assert.deepEqual(issueKeysOf(e), ['document.empty'])
    return true
  })
  assert.equal(getTask(conn.db, task.id)!.completed, false)
  assert.equal(fs.existsSync(gone), false)
  conn.close()
})
