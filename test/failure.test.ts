import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, getTask, listIngest, getJob, saveNotes } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runPreprocessJob } from '../src/main/preprocess'
import { runIngestJob } from '../src/main/wiki/ingest'
import { setSessionFactory, setSimplePromptOverride, type CreateJobSessionOptions } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { ensureVault } from '../src/main/wiki/vault'
import { serviceCreateList, serviceCreateTask } from '../src/main/tasks'

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fail-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  return { conn, dir }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function configured(dir: string, conn: ReturnType<typeof openDB>) {
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x', wikiPath: path.join(dir, 'wiki-space'), defaultListId: null, maxConcurrentJobs: 2, showWelcome: false, theme: 'light', skills: [], mcpServers: [] })
}

before(() => {
  setSimplePromptOverride(async () => JSON.stringify(['Suggestion one', 'Suggestion two']))
})

test('8.2a no API key: preprocess fails fast, task marked failed, no corruption', async () => {
  const { conn } = fresh()
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'learn x', type: 'learning', inputs: { target: 'x' } })
  const job = q.enqueue('preprocess', t.id)
  await sleep(120)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'failed')
  assert.ok(j.error && j.error.includes('AI not configured'))
  const task = getTask(conn.db, t.id)!
  assert.equal(task.preprocessStatus, 'failed')
  assert.equal(task.title, 'learn x')
  conn.close()
})

test('8.2c learning preprocess outputs persist and land as chips', async () => {
  const { conn, dir } = fresh()
  configured(dir, conn)
  const output = JSON.stringify({
    generatedPrompt: 'You are helping me learn eigenvalues…',
    summary: 'A learning task about linear algebra.',
    suggestions: ['Work through 2x2 examples first', 'Connect to SVD notes']
  })
  setSessionFactory(async (_o: CreateJobSessionOptions) => ({
    subscribe: () => () => {},
    messages: [{ role: 'assistant', content: [{ type: 'text', text: output }] }],
    async prompt() {},
    async abort() {}
  }))
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'Eigenvalues', type: 'learning', inputs: { target: 'Eigenvalues' } })
  const job = q.enqueue('preprocess', t.id)
  await sleep(250)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'done', j.error)
  const task = getTask(conn.db, t.id)!
  assert.equal(task.preprocessStatus, 'ready')
  const { getPreprocess, listSuggestions } = await import('../src/main/db')
  const p = getPreprocess(conn.db, t.id)!
  assert.ok(p.generatedPrompt.startsWith('You are helping'))
  assert.ok(p.inputsHash, 'hash recorded for the re-run gate')
  assert.equal(p.suggestions.length, 2)
  assert.equal(listSuggestions(conn.db, t.id).length, 2, 'suggestions land as dismissible chips')
  conn.close()
})

test('8.2c2 jira/confluence preprocess: page kind produces quality summary from pasted source', async () => {
  const { conn, dir } = fresh()
  configured(dir, conn)
  setSessionFactory(async (_o: CreateJobSessionOptions) => ({
    subscribe: () => () => {},
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              generatedPrompt: '',
              summary: 'The page explains the release process but is missing a rollback section.',
              suggestions: ['Add a rollback section', 'Update the stale links']
            })
          }
        ]
      }
    ],
    async prompt() {},
    async abort() {}
  }))
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, {
    listId: list.id,
    title: 'Fix the release doc',
    type: 'jira',
    inputs: { sourceKind: 'page', sourceText: 'How we release. Steps 1-4. (no rollback)', target: 'Improve the page' }
  })
  const job = q.enqueue('preprocess', t.id)
  await sleep(250)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'done', j.error)
  const { getPreprocess } = await import('../src/main/db')
  const p = getPreprocess(conn.db, t.id)!
  assert.ok(p.summary.includes('rollback'), 'confluence summary assesses quality of the pasted content')
  assert.equal(p.kind, 'jira')
  conn.close()
})

test('8.2d provider 429 mid-preprocess: auto-retry with backoff then success', async () => {
  const { conn, dir } = fresh()
  configured(dir, conn)
  let calls = 0
  setSessionFactory(async (_o: CreateJobSessionOptions) => {
    calls++
    const attempt = calls
    return {
      subscribe: () => () => {},
      messages: [],
      async prompt() {
        if (attempt < 3) throw new Error('Rate limit exceeded (429)')
        this.messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify({ generatedPrompt: 'p', summary: 'ok', suggestions: ['a'] }) }]
        })
      },
      async abort() {}
    }
  })
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'learning', inputs: { target: 'x' } })
  const job = q.enqueue('preprocess', t.id)
  await sleep(500)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'done', j.error)
  assert.ok(calls >= 3, `retried ${calls} times`)
  conn.close()
})

test('8.2e agent failure mid-ingest: deposit survives, task complete, retry succeeds', async () => {
  const { conn, dir } = fresh()
  configured(dir, conn)
  ensureVault()
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'learning' })
  const notePath = path.join(dir, 'vault', 'notes', `${t.id}.md`)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, '# notes')
  saveNotes(conn.db, { taskId: t.id, notePath, content: '# notes' })

  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  let calls = 0
  setSessionFactory(async (_o: CreateJobSessionOptions) => {
    calls++
    const n = calls
    return {
      subscribe: () => () => {},
      messages: [],
      async prompt() {
        if (n === 1) throw new Error('provider overloaded (503)')
        const wikiPath = path.join(dir, 'wiki-space')
        const slug = `learning-note-${t.id.slice(0, 6)}`
        fs.mkdirSync(path.join(wikiPath, 'learning-notes'), { recursive: true })
        fs.writeFileSync(path.join(wikiPath, 'learning-notes', `${slug}.md`), '# curated')
        fs.appendFileSync(path.join(wikiPath, 'log.md'), '\n## [2026-01-01] ingest | x\n')
      },
      async abort() {}
    }
  })

  const rec = q.enqueueIngest(t.id, 'p', [])
  await sleep(500)
  const recs = listIngest(conn.db)
  assert.equal(recs.length, 1)
  assert.equal(recs[0]!.state, 'done', recs[0]!.error ?? '')
  // Deposit survived the transient failure: raw/ has the note.
  const rawDir = path.join(dir, 'wiki-space', 'raw', t.id)
  assert.ok(fs.readdirSync(rawDir).some((f) => f.endsWith('.md')), 'deposit survived agent failure')
  const curated = path.join(dir, 'wiki-space', 'learning-notes', `learning-note-${t.id.slice(0, 6)}.md`)
  assert.ok(fs.existsSync(curated), 'retry produced the curated note')
  conn.close()
})

test('8.2f permanent ingest failure: surfaced failed, deposit intact', async () => {
  const { conn, dir } = fresh()
  configured(dir, conn)
  ensureVault()
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'learning' })
  const notePath = path.join(dir, 'vault', 'notes', `${t.id}.md`)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, '# notes')
  saveNotes(conn.db, { taskId: t.id, notePath, content: '# notes' })

  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  setSessionFactory(async (_o: CreateJobSessionOptions) => ({
    subscribe: () => () => {},
    messages: [],
    async prompt() {
      throw new Error('invalid API key')
    },
    async abort() {}
  }))

  const rec = q.enqueueIngest(t.id, 'p', [])
  await sleep(200)
  const recs = listIngest(conn.db)
  assert.equal(recs[0]!.state, 'failed')
  assert.ok(recs[0]!.error && recs[0]!.error.length > 0, 'human-readable failure')
  // Deposit survives even permanent failure.
  const rawDir = path.join(dir, 'wiki-space', 'raw', t.id)
  assert.ok(fs.readdirSync(rawDir).some((f) => f.endsWith('.md')), 'deposit survives permanent failure')
  conn.close()
})
