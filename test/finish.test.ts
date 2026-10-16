import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  completeOnly,
  fileAsIs,
  polishThenFile,
  depositThenCurate,
  verifyPolish,
  PolishBoundExceeded,
  POLISH_INPUT_LIMIT,
  type FinishContext
} from '../src/core/domain/finish'
import { resolveArtifact } from '../src/core/domain/destination'
import { validateTypeDefinition } from '../src/core/domain/validation'
import { folderArtifactStore } from '../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../src/main/adapters/paths'
import { systemClock } from '../src/core/ports/clock'
import type { AgentRunRequest, AgentSessionPort } from '../src/core/ports/agent'
import type { Destination, Task, TaskTypeDef } from '../src/shared/types'

// The four finish behaviours (contracts/finish-behaviours.md), exercised
// directly against the strategies so each rule is pinned to the behaviour that
// owns it rather than to the orchestration around it.

// The user's draft (the working area's content). The old fixture was meeting
// minutes; the organize step is generic now (D2), so the draft is a document.
const MINUTES = `weekly sync draft

We reviewed the roadmap. Decision: we ship the beta in March.

Ana raised the onboarding drop-off.
`

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-finish-'))
}

/** A scripted session: no provider contact, and it records what it was asked. */
function scriptedSession(reply: string | (() => string), available = true): AgentSessionPort & { requests: AgentRunRequest[] } {
  const requests: AgentRunRequest[] = []
  return {
    requests,
    isAvailable: () => available,
    async run(req) {
      requests.push(req)
      const text = typeof reply === 'function' ? reply() : reply
      if (req.tools.length > 0 && text === '') return ''
      return text
    }
  }
}

function makeCtx(opts: {
  root: string
  subdir?: string
  behaviour: TaskTypeDef['finishBehaviour']
  content?: string
  session?: AgentSessionPort
  summary?: string
}): FinishContext {
  const dest: Destination = { store: 'folder', rootPath: opts.root, subdir: opts.subdir ?? '' }
  const task = {
    id: 'task-1',
    listId: 'l1',
    title: 'Weekly sync',
    notes: '',
    type: 'meeting',
    customTypeKey: null,
    inputs: {},
    preprocessStatus: 'none',
    preprocessError: null,
    alarmAt: null,
    completed: false,
    completedAt: null,
    inMyDay: true,
    myDayAddedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null
  } as Task
  const typeDef = {
    key: 'doc',
    family: 'document',
    label: 'Document',
    emoji: '📄',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: opts.behaviour,
    destination: dest
  } as TaskTypeDef
  return {
    task,
    typeDef,
    destination: resolveArtifact(nodePathPort, dest, task.title, task.id),
    workingContent: opts.content ?? MINUTES,
    declaredInputs: {},
    store: folderArtifactStore,
    session: opts.session ?? scriptedSession(''),
    clock: systemClock,
    signal: new AbortController().signal,
    summary: opts.summary
  }
}

const POLISH_OK = JSON.stringify({
  polished: 'Weekly sync\n\nWe reviewed the roadmap.\n\n**Decision:** we ship the beta in March.\n\nAna raised the onboarding drop-off.',
  preservedFacts: ['we ship the beta in March']
})

// ---- the four behaviours ----

test('complete-only writes nothing', async () => {
  const root = tmpdir()
  const result = await completeOnly(makeCtx({ root, behaviour: 'complete-only' }))
  assert.equal(result.artifactPath, null)
  assert.equal(result.assistantStep, 'skipped')
  assert.deepEqual(result.touchedFiles, [])
  assert.deepEqual(fs.readdirSync(root), [], 'no file was created')
})

test('file-as-is writes the user content unchanged', async () => {
  const root = tmpdir()
  const session = scriptedSession(() => {
    throw new Error('file-as-is must not call the assistant')
  })
  const result = await fileAsIs(makeCtx({ root, behaviour: 'file-as-is', session }))
  assert.equal(result.assistantStep, 'skipped')
  assert.equal(fs.readFileSync(result.artifactPath!, 'utf-8'), MINUTES)
  assert.equal(session.requests.length, 0)
})

test('polish-then-file runs the assistant and writes its result', async () => {
  const root = tmpdir()
  const session = scriptedSession(POLISH_OK)
  const result = await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session }))
  assert.equal(result.assistantStep, 'succeeded')
  const written = fs.readFileSync(result.artifactPath!, 'utf-8')
  assert.ok(written.includes('**Decision:**'), 'the assistant rewrite was filed')
  assert.equal(session.requests.length, 1)
  // The polishing session is confined: it gets no tools at all.
  assert.deepEqual(session.requests[0]!.tools, [])
  assert.equal(session.requests[0]!.purpose, 'confined')
})

test('deposit-then-curate deposits the raw material before authoring', async () => {
  const root = tmpdir()
  const session = scriptedSession('done')
  const ctx = makeCtx({ root, behaviour: 'deposit-then-curate', session, summary: '# summary' })
  const result = await depositThenCurate(ctx)
  assert.deepEqual(result.depositFiles?.sort(), ['ai-summary.md', 'weekly-sync.md'])
  const rawDir = path.join(root, 'raw', 'task-1')
  assert.equal(fs.readFileSync(path.join(rawDir, 'weekly-sync.md'), 'utf-8'), MINUTES)
  // The curating session is confined to the destination root with no shell.
  assert.equal(session.requests[0]!.purpose, 'confined')
  assert.deepEqual(session.requests[0]!.tools, ['read', 'write', 'edit', 'grep', 'find', 'ls'])
  assert.equal(session.requests[0]!.cwd, root)
})

test('a complete-only type declaring a destination is a validation error', async () => {
  const root = tmpdir()
  const def: TaskTypeDef = {
    key: 'plain_copy',
    family: null,
    label: 'Plain',
    emoji: '📝',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'complete-only',
    destination: { store: 'folder', rootPath: root, subdir: '' }
  }
  const result = validateTypeDefinition(def, { paths: nodePathPort, existing: null, mode: 'create' })
  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((e) => e.key === 'validation.completeOnlyNoDestination'),
    `got ${result.errors}`
  )
})

test('a writing behaviour without a destination is a validation error', () => {
  const def: TaskTypeDef = {
    key: 'essays',
    family: 'document',
    label: 'Essays',
    emoji: '📄',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file'
  }
  const result = validateTypeDefinition(def, { paths: nodePathPort, existing: null, mode: 'create' })
  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((e) => e.key === 'validation.needsDestination'),
    `got ${JSON.stringify(result.errors)}`
  )
})

// ---- the polish bound (FR-009, SC-011) ----

test('organize is caught when it injects a fact the user never recorded', async () => {
  const root = tmpdir()
  // The scripted assistant invents a commitment the draft does not contain.
  const session = scriptedSession(
    JSON.stringify({
      polished: 'We reviewed the roadmap and agreed to hire two engineers.',
      preservedFacts: ['approve the Q3 hiring budget']
    })
  )
  const result = await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session }))

  // The finish still completes — it never fails outright (FR-006) — but the
  // injected content is NOT what gets filed.
  assert.equal(result.assistantStep, 'failed')
  assert.ok(
    result.assistantError?.includes('introduced content the user did not record'),
    `expected a bound violation, got: ${result.assistantError}`
  )
  const written = fs.readFileSync(result.artifactPath!, 'utf-8')
  assert.equal(written, MINUTES, 'the user wrote it, so the user gets filed')
  assert.ok(!written.includes('hiring'), 'the invented commitment is nowhere in the artifact')
})

test('verifyPolish refuses an untraceable fact but accepts a faithful one', () => {
  const faithful = {
    polished: 'x',
    preservedFacts: ['we ship the beta in March', 'Ana raised the onboarding drop-off']
  }
  assert.doesNotThrow(() => verifyPolish(faithful, MINUTES))
  const injected = { polished: 'x', preservedFacts: ['Approve the Q3 hiring budget'] }
  assert.throws(() => verifyPolish(injected, MINUTES), PolishBoundExceeded)
})

test('the organize step is driven by the Type instruction, not a meeting template (D2)', async () => {
  const root = tmpdir()
  const session = scriptedSession(POLISH_OK)
  const ctx = makeCtx({ root, behaviour: 'polish-then-file', session })
  ctx.typeDef = { ...ctx.typeDef, aiGuidance: 'File my diary as date-prefixed notes; keep a feelings section.' }
  await polishThenFile(ctx)
  const req = session.requests[0]!
  // The declared instruction reaches the prompt...
  assert.ok(req.prompt.includes('File my diary as date-prefixed notes'), 'the Type instruction drives the step')
  assert.ok(req.prompt.includes('Type instruction:'), 'labelled as the instruction it is')
  // ...and no meeting framing survives anywhere in the session's texts.
  assert.ok(!req.systemPrompt.toLowerCase().includes('meeting'), 'the system prompt is the generic document editor')
  assert.ok(!req.prompt.includes('===MINUTES'), 'the old minutes delimiter is gone')
  assert.ok(req.prompt.includes('===DOCUMENT AS WRITTEN BY THE USER==='))
  // The organized output is filed as produced — no app-appended section.
  const written = fs.readFileSync(path.join(root, 'weekly-sync.md'), 'utf-8')
  assert.ok(!written.includes('## Action items'), 'the meeting-only append is deleted with the engine')
})

// ---- degradation (FR-025, FR-011) ----

test('with no provider configured, polish-then-file still completes and files the content', async () => {
  const root = tmpdir()
  const session = scriptedSession('', false) // isAvailable() === false
  const result = await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session }))
  assert.equal(result.assistantStep, 'failed')
  assert.ok(result.assistantError?.includes('no AI provider'))
  assert.ok(result.artifactPath, 'the minutes are retrievable rather than lost')
  assert.equal(fs.readFileSync(result.artifactPath!, 'utf-8'), MINUTES)
  assert.equal(session.requests.length, 0, 'no provider was contacted')
})

test('when the assistant step throws, the user content is still filed and the failure reported', async () => {
  const root = tmpdir()
  const session: AgentSessionPort = {
    isAvailable: () => true,
    async run() {
      throw new Error('provider overloaded')
    }
  }
  const result = await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session }))
  assert.equal(result.assistantStep, 'failed')
  assert.ok(result.assistantError?.includes('overloaded'))
  assert.equal(fs.readFileSync(result.artifactPath!, 'utf-8'), MINUTES)
})

test('the polish input is bounded so oversized minutes degrade predictably (T034)', async () => {
  const root = tmpdir()
  const huge = 'x'.repeat(POLISH_INPUT_LIMIT + 5000)
  const session = scriptedSession(POLISH_OK)
  await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session, content: huge }))
  const sent = session.requests[0]!.prompt
  assert.ok(sent.includes(`truncated at ${POLISH_INPUT_LIMIT}`), 'the truncation is visible to the model')
  assert.ok(sent.length < POLISH_INPUT_LIMIT + 10_000, `prompt was not bounded: ${sent.length}`)
})

// ---- collisions (FR-026, SC-008) ----

test('two finishes producing the same filename leave both files, the first unmodified', async () => {
  const root = tmpdir()
  const first = await fileAsIs(makeCtx({ root, behaviour: 'file-as-is', content: 'FIRST' }))
  const second = await fileAsIs(makeCtx({ root, behaviour: 'file-as-is', content: 'SECOND' }))

  assert.equal(path.basename(first.artifactPath!), 'weekly-sync.md')
  assert.equal(path.basename(second.artifactPath!), 'weekly-sync-2.md')
  assert.deepEqual(fs.readdirSync(root).sort(), ['weekly-sync-2.md', 'weekly-sync.md'])
  assert.equal(fs.readFileSync(first.artifactPath!, 'utf-8'), 'FIRST')
  assert.equal(fs.readFileSync(second.artifactPath!, 'utf-8'), 'SECOND')
})

test('a finish writes into a configured subdirectory without touching its parent', async () => {
  const root = tmpdir()
  const ctx = makeCtx({ root, subdir: 'minutes/2026', behaviour: 'file-as-is' })
  const result = await fileAsIs(ctx)
  assert.equal(path.dirname(result.artifactPath!), path.join(root, 'minutes', '2026'))
  assert.equal(result.touchedFiles[0], 'weekly-sync.md')
})

