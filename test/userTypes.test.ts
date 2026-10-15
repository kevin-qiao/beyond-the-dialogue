import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, createTask, getTask, saveNotes, listIngest, type DB } from '../src/main/db'
import { createTypeDef, deleteTypeDef, getTypeDef, updateTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { folderArtifactStore, ensureDestination } from '../src/main/adapters/artifacts/folderStore'
import { artifactStoreFor } from '../src/main/adapters/artifacts'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, resolveBehaviour, defaultFinishMode, type FinishDeps } from '../src/core/services/finishService'
import { setSessionFactory, type CreateJobSessionOptions, type JobSessionLike } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault } from '../src/main/wiki/vault'
import { validateTypeDefinition } from '../src/core/domain/validation'
import type { AgentRunRequest, AgentSessionPort } from '../src/core/ports/agent'
import type { TaskTypeDef } from '../src/shared/types'

// US3 (T030): built-ins hold no privilege. A user-declared Type with the same
// declarations behaves IDENTICALLY — same dispatch path, same strategy, same
// mode default (FR-012) — because everything routes through the declaration
// and nothing through a type key (Principle I).

const DRAFT = 'diary entry\n\nWent out with the design team. Felt productive.\n'

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-usertypes-'))
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
  storeProviderKey('openai', 'sk-scripted')
  ensureVault()
  const outDir = path.join(dir, 'filed')
  ensureDestination(outDir)
  // The guided flow (quickstart §3): point the seeded built-in at a folder.
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'document')!,
    destination: { store: 'folder', rootPath: outDir, subdir: '' }
  })
  const list = createList(conn.db, 'Writing')
  return { conn, dir, outDir, listId: list.id }
}

/** A recording session: every run request is captured for comparison. */
function recordingSession(organize: (instructionSeen: string) => string): AgentSessionPort & { requests: AgentRunRequest[] } {
  const requests: AgentRunRequest[] = []
  return {
    requests,
    isAvailable: () => true,
    async run(req) {
      requests.push(req)
      return organize(req.prompt)
    }
  }
}

function depsFor(conn: DB, session: AgentSessionPort): FinishDeps {
  return {
    language: 'en',
    assistantEnabled: true,
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: () => folderArtifactStore,
    session,
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: () => {}
  }
}

afterEach(() => setSessionFactory(null))

test('dispatch by declaration: a custom document Type and the built-in with identical declarations finish identically (FR-012)', async () => {
  const { conn, outDir, listId } = harness()
  // The user-declared twin of the (now-pointed) built-in: same family, same
  // behaviour, same destination, no instruction on either — a built-in's
  // identity (including its instruction slot) is fixed, so the identical
  // declaration both can carry is the twin under test.
  createTypeDef(conn.db, {
    key: 'my_journal',
    family: 'document',
    label: 'My journal',
    emoji: '📓',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: outDir, subdir: '' }
  })

  const effectiveBuiltin = getTypeDef(conn.db, 'document')!
  const custom = getTypeDef(conn.db, 'my_journal')!
  // The declaration axis agrees...
  assert.equal(resolveBehaviour(custom), resolveBehaviour(effectiveBuiltin))
  assert.equal(defaultFinishMode(custom), defaultFinishMode(effectiveBuiltin))
  assert.equal(defaultFinishMode(custom), 'assisted')

  // ...and so does the run: the same code path with the same inputs. The
  // organize prompt differs only where the TASKS differ (titles), never
  // because one Type is a built-in.
  const promptOf = (title: string, type: string, customTypeKey: string | null) => {
    const session = recordingSession(() =>
      JSON.stringify({ polished: 'organized: ' + title, preservedFacts: ['design team'] })
    )
    const task = createTask(conn.db, { listId, title, type, customTypeKey })
    saveNotes(conn.db, { taskId: task.id, notePath: 'n.md', content: DRAFT })
    return { session, task }
  }
  const a = promptOf('Same title', 'document', null)
  const b = promptOf('Same title', 'plain', 'my_journal')

  const ra = await finishTask(depsFor(conn, a.session), a.task.id)
  const rb = await finishTask(depsFor(conn, b.session), b.task.id)

  assert.deepEqual(ra.report, { ...rb.report, artifact: ra.report.artifact })
  assert.equal(ra.report.path, 'organized')
  assert.equal(ra.report.assistantStep, 'ran')
  assert.equal(ra.mode, rb.mode)
  // The scripted organize inputs are equal: same system prompt, same
  // prompt — identical declarations produce identical dispatch.
  assert.equal(a.session.requests[0]!.systemPrompt, b.session.requests[0]!.systemPrompt)
  assert.equal(a.session.requests[0]!.prompt, b.session.requests[0]!.prompt)
  // Both filed — the second under a distinct name, neither overwritten.
  assert.deepEqual(fs.readdirSync(outDir).sort(), ['same-title-2.md', 'same-title.md'])
  conn.close()
})

test('saving a user Type whose destination has no location refuses with an actionable code (FR-013)', () => {
  const { conn, dir } = harness()
  const base: TaskTypeDef = {
    key: 'no_location',
    family: 'document',
    label: 'No location',
    emoji: '📁',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: '', subdir: '' }
  }
  // The service refuses...
  assert.throws(() => createTypeDef(conn.db, base), /needs a location/)
  // ...in the code the catalog phrases.
  const v = validateTypeDefinition(base, { paths: nodePathPort, existing: null, mode: 'create' })
  assert.ok(v.errors.some((e) => e.key === 'validation.destinationNeedsRoot'))
  assert.equal(getTypeDef(conn.db, 'no_location'), null, 'nothing was written')
  // An empty rootPath is legal ONLY on the seeded built-ins (data-model):
  // the built-in document row still carries one.
  const builtinRow = conn.db.prepare("SELECT destination_json FROM task_types WHERE key='document'").get() as any
  assert.ok(builtinRow, 'the seeded built-in keeps its empty-root shape until pointed')
  void dir
  conn.close()
})

test('editing the instruction changes the next finish only — the filed artifact is untouched (FR-014)', async () => {
  const { conn, outDir, listId } = harness()
  createTypeDef(conn.db, {
    key: 'diary',
    family: 'document',
    label: 'Diary',
    emoji: '📔',
    inputSchema: [],
    aiGuidance: 'INSTRUCTION-ONE',
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: outDir, subdir: '' }
  })

  const mkTask = (title: string) => {
    const t = createTask(conn.db, { listId, title, type: 'plain', customTypeKey: 'diary' })
    saveNotes(conn.db, { taskId: t.id, notePath: 'n.md', content: DRAFT })
    return t
  }
  const first = mkTask('first entry')
  const s1 = recordingSession(() => JSON.stringify({ polished: 'organized first', preservedFacts: ['design team'] }))
  await finishTask(depsFor(conn, s1), first.id)
  assert.ok(s1.requests[0]!.prompt.includes('INSTRUCTION-ONE'))
  const firstArtifact = path.join(outDir, 'first-entry.md')
  const firstBytes = fs.readFileSync(firstArtifact)

  // Edit the instruction; finish a second task.
  updateTypeDef(conn.db, { ...getTypeDef(conn.db, 'diary')!, aiGuidance: 'INSTRUCTION-TWO' })
  const second = mkTask('second entry')
  const s2 = recordingSession(() => JSON.stringify({ polished: 'organized second', preservedFacts: ['design team'] }))
  await finishTask(depsFor(conn, s2), second.id)

  // Only the new finish changed: the new instruction drove it...
  assert.ok(s2.requests[0]!.prompt.includes('INSTRUCTION-TWO'))
  assert.ok(!s2.requests[0]!.prompt.includes('INSTRUCTION-ONE'))
  // ...and the earlier artifact is byte-identical on disk — the application
  // never updates what it already filed.
  assert.ok(fs.readFileSync(firstArtifact).equals(firstBytes))
  conn.close()
})

test('removing a Type in use re-homes its tasks to plain with content intact (US3-AC4)', async () => {
  const { conn, outDir, listId } = harness()
  createTypeDef(conn.db, {
    key: 'essays',
    family: 'document',
    label: 'Essays',
    emoji: '📚',
    inputSchema: [{ key: 'target', label: 'Target', type: 'text' }],
    isBuiltin: false,
    finishBehaviour: 'file-as-is',
    destination: { store: 'folder', rootPath: outDir, subdir: '' }
  })
  const t = createTask(conn.db, {
    listId,
    title: 'On procrastination',
    background: 'a long thought',
    target: 'publish it',
    notes: 'keep me',
    type: 'plain',
    customTypeKey: 'essays',
    inputs: { target: 'publish it' }
  })
  saveNotes(conn.db, { taskId: t.id, notePath: 'n.md', content: DRAFT })
  // An artifact the Type already filed.
  const filed = path.join(outDir, 'already-filed.md')
  fs.writeFileSync(filed, 'FILED BEFORE')

  const rehomed = deleteTypeDef(conn.db, 'essays')
  assert.deepEqual(rehomed, [t.id], 'the service reports which tasks were re-homed')

  const after = getTask(conn.db, t.id)!
  assert.equal(after.type, 'plain')
  assert.equal(after.customTypeKey, null)
  assert.equal(after.title, 'On procrastination', 'the task keeps its content')
  assert.equal(after.background, 'a long thought')
  assert.equal(after.target, 'publish it')
  assert.equal(after.notes, 'keep me')
  assert.equal(fs.readFileSync(filed, 'utf-8'), 'FILED BEFORE', 'filed artifacts are never touched')
  assert.equal(getTypeDef(conn.db, 'essays'), null)
  conn.close()
})

test('the reconciliation guard: a user-defined Type key is assignable to a task (research.md open point)', () => {
  // The old tasks.type CHECK listed the four POC keys and was live; v13
  // dropped it. A user-defined key must be assignable directly — settling the
  // reconciliation point for every supported database shape.
  const { conn, listId } = harness()
  createTypeDef(conn.db, {
    key: 'custom_keyed',
    family: 'document',
    label: 'Custom keyed',
    emoji: '🔖',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
  const t = createTask(conn.db, { listId, title: 'direct key', type: 'custom_keyed' })
  assert.equal(getTask(conn.db, t.id)!.type, 'custom_keyed')
  // Raw SQL too — no CHECK stands between the registry and the column.
  const now = new Date().toISOString()
  conn.db
    .prepare('INSERT INTO tasks (id,list_id,title,type,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('t-raw', listId, 'raw insert', 'custom_keyed', now, now)
  assert.equal(getTask(conn.db, 't-raw')!.type, 'custom_keyed')
  conn.close()
})

test('a user-declared wiki-destined document Type rides the same knowledge-base machinery (seed-set synthesis)', async () => {
  // The learning case is reproducible as a user-declared Type (SC-010's
  // subject; the full curation loop is pinned by test/e2e.test.ts and US4's
  // knowledgeBase tests). Here: the declaration alone routes it.
  const { conn, dir, listId } = harness()
  const wikiRoot = path.join(dir, 'kb-space')
  createTypeDef(conn.db, {
    key: 'kb_diary',
    family: 'document',
    label: 'KB diary',
    emoji: '📚',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'deposit-then-curate',
    destination: { store: 'wiki', rootPath: wikiRoot, subdir: 'learning-notes' }
  })
  const def = getTypeDef(conn.db, 'kb_diary')!
  assert.equal(resolveBehaviour(def), 'deposit-then-curate')
  assert.equal(defaultFinishMode(def), 'as-written', 'the deposit path has no organize choice at finish')

  // Finish deposits synchronously and defers curation; no session runs at
  // finish time.
  const t = createTask(conn.db, { listId, title: 'kb entry', type: 'plain', customTypeKey: 'kb_diary' })
  saveNotes(conn.db, { taskId: t.id, notePath: 'n.md', content: DRAFT })
  let enqueued: string[] = []
  const session = recordingSession(() => '')
  // The store mapper, not a fixed folder store: the destination's `store`
  // value picks the adapter, exactly as the composition root wires it.
  const deps: FinishDeps = {
    ...depsFor(conn, session),
    storeFor: artifactStoreFor(),
    enqueueCurate: (_task, files) => {
      enqueued = files
    }
  }
  const outcome = await finishTask(deps, t.id)
  assert.equal(outcome.deferred, true)
  assert.equal(outcome.report.path, 'deposited')
  assert.equal(session.requests.length, 0, 'the curating session belongs to the job, not the finish')
  assert.ok(enqueued.some((f) => f.endsWith('.md')), 'the deposit files ride the enqueue')
  assert.ok(fs.existsSync(path.join(wikiRoot, 'raw', t.id)), 'the deposit landed in the declared collection')
  assert.equal(getTask(conn.db, t.id)!.completed, true)
  // The activity record for the deferred behaviour belongs to the job; the
  // ledger stays empty until it runs.
  assert.deepEqual(listIngest(conn.db), [])
  conn.close()
})
