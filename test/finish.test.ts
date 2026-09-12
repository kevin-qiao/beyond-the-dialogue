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
  parsePolishOutput,
  renderPolished,
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

const MINUTES = `Attendees: Ana, Ben

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
    key: 'meeting',
    kind: 'meeting',
    label: 'Meeting',
    emoji: '🗓',
    inputSchema: [],
    isBuiltin: true,
    finishBehaviour: opts.behaviour,
    destination: dest,
    grants: { skills: [], toolServers: [] }
  } as TaskTypeDef
  return {
    task,
    typeDef,
    destination: resolveArtifact(nodePathPort, dest, opts.root, task.title, task.id),
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
  polished: 'Attendees: Ana, Ben\n\nWe reviewed the roadmap.\n\n**Decision:** we ship the beta in March.\n\nAna raised the onboarding drop-off.',
  actionItems: [],
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
    kind: 'plain',
    label: 'Plain',
    emoji: '📝',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'complete-only',
    destination: { store: 'folder', rootPath: root, subdir: '' },
    grants: { skills: [], toolServers: [] }
  }
  const result = validateTypeDefinition(def, { paths: nodePathPort, existing: null, mode: 'create' })
  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((e) => e.includes('complete-only type must not declare a destination')),
    `got ${result.errors}`
  )
})

test('a writing behaviour without a destination is a validation error', () => {
  const def: TaskTypeDef = {
    key: 'meetings',
    kind: 'meeting',
    label: 'Meetings',
    emoji: '🗓',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    grants: { skills: [], toolServers: [] }
  }
  const result = validateTypeDefinition(def, { paths: nodePathPort, existing: null, mode: 'create' })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('must declare a destination')), `got ${result.errors}`)
})

// ---- the polish bound (FR-009, SC-011) ----

test('polish is caught when it injects a decision the user never recorded', async () => {
  const root = tmpdir()
  // The scripted assistant invents a commitment the minutes do not contain.
  const session = scriptedSession(
    JSON.stringify({
      polished: 'Attendees: Ana, Ben\n\nWe reviewed the roadmap and agreed to hire two engineers.',
      actionItems: ['Approve the Q3 hiring budget'],
      preservedFacts: ['we ship the beta in March']
    })
  )
  const result = await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session }))

  // The finish still completes — it never fails outright (FR-025) — but the
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

test('verifyPolish refuses an untraceable action item but accepts a faithful one', () => {
  const faithful = {
    polished: 'x',
    actionItems: ['Ana raised the onboarding drop-off'],
    preservedFacts: ['we ship the beta in March']
  }
  assert.doesNotThrow(() => verifyPolish(faithful, MINUTES))
  const injected = { polished: 'x', actionItems: ['Approve the Q3 hiring budget'], preservedFacts: [] }
  assert.throws(() => verifyPolish(injected, MINUTES), PolishBoundExceeded)
})

test('recorded action items appear as a distinct section of the finished document', async () => {
  const root = tmpdir()
  const session = scriptedSession(
    JSON.stringify({
      polished: 'Attendees: Ana, Ben\n\nWe reviewed the roadmap.',
      actionItems: ['Ana raised the onboarding drop-off'],
      preservedFacts: ['we ship the beta in March']
    })
  )
  const result = await polishThenFile(makeCtx({ root, behaviour: 'polish-then-file', session }))
  const written = fs.readFileSync(result.artifactPath!, 'utf-8')
  assert.ok(/^## Action items$/m.test(written), `expected a distinct section, got:\n${written}`)
  assert.ok(written.includes('- Ana raised the onboarding drop-off'))
  // The section is structural: it is appended by the app, so it cannot be
  // forgotten by the model or merged into the prose.
  assert.equal(renderPolished(parsePolishOutput(JSON.stringify({ polished: 'body', actionItems: ['Ana raised the onboarding drop-off'], preservedFacts: [] }))).includes('## Action items'), true)
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

