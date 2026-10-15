import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, createTask, getTask, saveNotes, listIngest, type DB } from '../src/main/db'
import { createTypeDef, getTypeDef, updateTypeDef } from '../src/main/types'
import { JobQueue } from '../src/main/job-queue'
import { runIngestJob } from '../src/main/wiki/ingest'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { artifactStoreFor } from '../src/main/adapters/artifacts'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, type FinishDeps } from '../src/core/services/finishService'
import { setSessionFactory, type CreateJobSessionOptions, type JobSessionLike } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault } from '../src/main/wiki/vault'
import type { AgentRunRequest } from '../src/core/ports/agent'

// US4 (T036): the knowledge-base destination over declarations.
//
// A wiki-destined Type finishes in two ordered steps — durable deposit first
// (at finish, synchronous), confined curation second (the job) — with
// create-only structure setup at the first destined finish (FR-018/D6) and
// curation confined to the collection by the TOOL SURFACE, not by a prompt
// line (US4-AC4). The deposit-before-curation order is load-bearing (D7):
// the undo rule depends on it, and quickstart drill #6 says moving the
// snapshot ahead of the deposit must turn this file red.

const DRAFT = '# Field notes\n\nThe ingestion pipeline needs backpressure.\n'

let sessionBuilds: { at: number; rawExisted: boolean; requests: AgentRunRequest[] }[] = []

function harness(destSubdir = 'learning-notes') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-kb-'))
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
  const kbRoot = path.join(dir, 'kb-space')
  createTypeDef(conn.db, {
    key: 'kb_notes',
    family: 'document',
    label: 'KB notes',
    emoji: '📚',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'deposit-then-curate',
    destination: { store: 'wiki', rootPath: kbRoot, subdir: destSubdir }
  })
  const list = createList(conn.db, 'Research')
  sessionBuilds = []
  return { conn, dir, kbRoot, listId: list.id }
}

function makeTask(conn: DB, listId: string, title: string, typeKey = 'kb_notes') {
  const t = createTask(conn.db, { listId, title, type: 'plain', customTypeKey: typeKey })
  saveNotes(conn.db, { taskId: t.id, notePath: 'notes/x.md', content: DRAFT })
  return t
}

/** The scripted curating agent: writes a curated note INSIDE the collection,
 *  recording what existed at construction time (the order pin) and the
 *  session shape the seam was asked to build (the confinement pin). */
function scriptCurator(kbRoot: string, taskId: string) {
  setSessionFactory(async (o: CreateJobSessionOptions): Promise<JobSessionLike> => {
    const rawExisted = fs.existsSync(path.join(kbRoot, 'raw', taskId))
    // The factory receives the already-resolved build options — purpose, cwd,
    // tools — which is exactly the surface the confinement is decided on.
    const requests = [
      { purpose: o.purpose ?? 'confined', cwd: o.cwd, tools: o.tools, systemPrompt: o.systemPrompt, prompt: '' }
    ] as AgentRunRequest[]
    sessionBuilds.push({ at: Date.now(), rawExisted, requests })
    const messages: any[] = []
    return {
      subscribe: () => () => {},
      messages,
      async prompt(_text: string) {
        // The real agent writes through its tools; the script writes through
        // fs, which is the same effect for the diff/undo machinery. The
        // confinement that stops the REAL agent from writing outside is the
        // tool surface (cwd bound to the collection + allowlist with no
        // shell), pinned by the request-shape assertions below.
        const notesDir = path.join(kbRoot, 'learning-notes')
        fs.mkdirSync(notesDir, { recursive: true })
        fs.writeFileSync(path.join(notesDir, 'curated-note.md'), '# Curated\n\nBackpressure, explained.\n')
        fs.writeFileSync(path.join(kbRoot, 'index.md'), fs.readFileSync(path.join(kbRoot, 'index.md'), 'utf-8') + '\n- [[curated-note]]\n')
        messages.push({ role: 'assistant', content: [{ type: 'text', text: 'done' }] })
      },
      async abort() {},
      async dispose() {}
    }
  })
}

function depsFor(conn: DB, enqueue: (taskId: string, files: string[]) => void, assistantEnabled = true): FinishDeps {
  return {
    language: 'en',
    assistantEnabled,
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: artifactStoreFor(),
    session: { isAvailable: () => true, async run() { return '' } },
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: (task, files) => enqueue(task.id, files)
  }
}

async function waitForLedger(db: DB['db'], id: string, states: string[] = ['done', 'failed']): Promise<void> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const r = listIngest(db).find((x) => x.id === id)
    if (r && states.includes(r.state)) return
    await new Promise((res) => setTimeout(res, 100))
  }
  throw new Error('ledger timed out')
}

afterEach(() => setSessionFactory(null))

test('the first destined finish establishes the minimal structure, create-only (FR-018/US4-AC5)', async () => {
  const { conn, kbRoot, listId } = harness()
  const t = makeTask(conn, listId, 'backpressure')
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  scriptCurator(kbRoot, t.id)

  // The location does not exist yet: the first destined finish sets up the
  // pattern's minimal structure there (Q4: establish, do not refuse).
  assert.equal(fs.existsSync(kbRoot), false)
  const outcome = await finishTask(depsFor(conn, (taskId, files) => q.enqueueIngest(taskId, t.title, files)), t.id)
  assert.equal(outcome.report.path, 'deposited')
  for (const rel of ['raw', 'wiki', 'learning-notes', '.history', 'index.md', 'log.md', 'CLAUDE.md']) {
    assert.ok(fs.existsSync(path.join(kbRoot, rel)), `minimal structure missing ${rel}`)
  }

  // The user edits the structure. A later finish NEVER rewrites it (D6:
  // create-only — the collection belongs to the user).
  fs.writeFileSync(path.join(kbRoot, 'index.md'), '# MY OWN INDEX\n')
  fs.writeFileSync(path.join(kbRoot, 'CLAUDE.md'), '# MY OWN SCHEMA\n')
  const rec = listIngest(conn.db)[0]!
  await waitForLedger(conn.db, rec.id)

  const t2 = makeTask(conn, listId, 'second note')
  scriptCurator(kbRoot, t2.id)
  await finishTask(depsFor(conn, (taskId, files) => q.enqueueIngest(taskId, t2.title, files)), t2.id)
  // Let the second curation settle before closing — a job running against a
  // closed database is exactly the async leak the runner reports.
  const rec2 = listIngest(conn.db).find((r) => r.taskId === t2.id)!
  await waitForLedger(conn.db, rec2.id)
  assert.equal(fs.readFileSync(path.join(kbRoot, 'index.md'), 'utf-8').startsWith('# MY OWN INDEX'), true, 'the user-changed index survived the second finish')
  assert.equal(fs.readFileSync(path.join(kbRoot, 'CLAUDE.md'), 'utf-8'), '# MY OWN SCHEMA\n')
  conn.close()
})

test('the deposit lands BEFORE the curation session is constructed, and the snapshot records after it (D7 order pin)', async () => {
  const { conn, kbRoot, listId } = harness()
  const t = makeTask(conn, listId, 'order pin')
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  scriptCurator(kbRoot, t.id)

  await finishTask(depsFor(conn, (taskId, files) => q.enqueueIngest(taskId, t.title, files)), t.id)
  // At finish time — before any job ran — the deposit already stands.
  const rawDir = path.join(kbRoot, 'raw', t.id)
  assert.ok(fs.existsSync(rawDir), 'the deposit is synchronous at finish')
  assert.ok(fs.readdirSync(rawDir).some((f) => f.endsWith('.md')))

  const rec = listIngest(conn.db)[0]!
  await waitForLedger(conn.db, rec.id)
  assert.equal(sessionBuilds.length, 1)
  assert.equal(sessionBuilds[0]!.rawExisted, true, 'the deposit existed BEFORE the curating session was constructed')

  // The ledger recorded the run with its snapshot (taken after the deposit —
  // the undo rule depends on this order) and the touched-file report.
  const done = listIngest(conn.db).find((r) => r.id === rec.id)!
  assert.equal(done.state, 'done', done.error ?? '')
  assert.ok(done.snapshotDir && done.snapshotDir.startsWith('.history/'), `snapshot recorded relative to the collection: ${done.snapshotDir}`)
  assert.ok(!path.isAbsolute(done.snapshotDir!), 'FR-024: no absolute path in a board row')
  assert.ok(fs.existsSync(path.join(kbRoot, done.snapshotDir!)), 'the snapshot directory exists')
  assert.ok(done.touchedFiles.includes('learning-notes/curated-note.md'), `touched report: ${done.touchedFiles}`)
  // Only one deposit exists — the job does not re-deposit what finish
  // already deposited (the standing rule: one code path, no double work).
  assert.equal(fs.readdirSync(rawDir).filter((f) => f.endsWith('.md')).length, 1)
  conn.close()
})

test('assistant off: the deposit stands, the task completes, and curation is reported as not run (FR-019/US4-AC2)', async () => {
  const { conn, kbRoot, listId } = harness()
  const t = makeTask(conn, listId, 'offline deposit')
  let factoryCalls = 0
  setSessionFactory(async () => {
    factoryCalls++
    throw new Error('must not be constructed')
  })

  // The switch is off: finish still deposits (the part that must survive),
  // completes the task, and plainly reports the curation as skipped. The
  // ingest handler is not even registered while off (the startup gate), so
  // the enqueue is a no-op the ledger shows as not-yet-run.
  const outcome = await finishTask(depsFor(conn, () => {}, false), t.id)
  assert.equal(outcome.task.completed, true)
  assert.equal(outcome.report.path, 'deposited')
  assert.equal(outcome.report.assistantStep, 'skipped', 'the report says the curation did not run')
  assert.equal(factoryCalls, 0, 'zero sessions constructed while off')
  const rawDir = path.join(kbRoot, 'raw', t.id)
  assert.ok(fs.readdirSync(rawDir).some((f) => f.endsWith('.md')), 'the deposit stands')
  conn.close()
})

test('unconfigured provider: the job fails honestly, the deposit stands (FR-019)', async () => {
  const { conn, kbRoot, listId } = harness()
  saveSettings(conn.db, { provider: 'openai', model: '', hasApiKey: false, defaultListId: null, maxConcurrentJobs: 2, showWelcome: false, theme: 'light', uiLanguage: 'en', assistantRuntime: 'on', lastCheck: null, skills: [], mcpServers: [] })
  const t = makeTask(conn, listId, 'unconfigured curation')
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  let factoryCalls = 0
  setSessionFactory(async () => {
    factoryCalls++
    throw new Error('must not be constructed')
  })

  await finishTask(depsFor(conn, (taskId, files) => q.enqueueIngest(taskId, t.title, files)), t.id)
  const rec = listIngest(conn.db)[0]!
  await waitForLedger(conn.db, rec.id)
  const failed = listIngest(conn.db).find((r) => r.id === rec.id)!
  assert.equal(failed.state, 'failed', 'curation reported as failed')
  assert.equal(factoryCalls, 0)
  assert.ok(failed.error && failed.error.length > 0)
  // The deposit survives the failed curation — that is the whole point of
  // deposit-first.
  assert.ok(fs.readdirSync(path.join(kbRoot, 'raw', t.id)).length > 0)
  assert.equal(getTask(conn.db, t.id)!.completed, true)
  conn.close()
})

test('the curation is confined by the tool surface, not by a prompt line (US4-AC4)', async () => {
  const { conn, kbRoot, listId } = harness()
  const t = makeTask(conn, listId, 'confinement')
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  scriptCurator(kbRoot, t.id)

  await finishTask(depsFor(conn, (taskId, files) => q.enqueueIngest(taskId, t.title, files)), t.id)
  const rec = listIngest(conn.db)[0]!
  await waitForLedger(conn.db, rec.id)

  assert.equal(sessionBuilds.length, 1)
  const req = sessionBuilds[0]!.requests[0]
  assert.ok(req, 'the curating request was captured')
  // The structural confinement: no shell in the allowlist, cwd bound to the
  // collection root, and the purpose that resolves NO_GRANT by construction
  // (resolveGrant — pinned in test/grants.test.ts). A write outside the
  // collection is refused by THIS surface, not by asking the model nicely.
  assert.deepEqual(req!.tools, ['read', 'write', 'edit', 'grep', 'find', 'ls'])
  assert.ok(!req!.tools.includes('shell') && !req!.tools.includes('bash'))
  assert.equal(req!.cwd, kbRoot)
  assert.equal(req!.purpose, 'confined')
  conn.close()
})

test('a destination whose location vanished between save and finish refuses while the task stays actionable', async () => {
  const { conn, dir, listId } = harness()
  const t = makeTask(conn, listId, 'vanished kb')
  // Point at a location, create it, then remove it — the general destination-
  // loss rule (spec edge case) applies to knowledge bases unchanged.
  const gone = path.join(dir, 'mounted-then-gone')
  fs.mkdirSync(gone, { recursive: true })
  updateTypeDef(conn.db, { ...getTypeDef(conn.db, 'kb_notes')!, destination: { store: 'wiki', rootPath: gone, subdir: 'learning-notes' } })
  fs.rmSync(gone, { recursive: true, force: true })
  // The wiki store ESTABLISHES a missing location at the first destined
  // finish (Q4) — so the refusal case is the location that cannot be
  // established: a path whose parent is a file.
  fs.writeFileSync(gone, 'not a directory')
  await assert.rejects(
    () => finishTask(depsFor(conn, () => {}), t.id),
    (e: any) => e.name === 'FinishRefused' || e.name === 'LocalizedError'
  )
  assert.equal(getTask(conn.db, t.id)!.completed, false, 'refused while still actionable')
  conn.close()
})

test('strategy order pin: deposit, then snapshot, then the curating session (D7; quickstart drill #6)', async () => {
  // The order is load-bearing and this is the pin the drill moves: swap the
  // snapshot ahead of the deposit in depositThenCurate and this test fails —
  // the undo rule (restore curation, never the deposit) depends on the
  // snapshot being taken AFTER the user's material has landed.
  const { depositThenCurate } = await import('../src/core/domain/finish')
  const order: string[] = []
  const kb = harness()
  const task = makeTask(kb.conn, kb.listId, 'order strategy')
  const ctx = {
    task: getTask(kb.conn.db, task.id)!,
    language: 'en' as const,
    typeDef: getTypeDef(kb.conn.db, 'kb_notes')!,
    destination: { store: 'wiki', root: kb.kbRoot, subdir: 'learning-notes', absRoot: kb.kbRoot, abs: kb.kbRoot, rel: '', rootRel: '' },
    workingContent: DRAFT,
    declaredInputs: {},
    store: {
      async prepare() {},
      async writeArtifact() {
        return ''
      },
      async deposit() {
        order.push('deposit')
        return { dir: 'raw/x', files: ['note.md'] }
      },
      async snapshot() {
        order.push('snapshot')
        return { store: 'wiki' as const, root: kb.kbRoot, subdir: '', location: null, relLocation: '.history/x', files: [] }
      },
      async diff() {
        order.push('diff')
        return []
      }
    },
    session: {
      isAvailable: () => true,
      async run() {
        order.push('curate-session')
        return ''
      }
    },
    clock: systemClock,
    signal: new AbortController().signal
  }
  await depositThenCurate(ctx as never)
  assert.deepEqual(order, ['deposit', 'snapshot', 'curate-session', 'diff'])
  kb.conn.close()
})
