import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, listIngest, saveNotes } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runIngestJob } from '../src/main/wiki/ingest'
import { setSessionFactory, type CreateJobSessionOptions } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault } from '../src/main/wiki/vault'
import { serviceCreateList, serviceCreateTask } from '../src/main/tasks'
import { createTypeDef } from '../src/main/types'

// The failure paths of the ONE live job kind (D4): the curation run behind a
// `deposit-then-curate` finish. The preprocess/suggestion failure tests are
// deleted with their engines — the retired kinds' history rule is pinned in
// test/ai.test.ts.

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fail-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  return { conn, dir }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The knowledge-base location belongs to a user-declared wiki-destined
// Document Type (spec Seed-set synthesis: the learning case is machinery, not
// a built-in row).
function configured(dir: string, conn: ReturnType<typeof openDB>) {
  saveSettings(conn.db, { provider: 'openai', model: 'gpt-4o', hasApiKey: true, defaultListId: null, maxConcurrentJobs: 2, showWelcome: false, theme: 'light', uiLanguage: 'en', assistantRuntime: 'on', lastCheck: null, skills: [], mcpServers: [] })
  storeProviderKey('openai', 'sk-x')
  createTypeDef(conn.db, {
    key: 'kb',
    family: 'document',
    label: 'Knowledge base',
    emoji: '📚',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'deposit-then-curate',
    destination: { store: 'wiki', rootPath: path.join(dir, 'wiki-space'), subdir: 'learning-notes' }
  })
}

test('8.2e agent failure mid-ingest: deposit survives, task complete, retry succeeds', async () => {
  const { conn, dir } = fresh()
  configured(dir, conn)
  ensureVault()
  const list = serviceCreateList(conn.db, 'L')
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'plain', customTypeKey: 'kb' })
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
  const t = serviceCreateTask(conn.db, { listId: list.id, title: 'p', type: 'plain', customTypeKey: 'kb' })
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
