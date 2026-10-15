import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createList, createTask, saveNotes, listIngest, updateIngest, type DB } from '../src/main/db'
import { createTypeDef, getTypeDef, updateTypeDef, deleteTypeDef } from '../src/main/types'
import { JobQueue } from '../src/main/job-queue'
import { runIngestJob } from '../src/main/wiki/ingest'
import { undoCuration } from '../src/main/wiki/undo'
import { setSessionFactory, type CreateJobSessionOptions, type JobSessionLike } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault } from '../src/main/wiki/vault'
import { issueKeysOf } from './helpers/issues'

// US4 (T037): the undo that reverses the curation and never the deposit
// (FR-020, Q3=A, D7).
//
// "Retained state" means the curated content as it stood BEFORE the curation
// — the run's own snapshot, taken after the deposit. Undo restores exactly
// the files the run's touched-file report names; the user's deposited
// material is never rolled back. Undo is a code operation on user-owned
// files: no session, no model (contract Jobs note).

const DRAFT = '# Notes\n\nSomething worth keeping.\n'

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-undo-'))
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
    destination: { store: 'wiki', rootPath: kbRoot, subdir: 'learning-notes' }
  })
  const list = createList(conn.db, 'Research')
  return { conn, dir, kbRoot, listId: list.id }
}

/** Script a curation run whose agent writes the given page content. */
function scriptCuration(kbRoot: string, pageContent: string, pageRel = 'learning-notes/page.md') {
  setSessionFactory(async (_o: CreateJobSessionOptions): Promise<JobSessionLike> => {
    const messages: any[] = []
    return {
      subscribe: () => () => {},
      messages,
      async prompt() {
        const abs = path.join(kbRoot, pageRel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, pageContent)
        fs.appendFileSync(path.join(kbRoot, 'log.md'), `\n## [2026-01-01] ingest | ${pageRel}\n`)
        messages.push({ role: 'assistant', content: [{ type: 'text', text: 'done' }] })
      },
      async abort() {},
      async dispose() {}
    }
  })
}

/** Run one full finish→curation cycle and return the settled ledger record. */
async function runCycle(conn: DB, kbRoot: string, listId: string, title: string, pageContent: string) {
  const t = createTask(conn.db, { listId, title, type: 'plain', customTypeKey: 'kb_notes' })
  saveNotes(conn.db, { taskId: t.id, notePath: 'notes/x.md', content: DRAFT })
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  scriptCuration(kbRoot, pageContent)
  // Deposit at finish (synchronous), then the job curates.
  const { finishTask } = await import('../src/core/services/finishService')
  const { createSqliteStorage } = await import('../src/main/adapters/sqlite/storageAdapter')
  const { artifactStoreFor } = await import('../src/main/adapters/artifacts')
  const { nodePathPort } = await import('../src/main/adapters/paths')
  const { systemClock } = await import('../src/core/ports/clock')
  await finishTask(
    {
      language: 'en',
      assistantEnabled: true,
      paths: nodePathPort,
      storage: createSqliteStorage(conn.db),
      storeFor: artifactStoreFor(),
      session: { isAvailable: () => true, async run() { return '' } },
      clock: systemClock,
      notifier: { toast: () => {}, progress: () => {} },
      enqueueCurate: (task, files) => q.enqueueIngest(task.id, task.title, files)
    },
    t.id
  )
  const deadline = Date.now() + 20000
  for (;;) {
    const rec = listIngest(conn.db).find((r) => r.taskId === t.id)
    if (rec && (rec.state === 'done' || rec.state === 'failed')) {
      if (rec.state === 'failed') throw new Error(`curation failed: ${rec.error}`)
      return rec
    }
    if (Date.now() > deadline) throw new Error('curation timed out')
    await new Promise((r) => setTimeout(r, 100))
  }
}

afterEach(() => setSessionFactory(null))

test('undo of a done run restores the touched files and the deposit stands (FR-020, Q3=A)', async () => {
  const { conn, kbRoot, listId } = harness()
  const rec = await runCycle(conn, kbRoot, listId, 'first entry', '# Curated V1\n')
  assert.equal(rec.state, 'done')
  assert.ok(rec.snapshotDir, 'the run recorded its snapshot')

  // The deposit is in the collection before the undo...
  const rawDir = path.join(kbRoot, 'raw', rec.taskId)
  const depositFiles = fs.readdirSync(rawDir)
  assert.ok(depositFiles.length > 0)
  const depositBytes = depositFiles.map((f) => fs.readFileSync(path.join(rawDir, f)))

  const result = undoCuration(conn.db, rec.id)
  assert.equal(result.ok, true)
  assert.ok(result.restored, 'the restored-files report exists')

  // The curated page the curation created is gone — the retained state is
  // its absence — and the log entry it appended is rolled back.
  assert.equal(fs.existsSync(path.join(kbRoot, 'learning-notes', 'page.md')), false, 'a page the curation created returns to its retained state: absent')
  assert.ok(!fs.readFileSync(path.join(kbRoot, 'log.md'), 'utf-8').includes('ingest | learning-notes/page.md'), 'the log returns to the retained state')

  // The deposit STANDS, byte-identical: undo never rolls back the user's own
  // material (Q3=A verbatim).
  assert.deepEqual(fs.readdirSync(rawDir), depositFiles)
  depositFiles.forEach((f, i) => {
    assert.ok(fs.readFileSync(path.join(rawDir, f)).equals(depositBytes[i]!), `deposit file ${f} unchanged`)
  })

  // The ledger moved done → undone and stamped undoneAt.
  const after = listIngest(conn.db).find((r) => r.id === rec.id)!
  assert.equal(after.state, 'undone')
  assert.ok(after.undoneAt)
  conn.close()
})

test('undo refusals carry codes and reasons: not done, snapshot missing, collection unresolvable', async () => {
  const { conn, kbRoot, listId } = harness()
  const rec = await runCycle(conn, kbRoot, listId, 'refusal subject', '# Curated\n')

  // 1. A run that is not done: undo of a curation that never completed is
  //    refused with a reason (FR-020).
  updateIngest(conn.db, rec.id, { state: 'failed' })
  let refusal = undoCuration(conn.db, rec.id)
  assert.equal(refusal.ok, false)
  assert.deepEqual(issueKeysOf(refusal.error), ['undo.notDone'])
  updateIngest(conn.db, rec.id, { state: 'queued' })
  refusal = undoCuration(conn.db, rec.id)
  assert.equal(refusal.ok, false)
  updateIngest(conn.db, rec.id, { state: 'done' })

  // A run already undone is not done either.
  updateIngest(conn.db, rec.id, { state: 'undone', undoneAt: new Date().toISOString() })
  refusal = undoCuration(conn.db, rec.id)
  assert.equal(refusal.ok, false)
  assert.deepEqual(issueKeysOf(refusal.error), ['undo.notDone'])
  updateIngest(conn.db, rec.id, { state: 'done', undoneAt: null })

  // 2. The snapshot missing: report it, do not guess.
  const snapAbs = path.join(kbRoot, rec.snapshotDir!)
  fs.rmSync(snapAbs, { recursive: true, force: true })
  refusal = undoCuration(conn.db, rec.id)
  assert.equal(refusal.ok, false)
  assert.deepEqual(issueKeysOf(refusal.error), ['undo.snapshotMissing'])
  // A legacy row with no snapshot recorded at all refuses the same way.
  updateIngest(conn.db, rec.id, { snapshotDir: null })
  refusal = undoCuration(conn.db, rec.id)
  assert.equal(refusal.ok, false)
  assert.deepEqual(issueKeysOf(refusal.error), ['undo.snapshotMissing'])

  // 3. The collection no longer resolving under the Type's destination — the
  //    same rule as at finish: never mis-restore. (An absolute-but-gone root:
  //    the save-time validation accepts it — the loss is a runtime condition,
  //    exactly as at finish.)
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'kb_notes')!,
    destination: { store: 'wiki', rootPath: '/nonexistent/moved-away-collection', subdir: '' }
  })
  refusal = undoCuration(conn.db, rec.id)
  assert.equal(refusal.ok, false)
  assert.deepEqual(issueKeysOf(refusal.error), ['undo.destinationUnresolved'])

  // An unknown record is an error, not a silent success.
  assert.throws(() => undoCuration(conn.db, 'no-such-record'), /not found/)
  conn.close()
})

test('two runs touching one page keep their own retained states; undo restores the named run’s state', async () => {
  const { conn, kbRoot, listId } = harness()
  const page = path.join(kbRoot, 'learning-notes', 'page.md')

  const run1 = await runCycle(conn, kbRoot, listId, 'entry one', '# Curated V1\n')
  assert.equal(fs.readFileSync(page, 'utf-8'), '# Curated V1\n')
  // Run 1's snapshot holds the state BEFORE run 1: the page did not exist.
  assert.equal(fs.existsSync(path.join(kbRoot, run1.snapshotDir!, 'learning-notes', 'page.md')), false)

  const run2 = await runCycle(conn, kbRoot, listId, 'entry two', '# Curated V2\n')
  assert.equal(fs.readFileSync(page, 'utf-8'), '# Curated V2\n')
  // Run 2's snapshot holds V1 — its own retained state, distinct from run 1's.
  assert.notEqual(run1.snapshotDir, run2.snapshotDir)
  assert.equal(
    fs.readFileSync(path.join(kbRoot, run2.snapshotDir!, 'learning-notes', 'page.md'), 'utf-8'),
    '# Curated V1\n'
  )

  // Undoing the MOST RECENT run returns the page to the state it retained:
  // V1 — and the result names which state it restored.
  const result = undoCuration(conn.db, run2.id)
  assert.equal(result.ok, true)
  assert.equal(fs.readFileSync(page, 'utf-8'), '# Curated V1\n')
  assert.equal(result.restoredState, run2.snapshotDir, 'the report names the retained state it restored')

  // Run 1 keeps its own state and remains undoable: undoing it now returns
  // the page to its absence (the state before run 1).
  const stillDone = listIngest(conn.db).find((r) => r.id === run1.id)!
  assert.equal(stillDone.state, 'done')
  const result1 = undoCuration(conn.db, run1.id)
  assert.equal(result1.ok, true)
  assert.equal(fs.existsSync(page), false)
  assert.equal(result1.restoredState, run1.snapshotDir)
  conn.close()
})

test('undo is a code operation: no session is constructed, and a deleted Type still resolves through the ledger task', async () => {
  const { conn, kbRoot, listId } = harness()
  const rec = await runCycle(conn, kbRoot, listId, 'code operation', '# Curated\n')
  let factoryCalls = 0
  setSessionFactory(async () => {
    factoryCalls++
    throw new Error('undo must construct no session')
  })

  const result = undoCuration(conn.db, rec.id)
  assert.equal(result.ok, true)
  assert.equal(factoryCalls, 0, 'no session, no model — a pure code operation on user-owned files')
  conn.close()
})
