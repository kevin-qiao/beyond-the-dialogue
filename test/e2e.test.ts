import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, getTask, getAnalysis, getNotes, listIngest, listSuggestions, getJob, saveNotes, updateTask } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runAnalysisJob } from '../src/main/jobs/analysis'
import { runSuggestionJob } from '../src/main/jobs/suggestions'
import { runIngestJob } from '../src/main/jobs/ingest'
import { setSessionFactory, setSimplePromptOverride, type CreateJobSessionOptions } from '../src/main/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { ensureVault, writeNote } from '../src/main/vault'
import { serviceCreateList, serviceCreateTask, serviceSetMyDay } from '../src/main/tasks'

const SCRIPTED_ANALYSIS = JSON.stringify({
  tldr: 'A scripted summary of the paper.',
  contributions: ['Contribution one', 'Contribution two', 'Contribution three'],
  method: 'The method combines simulation with theory.',
  results: 'Key results improve accuracy by 12%.',
  prerequisites: ['Linear algebra', 'Probability'],
  suggestions: [
    { kind: 'effort', title: 'Estimated effort', body: 'About 2 hours.' },
    { kind: 'order', title: 'Reading order', body: 'Read sections 2 then 4.' },
    { kind: 'question', title: 'Questions', body: 'How was the baseline chosen?' }
  ]
})

// A scripted agent session that returns canned outputs; for the ingest job it
// actually writes the wiki files the real agent would (then diff reports them).
function makeScriptedSession(kind: 'analysis' | 'ingest', wikiPath: string, taskId: string) {
  const messages: any[] = []
  return {
    subscribe: () => () => {},
    messages,
    async prompt() {
      if (kind === 'analysis') {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: SCRIPTED_ANALYSIS }] })
      } else {
        // Simulate the ingestion agent's file operations.
        const slug = `paper-${taskId.slice(0, 6)}`
        fs.mkdirSync(path.join(wikiPath, 'wiki', 'sources'), { recursive: true })
        fs.writeFileSync(
          path.join(wikiPath, 'wiki', 'sources', `${slug}.md`),
          `# ${slug}\n\nTLDR: a scripted summary.\n\n## Notes\n\nReading notes from the user.\n`
        )
        const index = fs.readFileSync(path.join(wikiPath, 'index.md'), 'utf-8')
        if (!index.includes('new-paper')) {
          fs.writeFileSync(path.join(wikiPath, 'index.md'), index + `\n- [[${slug}]] — scripted summary\n`)
        }
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
    const kind = opts.systemPrompt.includes('wiki') ? 'ingest' : 'analysis'
    return makeScriptedSession(kind, opts.cwd, 'scripted')
  })
  setSimplePromptOverride(async () =>
    JSON.stringify(['Break the paper into two reading sessions.', 'Skim the figures first.', 'Draft the notes in your own words.'])
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

test('8.1 flagship scenario: arXiv paper -> My Day -> analysis -> notes -> Finish -> wiki ingest', { timeout: 30000 }, async () => {
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
    maxConcurrentJobs: 2, showWelcome: false
  })
  ensureVault()

  // 1. Create a paper-reading task with an arXiv link.
  const list = serviceCreateList(conn.db, 'Research')
  const paper = serviceCreateTask(conn.db, {
    listId: list.id,
    title: 'NFTrig: Using Blockchain Technologies for Math Education',
    type: 'paper_reading',
    link: 'https://arxiv.org/abs/2301.00001'
  })
  assert.equal(paper.type, 'paper_reading')

  // 2. New trigger model (spec analysis-lifecycle): the createTask IPC handler
  // enqueues analysis for paper tasks created with a link; the setMyDay
  // handler only enqueues suggestions on first add. Simulate both paths.
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('analysis', runAnalysisJob)
  q.register('suggestion', runSuggestionJob)
  q.register('ingest', runIngestJob)
  const analysisJob = q.enqueue('analysis', paper.id)
  serviceSetMyDay(conn.db, paper.id, true)
  q.enqueue('suggestion', paper.id)
  await waitForJob(conn.db, analysisJob.id, 'analysis')

  // 3. Analysis completed and persisted.
  const analyzed = getTask(conn.db, paper.id)!
  const analysis = getAnalysis(conn.db, paper.id)
  assert.ok(analysis, 'analysis persisted')
  assert.ok(analysis.tldr.length > 0)
  assert.ok(analysis.contributions.length >= 3)
  assert.equal(analyzed.analysisStatus, 'ready')

  // Suggestions produced.
  assert.ok(listSuggestions(conn.db, paper.id).length >= 2, '2-3 suggestion chips')

  // 4. Write reading notes (file-backed in vault).
  const notePath = path.join(dir, 'vault', 'notes', `${paper.id}.md`)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  writeNote(paper.id, '# Reading Notes\n\nKey insight: blockchain for math education.')
  saveNotes(conn.db, { taskId: paper.id, notePath, content: '# Reading Notes\n\nKey insight: blockchain for math education.' })
  const notes = getNotes(conn.db, paper.id)
  assert.ok(notes?.content.includes('Key insight'))

  // 5. Finish -> mark complete + hand off to ingestion (mirrors IPC finishTask).
  updateTask(conn.db, paper.id, { completed: true, completedAt: new Date().toISOString() })
  const ingestRec = q.enqueueIngest(paper.id, paper.title, [])
  await waitForIngest(conn.db, ingestRec.id)
  const ingest = listIngest(conn.db)
  assert.equal(ingest.length, 1)
  assert.equal(ingest[0]!.state, 'done')
  assert.ok(ingest[0]!.depositFiles.includes('reading-notes.md'))
  assert.ok(ingest[0]!.touchedFiles.some((f) => f.includes('sources')), 'source summary page reported as touched')

  // 6. Wiki contains source page, updated index, log entry.
  const sources = fs.readdirSync(path.join(wikiPath, 'wiki', 'sources'))
  assert.ok(sources.length >= 1, 'source summary page created')
  const index = fs.readFileSync(path.join(wikiPath, 'index.md'), 'utf-8')
  assert.ok(index.includes('sources') || sources.length > 0)
  const log = fs.readFileSync(path.join(wikiPath, 'log.md'), 'utf-8')
  assert.ok(log.includes('ingest'), 'log entry appended')

  // raw/ contains the deposited note.
  const rawNote = path.join(wikiPath, 'raw', paper.id, 'reading-notes.md')
  assert.ok(fs.existsSync(rawNote), 'raw deposit survived')

  // .history snapshot exists.
  const hist = fs.readdirSync(path.join(wikiPath, '.history'))
  assert.ok(hist.length >= 1, 'history snapshot present')

  // 7. Task is completed.
  const finished = getTask(conn.db, paper.id)!
  assert.equal(finished.completed, true)

  conn.close()
})
