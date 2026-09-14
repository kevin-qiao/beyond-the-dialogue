import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_CONTEXT_INSTRUCTIONS, buildChatContext } from '../src/core/domain/chatContext'
import { CATEGORIES } from '../src/core/domain/categories'
import { PREPROCESS_INSTRUCTIONS } from '../src/core/domain/preprocess'
import type { TaskPreprocess } from '../src/shared/types'

// Task-grounded chat: what a session is told about its task.
//
// The hazard this file exists for: the builder used to be a chain of
// `kind === 'learning'` / `kind === 'jira'` ternaries in the transport, so
// adding the `meeting` category gave its chat *less* grounding — no objective,
// no focus prompt — with nothing failing or warning. A missing branch must now
// be a test failure.

const preprocess = (over: Partial<TaskPreprocess> = {}): TaskPreprocess => ({
  taskId: 't1',
  kind: 'meeting',
  summary: '## Suggested agenda\n1. Roadmap',
  analysis: '',
  suggestions: [],
  status: 'ready',
  inputsHash: 'h',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
})

// ---- the totality rule ----

test('every category that can be chatted with has a context instruction', () => {
  // If a category gains a chat panel without gaining grounding, its sessions
  // answer from a thinner picture than they should — silently. This is the
  // assertion that turns that into a failure.
  for (const category of CATEGORIES) {
    if (category === 'plain') continue
    assert.ok(
      CHAT_CONTEXT_INSTRUCTIONS[category],
      `category "${category}" is not plain but has no chat-context instruction`
    )
  }
})

test('the registry covers exactly the categories that have a pre-process', () => {
  // Not a coincidence: a category worth pre-processing is a category worth
  // grounding. Keeping the two sets equal is what stops one drifting — and the
  // comparison is against the OTHER registry, not against a constant derived
  // from the same category list, so it can actually catch a divergence.
  const withPreprocess = Object.keys(PREPROCESS_INSTRUCTIONS).sort()
  const withChatContext = Object.keys(CHAT_CONTEXT_INSTRUCTIONS).sort()
  assert.deepEqual(withChatContext, withPreprocess)
  assert.deepEqual(withPreprocess, ['jira', 'learning', 'meeting'])
})

test('plain has no chat grounding at all', () => {
  assert.equal(CHAT_CONTEXT_INSTRUCTIONS.plain, undefined)
  assert.equal(buildChatContext('plain', { task: { title: 'T', notes: '', inputs: {} }, preprocess: null, workingContent: null }), undefined)
})

// ---- the regression: a meeting's chat must know what the meeting is for ----

test("a meeting task's context carries its own objective and focus prompt", () => {
  const ctx = buildChatContext('meeting', {
    task: {
      title: 'Weekly sync',
      notes: 'Bring the numbers',
      inputs: { target: 'Settle the beta date', purpose: 'Focus on the onboarding drop-off' }
    },
    preprocess: preprocess(),
    workingContent: 'Ana raised the drop-off.'
  })!

  assert.ok(ctx.includes('Task: Weekly sync'))
  assert.ok(ctx.includes('Description: Bring the numbers'))
  assert.ok(ctx.includes('Objective: Settle the beta date'), `objective missing:\n${ctx}`)
  assert.ok(ctx.includes('Prompt: Focus on the onboarding drop-off'), `focus prompt missing:\n${ctx}`)
  assert.ok(ctx.includes('## Suggested agenda'), 'the proposed agenda grounds the chat too')
  assert.ok(ctx.includes('Ana raised the drop-off'), 'minutes written so far are in context')
})

test('the learning and jira groundings are unchanged by the registry move', () => {
  const learningCtx = buildChatContext('learning', {
    task: { title: 'NFTrig', notes: '', inputs: { target: 'blockchain in education', purpose: 'write it up' } },
    preprocess: preprocess({ summary: 'A summary' }),
    workingContent: 'Key insight: ...'
  })!
  assert.equal(
    learningCtx,
    [
      'Task: NFTrig',
      'Pre-process summary: A summary',
      'Target: blockchain in education',
      'Prompt: write it up',
      'Current learning note:\nKey insight: ...'
    ].join('\n')
  )

  const jiraCtx = buildChatContext('jira', {
    task: { title: 'AUTH-42', notes: '', inputs: { sourceKind: 'issue', sourceText: 'pasted body' } },
    preprocess: preprocess({ summary: 'Status: To Do' }),
    workingContent: null
  })!
  assert.ok(jiraCtx.includes('Source kind: JIRA issue'))
  assert.ok(jiraCtx.includes('Pasted source content:\npasted body'))
  // A page reads as a page, not as an issue.
  const pageCtx = buildChatContext('jira', {
    task: { title: 'Docs', notes: '', inputs: { sourceKind: 'page', sourceText: 'body' } },
    preprocess: null,
    workingContent: null
  })!
  assert.ok(pageCtx.includes('Confluence page'))
})

test('a task with nothing written and no pre-process still gets a usable context', () => {
  const ctx = buildChatContext('meeting', {
    task: { title: 'Bare', notes: '', inputs: {} },
    preprocess: null,
    workingContent: null
  })!
  assert.equal(ctx, 'Task: Bare')
})

test('the source content and the working content are both bounded', () => {
  const huge = 'x'.repeat(80_000)
  const jira = buildChatContext('jira', {
    task: { title: 'T', notes: '', inputs: { sourceKind: 'issue', sourceText: huge } },
    preprocess: null,
    workingContent: null
  })!
  assert.ok(jira.length < 70_000, `pasted source was not bounded: ${jira.length}`)

  const meetingCtx = buildChatContext('meeting', {
    task: { title: 'T', notes: '', inputs: {} },
    preprocess: null,
    workingContent: huge
  })!
  assert.ok(meetingCtx.length < 70_000, `minutes were not bounded: ${meetingCtx.length}`)
})

test('a whitespace-only input does not produce an empty labelled line', () => {
  const ctx = buildChatContext('meeting', {
    task: { title: 'T', notes: '', inputs: { target: '   ', purpose: '' } },
    preprocess: null,
    workingContent: '   '
  })!
  assert.equal(ctx, 'Task: T')
})

test('every pre-process output reaches the chat, not only the summary', () => {
  // The card shows all three and the deposit archives all three, so the one
  // surface that can act on them must not be the one that sees one.
  const ctx = buildChatContext('learning', {
    task: { title: 'Rust ownership', notes: '', inputs: {} },
    preprocess: preprocess({
      summary: 'Borrowing basics',
      analysis: 'They want to hold references across structs.',
      suggestions: ['Work through 2x2 examples first', 'Connect to the SVD notes']
    }),
    workingContent: null
  })!
  assert.ok(ctx.includes('Pre-process summary: Borrowing basics'))
  assert.ok(ctx.includes('Pre-process analysis: They want to hold references across structs.'))
  assert.ok(
    ctx.includes('Pre-process suggestions:\n- Work through 2x2 examples first\n- Connect to the SVD notes')
  )
})

test('an empty pre-process field adds no line at all', () => {
  const ctx = buildChatContext('learning', {
    task: { title: 'T', notes: '', inputs: {} },
    preprocess: preprocess({ summary: 'S', analysis: '', suggestions: [] }),
    workingContent: null
  })!
  assert.equal(ctx, ['Task: T', 'Pre-process summary: S'].join('\n'))
})
