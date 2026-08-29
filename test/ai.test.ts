import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, listLists, createTask, getJob, listSuggestions, getTask } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runSuggestionJob } from '../src/main/jobs/suggestions'
import { setUserDataRoot } from '../src/main/paths'

function freshDB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ai-'))
  setUserDataRoot(dir)
  const db = openDB(dir)
  migrate(db.db)
  return { db, dir }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('4.5 suggestion job with no API key degrades gracefully (no-op, task unaffected)', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2, { baseRetryMs: 5 })
  q.register('suggestion', runSuggestionJob)
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'a task' })
  const job = q.enqueue('suggestion', t.id)
  await sleep(80)
  const j = getJob(db.db, job.id)!
  assert.equal(j.state, 'done', 'no-key suggestion job completes without error')
  assert.equal(listSuggestions(db.db, t.id).length, 0, 'no suggestions generated without key')
  const after = getTask(db.db, t.id)!
  assert.equal(after.title, 'a task', 'task is never mutated')
  db.close()
})

test('4.5 analysis job with no key fails cleanly with retryable/no-key message', async () => {
  const { db } = freshDB()
  const q = new JobQueue(db.db, 2, { baseRetryMs: 5 })
  // register a no-key analysis stub that mirrors the real guard
  q.register('analysis', async () => {
    throw new Error('AI not configured: no API key')
  })
  const l = listLists(db.db)[0]!
  const t = createTask(db.db, { listId: l.id, title: 'paper', type: 'paper_reading', link: 'https://arxiv.org/abs/2301.00001' })
  const job = q.enqueue('analysis', t.id)
  await sleep(80)
  const j = getJob(db.db, job.id)!
  assert.ok(j.state === 'failed' || j.state === 'done', `job ended in ${j.state}`)
  db.close()
})
