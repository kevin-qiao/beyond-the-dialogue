import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, listRunningJobs, getJob } from '../src/main/db'
import { JobQueue, isTransientError } from '../src/main/job-queue'

function freshDB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-q-'))
  const db = openDB(dir)
  migrate(db.db)
  return { db, dir }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('4.2 job queue runs at most maxConcurrent at once', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2)
  let active = 0
  let peak = 0
  let completed = 0
  q.register('analysis', async () => {
    active++
    peak = Math.max(peak, active)
    await sleep(40)
    active--
    completed++
  })
  q.enqueue('analysis', null)
  q.enqueue('analysis', null)
  q.enqueue('analysis', null)
  q.enqueue('analysis', null)
  await sleep(300)
  assert.equal(completed, 4)
  assert.ok(peak <= 2, `peak concurrency was ${peak}`)
  db.close()
})

test('4.2 restart re-queues interrupted running jobs', async () => {
  const { db } = freshDB()
  // simulate a crash: a job stuck in running state in the DB
  db.db
    .prepare(
      'INSERT INTO enrichment_jobs (id, kind, task_id, state, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('job-interrupted', 'analysis', null, 'running', 1, new Date().toISOString())
  const running = listRunningJobs(db.db)
  assert.equal(running.length, 1)
  const requeued = new JobQueue(db.db, 2)
  let ran = 0
  requeued.register('analysis', async () => {
    ran++
  })
  const n = requeued.requeueInterrupted()
  assert.ok(n >= 1)
  await sleep(120)
  assert.ok(ran >= 1, 'interrupted job was re-run')
  db.close()
})

test('4.4 transient errors are retried; permanent errors fail immediately', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2, { baseRetryMs: 5 })
  let attempts = 0
  q.register('analysis', async () => {
    attempts++
    if (attempts < 3) throw new Error('Rate limit exceeded (429)')
  })
  const job = q.enqueue('analysis', null)
  await sleep(120)
  const j = getJob(db.db, job.id)!
  assert.equal(j.state, 'done')
  assert.ok(attempts >= 3, `expected retries, got ${attempts} attempts`)
  db.close()
})

test('4.4 non-transient errors fail and expose reason', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2)
  q.register('analysis', async () => {
    throw new Error('Invalid API key')
  })
  const job = q.enqueue('analysis', null)
  await sleep(80)
  const j = getJob(db.db, job.id)!
  assert.equal(j.state, 'failed')
  assert.equal(j.error, 'Invalid API key')
  db.close()
})

test('4.4 transient classification', () => {
  assert.equal(isTransientError(new Error('rate limit')), true)
  assert.equal(isTransientError(new Error('overloaded')), true)
  assert.equal(isTransientError(new Error('timeout')), true)
  assert.equal(isTransientError(new Error('boom')), false)
})

test('4.7 suggestion and analysis job kinds dispatch correctly', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2)
  const kinds: string[] = []
  q.register('suggestion', async () => {
    kinds.push('suggestion')
  })
  q.register('analysis', async () => {
    kinds.push('analysis')
  })
  q.enqueue('suggestion', 'task-1')
  q.enqueue('analysis', 'task-2')
  await sleep(80)
  assert.deepEqual(kinds.sort(), ['analysis', 'suggestion'])
  db.close()
})

test('6.4 cancel: running job is failed with "cancelled by user" and onCancel fires', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2, { baseRetryMs: 5 })
  let release!: () => void
  let onCancelFired = false
  const gate = new Promise<void>((r) => (release = r))
  q.register('analysis', async (ctx) => {
    ctx.onCancel(() => {
      onCancelFired = true
    })
    await gate
  })
  const job = q.enqueue('analysis', null)
  await sleep(30) // let it start running
  q.cancel(job.id)
  release()
  await sleep(80)
  const done = getJob(db.db, job.id)!
  assert.equal(done.state, 'failed')
  assert.equal(done.error, 'cancelled by user')
  assert.equal(onCancelFired, true)
  db.close()
})

test('6.4 cancel: queued job is failed in place and never runs', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 1, { baseRetryMs: 5 })
  let runs = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  q.register('analysis', async () => {
    runs++
    await gate
  })
  const first = q.enqueue('analysis', null)
  const second = q.enqueue('analysis', null)
  await sleep(30)
  q.cancel(second.id)
  release()
  await sleep(80)
  assert.equal(runs, 1, 'cancelled job never started')
  assert.equal(getJob(db.db, second.id)!.state, 'failed')
  assert.equal(getJob(db.db, second.id)!.error, 'cancelled by user')
  assert.equal(getJob(db.db, first.id)!.state, 'done')
  db.close()
})

test('6.4 cancel: cancelled jobs do not auto-retry', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2, { baseRetryMs: 5, maxAttempts: 3 })
  let attempts = 0
  q.register('analysis', async () => {
    attempts++
    await new Promise((r) => setTimeout(r, 400))
    throw new Error('boom')
  })
  const job = q.enqueue('analysis', null)
  await sleep(40) // job is running now
  q.cancel(job.id)
  await sleep(600)
  assert.equal(attempts, 1, 'no auto-retry after cancel')
  const done = getJob(db.db, job.id)!
  assert.equal(done.state, 'failed')
  assert.equal(done.error, 'cancelled by user')
  db.close()
})
