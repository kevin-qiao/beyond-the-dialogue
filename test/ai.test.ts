import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDB, migrate, createList, listLists, createTask, getJob } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { setUserDataRoot } from '../src/main/paths'

// The retired job kinds (D4/T007): the `preprocess` and `suggestion` engines
// are deleted, but their stored rows are HISTORY — records of what happened,
// in the state they were written in. Nothing may run them, and nothing may
// rewrite them at startup either.

function freshDB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'))
  setUserDataRoot(dir)
  const db = openDB(dir)
  migrate(db.db)
  return { db, dir }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function legacyJob(db: ReturnType<typeof freshDB>['db'], kind: 'preprocess' | 'suggestion', state: string, taskId: string | null): string {
  const id = randomUUID()
  db.db
    .prepare(
      `INSERT INTO enrichment_jobs (id, kind, task_id, state, step_label, progress, error, attempts, created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'Pre-processing', NULL, NULL, 1, ?, ?, NULL)`
    )
    .run(id, kind, taskId, state, new Date().toISOString(), state === 'running' ? new Date().toISOString() : null)
  return id
}

test('stored preprocess/suggestion rows survive as history — the CHECK keeps the retired kinds', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'old task' })
  // The enrichment_jobs CHECK still names all three kinds, because the rows
  // are history (T004): a database that holds them must stay readable.
  const a = legacyJob(db, 'preprocess', 'running', t.id)
  const b = legacyJob(db, 'suggestion', 'done', t.id)
  assert.equal(getJob(db.db, a)!.kind, 'preprocess', 'the row mapper tolerates the retired kind at the boundary')
  assert.equal(getJob(db.db, b)!.state, 'done')
  db.close()
})

test('requeueInterrupted leaves the retired kinds untouched — never re-run, never rewritten', () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'old task' })
  const running = legacyJob(db, 'preprocess', 'running', t.id)
  const queued = legacyJob(db, 'suggestion', 'queued', t.id)

  const q = new JobQueue(db.db, 2, { baseRetryMs: 5 })
  // Only the live kind is registered — exactly the app's startup wiring.
  q.register('ingest', async () => {})
  const requeued = q.requeueInterrupted()

  assert.equal(requeued, 0, 'no retired row is re-queued')
  const r = getJob(db.db, running)!
  const s = getJob(db.db, queued)!
  assert.equal(r.state, 'running', 'the interrupted preprocess row keeps the state it was written in')
  assert.equal(r.error, null, 'and is not marked failed')
  assert.equal(s.state, 'queued')
  // The task's retired status column is history too — nothing unsticks it.
  db.close()
})

test('a live ingest job still re-queues across the same startup path', async () => {
  const { db } = freshDB()
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'kb task' })
  const id = randomUUID()
  db.db
    .prepare(
      `INSERT INTO enrichment_jobs (id, kind, task_id, state, attempts, created_at, started_at)
       VALUES (?, 'ingest', ?, 'running', 1, ?, ?)`
    )
    .run(id, t.id, new Date().toISOString(), new Date().toISOString())

  let ran = 0
  const q = new JobQueue(db.db, 2, { baseRetryMs: 5 })
  q.register('ingest', async () => {
    ran++
  })
  const requeued = q.requeueInterrupted()
  assert.equal(requeued, 1, 'the registered kind re-queues')
  await sleep(50)
  assert.equal(ran, 1, 'and runs its handler')
  assert.equal(getJob(db.db, id)!.state, 'done')
  db.close()
})
