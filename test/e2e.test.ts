import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, getTask, getPreprocess, getNotes, listIngest, listSuggestions, getJob, saveNotes, updateTask } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runPreprocessJob } from '../src/main/preprocess'
import { runSuggestionJob } from '../src/main/suggestions'
import { runIngestJob } from '../src/main/wiki/ingest'
import { setSessionFactory, setSimplePromptOverride, type CreateJobSessionOptions } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { ensureVault, writeNote, notePathFor } from '../src/main/wiki/vault'
import { serviceCreateList, serviceCreateTask, serviceSetMyDay } from '../src/main/tasks'

const SCRIPTED_PREPROCESS = JSON.stringify({
  generatedPrompt: 'You are helping me learn blockchain applications for math education. Start from the NFTrig paper\'s core claim.',
  summary: 'A learning task about applying blockchain techniques to math education, based on the NFTrig paper.',
  suggestions: ['Summarize the paper\'s mechanism in your own words', 'Compare with traditional LMS approaches', 'Sketch a small demo idea']
})

// A scripted agent session that returns canned outputs; for the ingest job it
// actually writes the wiki files the real agent would (then diff reports them).
function makeScriptedSession(kind: 'preprocess' | 'ingest', wikiPath: string, taskId: string) {
  const messages: any[] = []
  return {
    subscribe: () => () => {},
    messages,
    async prompt() {
      if (kind === 'preprocess') {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: SCRIPTED_PREPROCESS }] })
      } else {
        // Simulate the ingestion agent's file operations: write the curated
        // learning note, update index and log.
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
      }
    },
    async abort() {}
  }
}

before(() => {
  // Settings must be configured so jobs pass the AI-configured guard, but the
  // scripted session factory means no real provider is contacted.
  setSessionFactory(async (opts: CreateJobSessionOptions) => {
    const kind = opts.systemPrompt.includes('wiki') ? 'ingest' : 'preprocess'
    return makeScriptedSession(kind, opts.cwd, 'scripted')
  })
  setSimplePromptOverride(async () =>
    JSON.stringify(['Break the topic into two sessions.', 'Skim the figures first.', 'Draft the notes in your own words.'])
  )
})

async function waitForJob(db: any, jobId: string, kind: string): Promise<void> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const j = getJob(db, jobId)
    if (j && (j.state === 'done' || j.state === 'failed')) {
      if (j.state === 'failed') throw new Error(`${kind} job failed: ${j.error}`)
      return
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`${kind} job timed out`)
}

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

test('8.1 flagship scenario: learning task -> My Day -> preprocess -> note -> Finish -> wiki ingest', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'))
  setUserDataRoot(dir)
  const wikiPath = path.join(dir, 'wiki-space')
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-scripted',
    wikiPath,
    defaultListId: null,
    maxConcurrentJobs: 2, showWelcome: false, theme: 'light', skills: [], mcpServers: []
  })
  ensureVault()

  // 1. Create a learning task with its target input.
  const list = serviceCreateList(conn.db, 'Research')
  const task = serviceCreateTask(conn.db, {
    listId: list.id,
    title: 'NFTrig: Using Blockchain Technologies for Math Education',
    type: 'learning',
    inputs: { target: 'How NFTrig applies blockchain to math education', purpose: 'Write a learning note' }
  })
  assert.equal(task.type, 'learning')
  assert.equal(task.preprocessStatus, 'none')

  // 2. Trigger model (spec task-types): first add to My Day fires the
  // kind's pre-process (AI configured) instead of the plain suggestion job.
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  q.register('suggestion', runSuggestionJob)
  q.register('ingest', runIngestJob)
  serviceSetMyDay(conn.db, task.id, true)
  const preJob = q.enqueue('preprocess', task.id)
  await waitForJob(conn.db, preJob.id, 'preprocess')

  // 3. Pre-process completed and persisted; suggestions landed as chips.
  const processed = getTask(conn.db, task.id)!
  assert.equal(processed.preprocessStatus, 'ready')
  const pp = getPreprocess(conn.db, task.id)!
  assert.ok(pp.generatedPrompt.length > 0, 'working prompt generated')
  assert.ok(pp.summary.includes('blockchain'), 'summary derived from task context')
  assert.equal(pp.kind, 'learning')
  assert.ok(pp.inputsHash, 'inputs hash recorded for the re-run gate')
  assert.ok(listSuggestions(conn.db, task.id).length >= 2, 'activity suggestions as dismissible chips')

  // 4. Write the working note (file-backed in vault, autosave path).
  writeNote(task.id, '# Learning Notes\n\nKey insight: blockchain for math education.')
  saveNotes(conn.db, { taskId: task.id, notePath: notePathFor(task.id), content: '# Learning Notes\n\nKey insight: blockchain for math education.' })
  const notes = getNotes(conn.db, task.id)
  assert.ok(notes?.content.includes('Key insight'))

  // 5. Finish -> mark complete + hand off to ingestion (mirrors IPC finishTask).
  updateTask(conn.db, task.id, { completed: true, completedAt: new Date().toISOString() })
  const ingestRec = q.enqueueIngest(task.id, task.title, [])
  await waitForIngest(conn.db, ingestRec.id)
  const ingest = listIngest(conn.db)
  assert.equal(ingest.length, 1)
  assert.equal(ingest[0]!.state, 'done')
  // Deposit carries a file name generated from the title.
  assert.ok(
    ingest[0]!.depositFiles.some((f) => f === 'nftrig-using-blockchain-technologies-for-math-education.md'),
    `deposit files: ${ingest[0]!.depositFiles}`
  )
  assert.ok(ingest[0]!.depositFiles.includes('ai-summary.md'), 'AI summary deposited too')
  assert.ok(
    ingest[0]!.touchedFiles.some((f) => f.startsWith('learning-notes/')),
    `curated learning note reported as touched: ${ingest[0]!.touchedFiles}`
  )

  // 6. Wiki contains the curated note, updated index, log entry.
  const curated = fs.readdirSync(path.join(wikiPath, 'learning-notes'))
  assert.ok(curated.length >= 1, 'curated learning note created')
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

  // 7. Task is completed.
  const finished = getTask(conn.db, task.id)!
  assert.equal(finished.completed, true)

  conn.close()
})

test('8.1b re-running after input change refreshes outputs (hash gate)', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e2-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-scripted',
    wikiPath: path.join(dir, 'wiki-space'),
    defaultListId: null,
    maxConcurrentJobs: 2, showWelcome: false, theme: 'light', skills: [], mcpServers: []
  })
  ensureVault()

  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  const list = serviceCreateList(conn.db, 'L')
  const task = serviceCreateTask(conn.db, { listId: list.id, title: 'T', type: 'learning', inputs: { target: 'A' } })
  serviceSetMyDay(conn.db, task.id, true)
  const first = q.enqueue('preprocess', task.id)
  await waitForJob(conn.db, first.id, 'preprocess')
  const hash1 = getPreprocess(conn.db, task.id)!.inputsHash

  // Edit the target while in My Day → hash changed → re-run allowed.
  const edited = updateTask(conn.db, task.id, { inputs: { ...task.inputs, target: 'B' } })
  const { preprocessInputHash } = await import('../src/main/types')
  const { effectiveTypeDef } = await import('../src/main/types')
  const def = effectiveTypeDef(conn.db, edited)
  const newHash = preprocessInputHash(edited, def)
  assert.notEqual(newHash, hash1)

  const second = q.enqueue('preprocess', edited.id)
  await waitForJob(conn.db, second.id, 'preprocess')
  const after = getPreprocess(conn.db, task.id)!
  assert.notEqual(after.inputsHash, hash1, 'second run recorded the new hash')
  conn.close()
})
