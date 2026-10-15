import { test, before, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, loadSettings, getTask, getNotes, listIngest, saveNotes, createList, createTask, type DB } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runIngestJob } from '../src/main/wiki/ingest'
import { undoCuration } from '../src/main/wiki/undo'
import { createTypeDef, getTypeDef, updateTypeDef } from '../src/main/types'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { artifactStoreFor } from '../src/main/adapters/artifacts'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, type FinishDeps } from '../src/core/services/finishService'
import { setSessionFactory, type CreateJobSessionOptions, type JobSessionLike } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault, writeNote, notePathFor } from '../src/main/wiki/vault'

// The flagship e2e, feature 002 (T044, quickstart §7):
//
//   idea → Document task → draft across a simulated restart → finish
//   organized → knowledge-base curation → Activity ledger → undo → re-finish
//   as-written
//
// All scripted at the seams — no provider, no network. Two guarantees span
// the whole loop: the board never blocks on AI (FR-006), and the off-state
// segments make ZERO outbound calls (FR-021/SC-002).

const DRAFT_V1 = 'wsl2 networking post — first sitting\n\nNAT hides the host; mirror mode fixes most of it.\n'
const DRAFT_V2 = DRAFT_V1 + '\nsecond sitting: add the port-forwarding workaround and a diagram.\n'

let factoryCalls = 0

/** The scripted assistant: organizes faithfully; curates by writing inside
 *  the collection (what the real agent's tools would do). */
function scriptAssistant(kbRoot: string): void {
  setSessionFactory(async (opts: CreateJobSessionOptions): Promise<JobSessionLike> => {
    factoryCalls++
    const messages: any[] = []
    const isCuration = opts.tools.length > 0
    return {
      subscribe: () => () => {},
      messages,
      async prompt(text: string) {
        if (isCuration) {
          const notesDir = path.join(kbRoot, 'learning-notes')
          fs.mkdirSync(notesDir, { recursive: true })
          fs.writeFileSync(path.join(notesDir, 'curated.md'), '# Curated note\n\nBackpressure and mirror mode.\n')
          fs.writeFileSync(path.join(kbRoot, 'index.md'), fs.readFileSync(path.join(kbRoot, 'index.md'), 'utf-8') + '\n- [[curated]]\n')
          messages.push({ role: 'assistant', content: [{ type: 'text', text: 'done' }] })
          return
        }
        const draft = text.split('===DOCUMENT AS WRITTEN BY THE USER===')[1] ?? ''
        messages.push({
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                polished: `# WSL2 networking\n\n${draft.trim().split('\n').slice(1).join('\n')}`,
                preservedFacts: ['NAT hides the host', 'mirror mode fixes most of it']
              })
            }
          ]
        })
      },
      async abort() {},
      async dispose() {}
    }
  })
}

function configured(dir: string, conn: DB, assistantRuntime: 'on' | 'off' = 'on'): void {
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    hasApiKey: true,
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    uiLanguage: 'en',
    assistantRuntime,
    lastCheck: null,
    skills: [],
    mcpServers: []
  })
  storeProviderKey('openai', 'sk-scripted')
}

function depsFor(conn: DB, assistantEnabled: boolean, enqueue?: (taskId: string, files: string[]) => void): FinishDeps {
  return {
    language: 'en',
    assistantEnabled,
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: artifactStoreFor(),
    session: {
      isAvailable: () => loadSettings(conn.db).hasApiKey && !!loadSettings(conn.db).model,
      async run(req) {
        // Route through the seam so the scripted factory answers (the real
        // adapter does the same through createJobSession).
        const session = await (async () => {
          const mod = await import('../src/main/ai/session-factory')
          return mod.createJobSession({
            settings: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-scripted', hasApiKey: true } as never,
            cwd: req.cwd,
            systemPrompt: req.systemPrompt,
            thinkingLevel: 'medium',
            tools: req.tools,
            purpose: req.purpose
          })
        })()
        await session.prompt(req.prompt)
        const last = [...session.messages].reverse().find((m: any) => m.role === 'assistant')
        const content = last?.content
        return Array.isArray(content) ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : String(content ?? '')
      }
    },
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: (task, files) => enqueue?.(task.id, files)
  }
}

before(() => {
  factoryCalls = 0
})

afterEach(() => setSessionFactory(null))

test('8.1 flagship: idea → draft across restart → organized → curation → ledger → undo → re-finish as-written', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'))
  setUserDataRoot(dir)
  const filedDir = path.join(dir, 'filed')
  const kbRoot = path.join(dir, 'kb-space')
  fs.mkdirSync(filedDir, { recursive: true })

  let conn: DB = openDB(dir)
  migrate(conn.db)
  configured(dir, conn)
  ensureVault()
  scriptAssistant(kbRoot)

  // -- the idea becomes a Document task; the built-in is pointed at a folder
  // (the fresh-install guided refusal itself is pinned in freshInstall.test).
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'document')!,
    destination: { store: 'folder', rootPath: filedDir, subdir: '' }
  })
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
  const list = createList(conn.db, 'Writing')
  const post = createTask(conn.db, { listId: list.id, title: 'WSL2 networking blog', type: 'document' })

  // -- drafting, across a simulated restart: the working area survives
  // because the note store + vault mirror ARE the persistence (FR-002/D3).
  writeNote(post.id, DRAFT_V1)
  saveNotes(conn.db, { taskId: post.id, notePath: notePathFor(post.id), content: DRAFT_V1 })
  conn.close()

  conn = openDB(dir) // the restart
  migrate(conn.db)
  assert.equal(getNotes(conn.db, post.id)!.content, DRAFT_V1, 'the draft returns byte-identical after the restart')
  assert.equal(fs.readFileSync(notePathFor(post.id), 'utf-8'), DRAFT_V1, 'and it is on disk in the vault')
  writeNote(post.id, DRAFT_V2)
  saveNotes(conn.db, { taskId: post.id, notePath: notePathFor(post.id), content: DRAFT_V2 })

  // -- finish organized: the filed copy lands, the draft is untouched.
  const organized = await finishTask(depsFor(conn, true), post.id, { mode: 'assisted' })
  assert.equal(organized.report.path, 'organized')
  assert.equal(organized.report.assistantStep, 'ran')
  assert.equal(organized.task.completed, true)
  const filed = path.join(filedDir, 'wsl2-networking-blog.md')
  assert.ok(fs.readFileSync(filed, 'utf-8').startsWith('# WSL2 networking'))
  assert.equal(getNotes(conn.db, post.id)!.content, DRAFT_V2, 'the draft survives the finish byte-identical')

  // -- re-finish as-written: a second artifact beside the first, no session.
  const callsBefore = factoryCalls
  const asWritten = await finishTask(depsFor(conn, true), post.id, { mode: 'as-written' })
  assert.equal(asWritten.report.path, 'as-written')
  assert.equal(asWritten.report.assistantStep, 'skipped')
  assert.equal(factoryCalls, callsBefore, 'the as-written finish constructed nothing')
  assert.deepEqual(fs.readdirSync(filedDir).sort(), ['wsl2-networking-blog-2.md', 'wsl2-networking-blog.md'])
  assert.equal(fs.readFileSync(path.join(filedDir, 'wsl2-networking-blog-2.md'), 'utf-8'), DRAFT_V2)

  // -- the knowledge-base loop: a kb task finishes into the collection —
  // deposit synchronous, curation in the job, ledger records the run.
  const kbTask = createTask(conn.db, { listId: list.id, title: 'backpressure notes', type: 'plain', customTypeKey: 'kb_notes' })
  writeNote(kbTask.id, '# Field notes\n\nThe ingestion pipeline needs backpressure.\n')
  saveNotes(conn.db, { taskId: kbTask.id, notePath: notePathFor(kbTask.id), content: '# Field notes\n\nThe ingestion pipeline needs backpressure.\n' })
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  const deposited = await finishTask(depsFor(conn, true, (taskId, files) => q.enqueueIngest(taskId, 'backpressure notes', files)), kbTask.id)
  assert.equal(deposited.report.path, 'deposited')
  assert.ok(fs.existsSync(path.join(kbRoot, 'raw', kbTask.id)), 'the deposit landed synchronously at finish')

  const rec = listIngest(conn.db).find((r) => r.taskId === kbTask.id)!
  const deadline = Date.now() + 20000
  for (;;) {
    const cur = listIngest(conn.db).find((r) => r.id === rec.id)!
    if (cur.state === 'done' || cur.state === 'failed') {
      assert.equal(cur.state, 'done', cur.error ?? '')
      break
    }
    assert.ok(Date.now() < deadline, 'curation timed out')
    await new Promise((r) => setTimeout(r, 100))
  }

  // -- the Activity ledger tells the truth: touched files, the snapshot.
  const done = listIngest(conn.db).find((r) => r.id === rec.id)!
  assert.ok(done.touchedFiles.includes('learning-notes/curated.md'))
  assert.ok(done.snapshotDir && fs.existsSync(path.join(kbRoot, done.snapshotDir)))
  assert.ok(done.depositFiles.some((f) => f.endsWith('.md')))

  // -- undo reverses the curation; the deposit stands (Q3=A).
  const undo = undoCuration(conn.db, rec.id)
  assert.equal(undo.ok, true)
  assert.equal(fs.existsSync(path.join(kbRoot, 'learning-notes', 'curated.md')), false, 'the curated page returned to its retained state')
  assert.ok(fs.readdirSync(path.join(kbRoot, 'raw', kbTask.id)).length > 0, 'the deposit stands')
  assert.equal(listIngest(conn.db).find((r) => r.id === rec.id)!.state, 'undone')

  // -- the board never blocks on AI: with the switch off, a document task
  // still writes, still finishes (as written), and zero seams are touched.
  configured(dir, conn, 'off')
  const callsAfterCuration = factoryCalls
  const offline = createTask(conn.db, { listId: list.id, title: 'offline diary', type: 'document' })
  saveNotes(conn.db, { taskId: offline.id, notePath: notePathFor(offline.id), content: 'day one\n' })
  const offOutcome = await finishTask(depsFor(conn, false), offline.id, { mode: 'assisted' })
  assert.equal(offOutcome.task.completed, true, 'FR-006: the board never blocks on AI')
  assert.equal(offOutcome.report.path, 'as-written')
  assert.equal(offOutcome.report.assistantStep, 'skipped')
  assert.equal(factoryCalls, callsAfterCuration, 'FR-021: zero outbound calls in the off-state segment')
  assert.equal(fs.readFileSync(path.join(filedDir, 'offline-diary.md'), 'utf-8'), 'day one\n')

  conn.close()
})
