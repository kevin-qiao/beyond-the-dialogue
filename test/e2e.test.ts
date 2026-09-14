import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, loadSettings, getTask, getPreprocess, getNotes, listIngest, listSuggestions, getJob, saveNotes, updateTask, type DB } from '../src/main/db'
import { JobQueue } from '../src/main/job-queue'
import { runPreprocessJob } from '../src/main/preprocess'
import { runSuggestionJob } from '../src/main/suggestions'
import { runIngestJob } from '../src/main/wiki/ingest'
import { setSessionFactory, setSimplePromptOverride, type CreateJobSessionOptions } from '../src/main/ai/session-factory'
import { setUserDataRoot } from '../src/main/paths'
import { ensureVault, writeNote, notePathFor } from '../src/main/wiki/vault'
import { serviceCreateList, serviceCreateTask, serviceSetMyDay } from '../src/main/tasks'
import { effectiveKind, effectiveTypeDef, getTypeDef, updateTypeDef } from '../src/main/types'
import { ensureDestination, folderArtifactStore } from '../src/main/adapters/artifacts/folderStore'
import { createSqliteStorage } from '../src/main/adapters/sqlite/storageAdapter'
import { createAgentSessionAdapter } from '../src/main/adapters/agent/sessionAdapter'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import { finishTask, type FinishDeps } from '../src/core/services/finishService'
import { declaredWorkflow } from '../src/core/domain/taskType'
import { workingAreaFor } from '../src/core/domain/workingArea'
import { PREPROCESS_INSTRUCTIONS, hasPreprocess, preprocessInstruction } from '../src/core/domain/preprocess'

const SCRIPTED_PREPROCESS = JSON.stringify({
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

// Finish a task through the real service with the real folder store, retargeting
// the built-in Meeting type at this test's folder first (FR-004). The folder is
// created the way the app creates a declared destination, not by the finish.
async function finishMeeting(conn: DB, minutesDir: string, taskId: string) {
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'meeting')!,
    destination: { store: 'folder', rootPath: minutesDir, subdir: '' }
  })
  const deps: FinishDeps = {
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: () => folderArtifactStore,
    session: createAgentSessionAdapter(() => loadSettings(conn.db)),
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    wikiRoot: () => loadSettings(conn.db).wikiPath,
    enqueueCurate: () => {}
  }
  return finishTask(deps, taskId)
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

// ---- US1: the Meeting journey end to end (quickstart S1) ----

const MEETING_PREPROCESS = JSON.stringify({
  summary:
    '## Suggested agenda\n1. Roadmap review (10 min)\n2. Beta launch date (15 min)\n\n## Core topics\n- Whether the March beta date still holds\n- The onboarding drop-off Ana raised',
  analysis: 'The user wants to walk into the weekly sync with a settled beta date.',
  suggestions: ['Confirm the March date with Ana', 'Bring the onboarding numbers']
})

const POLISHED_MINUTES = JSON.stringify({
  polished:
    'Date: 12 March\n\n**Decision:** we ship the beta in March.\n\nThe roadmap was reviewed and the onboarding drop-off was raised by Ana.',
  actionItems: ['Ana raised the onboarding drop-off'],
  preservedFacts: ['we ship the beta in March']
})

test('8.1c meeting journey: agenda -> minutes -> polished file in a configured folder', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-meeting-'))
  setUserDataRoot(dir)
  const minutesDir = path.join(dir, 'meeting-minutes')
  ensureDestination(minutesDir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-scripted',
    wikiPath: path.join(dir, 'wiki-space'),
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: []
  })
  ensureVault()

  // The pre-process call returns an agenda; the finish call returns polished
  // minutes. One scripted factory serves both, distinguished by the system
  // prompt each path uses.
  // The discriminator is the prompt, not the system prompt: both calls go
  // through the same session factory and the category wording lives in the
  // per-category instruction the registry builds.
  setSessionFactory(async (_opts: CreateJobSessionOptions) => {
    const messages: any[] = []
    return {
      subscribe: () => () => {},
      messages,
      async prompt(text: string) {
        const reply = /meeting preparation assistant/i.test(text) ? MEETING_PREPROCESS : POLISHED_MINUTES
        messages.push({ role: 'assistant', content: [{ type: 'text', text: reply }] })
      },
      async abort() {}
    }
  })

  // Step 1 — create a Meeting task with its required input.
  const list = serviceCreateList(conn.db, 'Work')
  const task = serviceCreateTask(conn.db, {
    listId: list.id,
    title: 'Weekly sync: beta launch',
    type: 'meeting',
    inputs: { target: 'Settle the beta launch date and the onboarding drop-off' }
  })
  assert.equal(task.type, 'meeting')
  assert.equal(effectiveKind(conn.db, task), 'meeting', 'the category is meeting, not plain')

  // Step 2 — first add to My Day fires the MEETING pre-process, not the
  // plain-task suggestion path.
  const q = new JobQueue(conn.db, 2, { baseRetryMs: 5 })
  q.register('preprocess', runPreprocessJob)
  q.register('suggestion', runSuggestionJob)
  serviceSetMyDay(conn.db, task.id, true)
  const preJob = q.enqueue('preprocess', task.id)
  await waitForJob(conn.db, preJob.id, 'preprocess')

  // Step 3 — an agenda and core topics are presented.
  const pp = getPreprocess(conn.db, task.id)!
  assert.equal(pp.kind, 'meeting')
  assert.ok(pp.summary.includes('## Suggested agenda'), `expected an agenda, got: ${pp.summary}`)
  assert.ok(pp.summary.includes('## Core topics'), 'expected core topics')
  assert.ok(listSuggestions(conn.db, task.id).length >= 2, 'agenda activities as chips')

  // Step 4 — write the minutes through the working area's save path. The
  // editor autosaves on change (debounced, flushed on blur/unmount) and has no
  // save button, so one save is the whole of the user's action: there is no
  // explicit save step for the test to perform on top of it.
  const minutes = 'Date: 12 March\n\nDecision: we ship the beta in March.\n\nAna raised the onboarding drop-off.'
  writeNote(task.id, minutes)
  saveNotes(conn.db, { taskId: task.id, notePath: notePathFor(task.id), content: minutes })
  assert.equal(getNotes(conn.db, task.id)!.content, minutes, 'minutes persist without an explicit save action')
  assert.equal(fs.readFileSync(notePathFor(task.id), 'utf-8'), minutes, 'and are on disk in the vault')

  // Step 5 — Finish writes to the configured folder and completes the task.
  const outcome = await finishMeeting(conn, minutesDir, task.id)
  assert.equal(outcome.behaviour, 'polish-then-file')
  assert.equal(getTask(conn.db, task.id)!.completed, true)

  // Step 6 — the file is plain markdown in the configured folder.
  const files = fs.readdirSync(minutesDir)
  assert.deepEqual(files, ['weekly-sync-beta-launch.md'])
  const written = fs.readFileSync(path.join(minutesDir, files[0]!), 'utf-8')
  assert.ok(written.includes('**Decision:** we ship the beta in March'), 'the polished minutes were filed')
  assert.ok(/^## Action items$/m.test(written), 'the recorded action items are a distinct section')
  assert.ok(written.includes('- Ana raised the onboarding drop-off'))
  // Readable with no workspace, schema, or index alongside it.
  assert.ok(!fs.existsSync(path.join(minutesDir, 'index.md')))
  assert.ok(!fs.existsSync(path.join(minutesDir, 'CLAUDE.md')))
  assert.ok(!fs.existsSync(path.join(minutesDir, '.history')))
  conn.close()
})

test('8.1d a polished finish never files a fact the user did not record (FR-009, SC-011)', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-meeting-inject-'))
  setUserDataRoot(dir)
  const minutesDir = path.join(dir, 'meeting-minutes')
  ensureDestination(minutesDir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-scripted',
    wikiPath: path.join(dir, 'wiki-space'),
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: []
  })
  ensureVault()

  // The assistant tries to slip in a decision the user never recorded.
  setSessionFactory(async () => ({
    subscribe: () => () => {},
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              polished: 'The team agreed to hire two engineers.',
              actionItems: ['Approve the Q3 hiring budget'],
              preservedFacts: ['we ship the beta in March']
            })
          }
        ]
      }
    ],
    async prompt() {},
    async abort() {}
  }))

  const list = serviceCreateList(conn.db, 'Work')
  const task = serviceCreateTask(conn.db, { listId: list.id, title: 'Weekly sync', type: 'meeting', inputs: { target: 'Beta date' } })
  const minutes = 'Decision: we ship the beta in March.'
  writeNote(task.id, minutes)
  saveNotes(conn.db, { taskId: task.id, notePath: notePathFor(task.id), content: minutes })

  const outcome = await finishMeeting(conn, minutesDir, task.id)

  // The finish completes — it never fails outright — but the injection was
  // caught and the user's own words are what got filed.
  assert.equal(outcome.result?.assistantStep, 'failed')
  assert.ok(outcome.result?.assistantError?.includes('introduced content the user did not record'))
  const written = fs.readFileSync(path.join(minutesDir, 'weekly-sync.md'), 'utf-8')
  assert.equal(written, minutes)
  assert.ok(!written.includes('hire'), 'the invented decision is nowhere in the artifact')
  conn.close()
})

// ---- S7: an unrecognised category fails loudly ----

test('8.1e a meeting task routes to the meeting surface and meeting pre-process, never plain', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-route-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  const list = serviceCreateList(conn.db, 'Work')
  const task = serviceCreateTask(conn.db, { listId: list.id, title: 'Retro', type: 'meeting', inputs: { target: 'x' } })

  // The category resolver is the hazard: it falls back to `plain`, so a missing
  // branch degrades into a plausible-looking task that quietly does the wrong
  // thing. These assertions are what make that visible.
  assert.equal(effectiveKind(conn.db, task), 'meeting')
  assert.equal(workingAreaFor(effectiveKind(conn.db, task)), 'markdown')

  // The pre-process registry has a meeting instruction; it is NOT the jira one.
  assert.equal(hasPreprocess('meeting'), true)
  assert.equal(preprocessInstruction('meeting'), PREPROCESS_INSTRUCTIONS.meeting)
  assert.notEqual(preprocessInstruction('meeting'), PREPROCESS_INSTRUCTIONS.jira)
  assert.ok(preprocessInstruction('meeting')!.step.includes('agenda'))

  // plain genuinely has none — the fallback would be indistinguishable from a
  // correct answer if the registry ever lost its meeting entry.
  assert.equal(hasPreprocess('plain'), false)
  assert.equal(preprocessInstruction('plain'), null)

  // And the declared behaviour is the Meeting one, not complete-only.
  const def = effectiveTypeDef(conn.db, task)!
  assert.equal(declaredWorkflow(def).finishBehaviour, 'polish-then-file')
  conn.close()
})
