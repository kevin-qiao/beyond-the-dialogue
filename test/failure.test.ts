import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, getTask, listIngest, getJob } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runAnalysisJob } from '../src/main/paper/analysis'
import { runSuggestionJob } from '../src/main/suggestions'
import { runIngestJob } from '../src/main/wiki/ingest'
import { setSessionFactory, setSimplePromptOverride, type CreateJobSessionOptions } from '../src/main/ai/session-factory'
import { setResolverOverride, type ResolvedPaper } from '../src/main/paper/resolve'
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

const GOOD_RESOLVE: ResolvedPaper = {
  title: 'A Real Paper Title',
  authors: ['Jane Doe'],
  abstract: 'An abstract of the paper.',
  pdfUrl: null,
  level: 'abstract',
  source: 'crossref'
}

before(() => {
  setSimplePromptOverride(async () => JSON.stringify(['Suggestion one', 'Suggestion two']))
})

test('8.2a no API key: analysis fails fast, task marked failed, no corruption', async () => {
  const { conn } = fresh()
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('analysis', runAnalysisJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'paper_reading', link: 'https://arxiv.org/abs/2301.00001' })
  const job = q.enqueue('analysis', t.id)
  await sleep(120)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'failed')
  assert.ok(j.error && j.error.includes('AI not configured'))
  const task = getTask(conn.db, t.id)!
  assert.equal(task.analysisStatus, 'failed')
  assert.equal(task.title, 'p')
  conn.close()
})

test('8.2b invalid link: analysis fails with human-readable reason, retry affordance', async () => {
  const { conn } = fresh()
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x', wikiPath: '', defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
  setResolverOverride(async () => ({ kind: 'unsupported', message: 'Unsupported link. Provide an arXiv link, a DOI, or a publisher URL.' }))
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('analysis', runAnalysisJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'paper_reading', link: 'not-a-link' })
  const job = q.enqueue('analysis', t.id)
  await sleep(120)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'failed')
  assert.ok(j.error && j.error.includes('Unsupported link'))
  const task = getTask(conn.db, t.id)!
  assert.equal(task.analysisStatus, 'failed')
  assert.ok(task.analysisError)
  conn.close()
})

test('8.2c paywalled link (no open PDF) degrades to abstract-only analysis', async () => {
  const { conn } = fresh()
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x', wikiPath: '', defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
  // Scripted session producing a normal analysis.
  setSessionFactory(async (_o: CreateJobSessionOptions) => ({
    subscribe: () => () => {},
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tldr: 'Abstract-only summary.',
              contributions: ['a', 'b'],
              method: 'm',
              results: 'r',
              prerequisites: [],
              suggestions: [{ kind: 'effort', title: 'e', body: 'b' }]
            })
          }
        ]
      }
    ],
    async prompt() {},
    async abort() {}
  }))
  // DOI link resolves metadata but has no pdfUrl -> abstract level.
  setResolverOverride(async () => ({ ...GOOD_RESOLVE, level: 'abstract', pdfUrl: null }))
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('analysis', runAnalysisJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'Paywalled Paper', type: 'paper_reading', link: 'https://doi.org/10.1000/xyz' })
  const job = q.enqueue('analysis', t.id)
  await sleep(250)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'done', j.error)
  const task = getTask(conn.db, t.id)!
  assert.equal(task.analysisStatus, 'abstract_only')
  assert.equal(task.analysisLevel, 'abstract')
  conn.close()
})

test('8.2d provider 429 mid-analysis: auto-retry with backoff then success', async () => {
  const { conn } = fresh()
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x', wikiPath: '', defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
  setResolverOverride(async () => ({ ...GOOD_RESOLVE, level: 'abstract', pdfUrl: null }))
  let calls = 0
  setSessionFactory(async (_o: CreateJobSessionOptions) => {
    calls++
    return {
      subscribe: () => () => {},
      messages: [],
      async prompt() {
        if (calls < 3) throw new Error('Rate limit exceeded (429)')
        this.messages.push({
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tldr: 'ok',
                contributions: ['a'],
                method: 'm',
                results: 'r',
                prerequisites: [],
                suggestions: [{ kind: 'effort', title: 'e', body: 'b' }]
              })
            }
          ]
        })
      },
      async abort() {}
    }
  })
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('analysis', runAnalysisJob)
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'paper_reading', link: 'https://arxiv.org/abs/2301.00001' })
  const job = q.enqueue('analysis', t.id)
  await sleep(500)
  const j = getJob(conn.db, job.id)!
  assert.equal(j.state, 'done', j.error)
  assert.ok(calls >= 3, `retried ${calls} times`)
  conn.close()
})

test('8.2e agent failure mid-ingest: deposit survives, task complete, retry succeeds', async () => {
  const { conn, dir } = fresh()
  const wikiPath = path.join(dir, 'wiki-space')
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x', wikiPath, defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
  ensureVault()
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'paper_reading' })
  const notePath = path.join(dir, 'vault', 'notes', `${t.id}.md`)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, '# notes')
  const { saveNotes } = await import('../src/main/db')
  saveNotes(conn.db, { taskId: t.id, notePath, content: '# notes' })

  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  let calls = 0
  setSessionFactory(async (_o: CreateJobSessionOptions) => {
    calls++
    return {
      subscribe: () => () => {},
      messages: [],
      async prompt() {
        if (calls === 1) throw new Error('provider overloaded (503)')
        const slug = `paper-${t.id.slice(0, 6)}`
        fs.mkdirSync(path.join(wikiPath, 'wiki', 'sources'), { recursive: true })
        fs.writeFileSync(path.join(wikiPath, 'wiki', 'sources', `${slug}.md`), '# summary')
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
  const rawNote = path.join(wikiPath, 'raw', t.id, 'reading-notes.md')
  assert.ok(fs.existsSync(rawNote), 'deposit survived agent failure')
  const sources = fs.readdirSync(path.join(wikiPath, 'wiki', 'sources'))
  assert.ok(sources.length >= 1, 'retry produced the source page')
  conn.close()
})

test('8.2f permanent ingest failure: surfaced failed, deposit intact', async () => {
  const { conn, dir } = fresh()
  const wikiPath = path.join(dir, 'wiki-space')
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x', wikiPath, defaultListId: null, maxConcurrentJobs: 2, showWelcome: false })
  ensureVault()
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'paper_reading' })
  const notePath = path.join(dir, 'vault', 'notes', `${t.id}.md`)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, '# notes')
  const { saveNotes } = await import('../src/main/db')
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
  const rawNote = path.join(wikiPath, 'raw', t.id, 'reading-notes.md')
  assert.ok(fs.existsSync(rawNote), 'deposit survives permanent failure')
  conn.close()
})
