import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, getTask, getNotes, listIngest, saveNotes, updateTask } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runIngestJob } from '../src/main/wiki/ingest'
import { setSessionFactory, type CreateJobSessionOptions } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { storeProviderKey } from '../src/main/secrets'
import { ensureVault, writeNote, notePathFor } from '../src/main/wiki/vault'
import { serviceCreateList, serviceCreateTask } from '../src/main/tasks'
import { createTypeDef, effectiveTypeDef } from '../src/main/types'
import { declaredWorkflow } from '../src/core/domain/taskType'
import { workingAreaFor } from '../src/core/domain/workingArea'

// The flagship e2e, feature-002 interim shape: idea → a user-declared
// knowledge-base Document Type → draft in the working area → finish →
// deposit-first curation → the Activity ledger. All scripted at the seams —
// no provider, no network.
//
// The POC's journey (preprocess on My Day add, suggestion chips, the meeting
// polish loop) is deleted with its engines (D4/FR-016); T044 extends this
// file to the full 002 loop: organize-mode finish, undo, and the as-written
// re-finish.

// A scripted agent session that writes the wiki files the real curating agent
// would (then the diff reports them).
function makeScriptedIngestSession(wikiPath: string, taskId: string) {
  const messages: any[] = []
  return {
    subscribe: () => () => {},
    messages,
    async prompt() {
      const slug = `learning-${taskId.slice(0, 6)}`
      fs.mkdirSync(path.join(wikiPath, 'learning-notes'), { recursive: true })
      fs.writeFileSync(
        path.join(wikiPath, 'learning-notes', `${slug}.md`),
        `# ${slug}\n\nOverview: a scripted curated note.\n\n## Sources\n\n- [[raw/${taskId}]]\n`
      )
      const index = fs.readFileSync(path.join(wikiPath, 'index.md'), 'utf-8')
      fs.writeFileSync(path.join(wikiPath, 'index.md'), index + `\n- [[${slug}]] — scripted curated note\n`)
      fs.appendFileSync(path.join(wikiPath, 'log.md'), `\n## [${new Date().toISOString().slice(0, 10)}] ingest | ${slug}\n`)
      messages.push({ role: 'assistant', content: [{ type: 'text', text: 'done' }] })
    },
    async abort() {}
  }
}

before(() => {
  // Settings must be configured so the job passes the AI-configured guard,
  // but the scripted session factory means no real provider is contacted.
  setSessionFactory(async (opts: CreateJobSessionOptions) => makeScriptedIngestSession(opts.cwd, 'scripted'))
})

async function waitForIngest(db: any, ingestId: string): Promise<void> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const recs = listIngest(db)
    const r = recs.find((x) => x.id === ingestId)
    if (r && (r.state === 'done' || r.state === 'failed')) {
      if (r.state === 'failed') throw new Error(`ingest failed: ${r.error}`)
      return
    }
    await new Promise((r2) => setTimeout(r2, 150))
  }
  throw new Error('ingest timed out')
}

test('8.1 flagship (interim): document task -> working-area draft -> finish -> wiki deposit + curation -> ledger', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'))
  setUserDataRoot(dir)
  const wikiPath = path.join(dir, 'wiki-space')
  const conn = openDB(dir)
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
  // v10 moved secret values out of the table; the job path resolves the key
  // from the machine-bound store, so the scripted key lives there now.
  storeProviderKey('openai', 'sk-scripted')
  ensureVault()

  // The learning case is a USER-DECLARED wiki-destined Document Type (spec
  // Seed-set synthesis; SC-010 exercises the same path) — the seeded set
  // carries only the generic document Type, which ships without a location.
  createTypeDef(conn.db, {
    key: 'kb_notes',
    family: 'document',
    label: 'Knowledge notes',
    emoji: '📚',
    inputSchema: [],
    aiGuidance: 'Curate into the knowledge base.',
    isBuiltin: false,
    finishBehaviour: 'deposit-then-curate',
    destination: { store: 'wiki', rootPath: wikiPath, subdir: 'learning-notes' }
  })

  // 1. The idea becomes a task of that Type.
  const list = serviceCreateList(conn.db, 'Research')
  const task = serviceCreateTask(conn.db, {
    listId: list.id,
    title: 'NFTrig: Using Blockchain Technologies for Math Education',
    type: 'plain',
    customTypeKey: 'kb_notes'
  })

  // The declaration is what routes it — family, working area and behaviour
  // all read from the Type, never from a key comparison (Principle I).
  const def = effectiveTypeDef(conn.db, task)!
  assert.equal(def.family, 'document')
  assert.equal(workingAreaFor(def.family), 'markdown')
  assert.equal(declaredWorkflow(def).finishBehaviour, 'deposit-then-curate')
  // No board interaction starts AI work any more (D4).
  assert.equal(task.preprocessStatus, 'none')

  // 2. The draft is written in the working area (the note store + its vault
  //    mirror — the same storage, a new meaning, D3).
  const draft = '# Learning Notes\n\nKey insight: blockchain for math education.'
  writeNote(task.id, draft)
  saveNotes(conn.db, { taskId: task.id, notePath: notePathFor(task.id), content: draft })
  const notes = getNotes(conn.db, task.id)
  assert.equal(notes?.content, draft)

  // 3. Finish: the deposit lands synchronously, the task completes, and the
  //    curation is handed to the queue (mirrors the IPC finishTask wiring).
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('ingest', runIngestJob)
  updateTask(conn.db, task.id, { completed: true, completedAt: new Date().toISOString() })
  const ingestRec = q.enqueueIngest(task.id, task.title, [])
  await waitForIngest(conn.db, ingestRec.id)

  // 4. The ledger records the run.
  const ingest = listIngest(conn.db)
  assert.equal(ingest.length, 1)
  assert.equal(ingest[0]!.state, 'done')
  // The deposit carries a file name generated from the title — and NO AI
  // summary: the deposit is the user's own material and nothing else (D4).
  assert.ok(
    ingest[0]!.depositFiles.some((f) => f === 'nftrig-using-blockchain-technologies-for-math-education.md'),
    `deposit files: ${ingest[0]!.depositFiles}`
  )
  assert.ok(!ingest[0]!.depositFiles.includes('ai-summary.md'), `no AI summary joins the deposit: ${ingest[0]!.depositFiles}`)
  assert.ok(
    ingest[0]!.touchedFiles.some((f) => f.startsWith('learning-notes/')),
    `curated note reported as touched: ${ingest[0]!.touchedFiles}`
  )

  // 5. The wiki contains the curated note, updated index, log entry.
  const curated = fs.readdirSync(path.join(wikiPath, 'learning-notes'))
  assert.ok(curated.length >= 1, 'curated note created')
  const index = fs.readFileSync(path.join(wikiPath, 'index.md'), 'utf-8')
  assert.ok(index.includes('learning-'), 'index updated')
  const log = fs.readFileSync(path.join(wikiPath, 'log.md'), 'utf-8')
  assert.ok(log.includes('ingest'), 'log entry appended')

  // raw/ contains the deposited note (deposit-first safety net).
  const rawDir = path.join(wikiPath, 'raw', task.id)
  assert.ok(fs.readdirSync(rawDir).some((f) => f.endsWith('.md')), 'raw deposit survived')

  // .history snapshot exists.
  const hist = fs.readdirSync(path.join(wikiPath, '.history'))
  assert.ok(hist.length >= 1, 'history snapshot present')

  // 6. The task is completed and its draft is untouched (FR-002).
  const finished = getTask(conn.db, task.id)!
  assert.equal(finished.completed, true)
  assert.equal(getNotes(conn.db, task.id)!.content, draft, 'the draft survives the finish byte-identical')

  conn.close()
})
