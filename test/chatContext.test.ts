import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_CONTEXT_INSTRUCTIONS, CHAT_GROUNDING_CASES, buildChatContext, chatCaseFor } from '../src/core/domain/chatContext'
import { FAMILIES } from '../src/core/domain/family'
import type { TaskTypeDef } from '../src/shared/types'

// Task-grounded conversation: what a session is told about its task.
//
// The hazard this file exists for: the builder used to be per-category
// ternaries, so adding the `meeting` category gave its chat *less* grounding
// with nothing failing or warning. Feature 002 attaches a conversation to
// EVERY task (FR-008) and re-keys the grounding onto declarations (research
// D10), with exactly two first-class cases: document-family and family-less.
// A case the registry does not cover must be a test failure, not a quiet
// degradation — quickstart drill #2.

const docType = (over: Partial<TaskTypeDef> = {}): TaskTypeDef => ({
  key: 'doc',
  family: 'document',
  label: 'Doc',
  emoji: '📄',
  inputSchema: [],
  isBuiltin: false,
  finishBehaviour: 'polish-then-file',
  ...over
})

// ---- the totality rule ----

test('every declared grounding case has a context instruction', () => {
  for (const kase of CHAT_GROUNDING_CASES) {
    assert.ok(CHAT_CONTEXT_INSTRUCTIONS[kase], `case "${kase}" has no chat-context instruction`)
  }
})

test('every family value maps to a covered case — nothing falls out of the registry', () => {
  // Total over the declared families AND the family-less case: a family this
  // feature has not lit up yet gets the family-less treatment rather than
  // undefined grounding.
  for (const family of [...FAMILIES, null, undefined]) {
    const kase = chatCaseFor(family)
    assert.ok(
      CHAT_GROUNDING_CASES.includes(kase),
      `family "${family}" maps to "${kase}", which is not a declared case`
    )
    assert.ok(CHAT_CONTEXT_INSTRUCTIONS[kase], `family "${family}" maps to a case with no instruction`)
  }
  assert.equal(chatCaseFor('document'), 'document')
  assert.equal(chatCaseFor(null), 'family-less')
  assert.equal(chatCaseFor('working-system'), 'family-less', 'a not-yet-live family gets the family-less treatment')
  assert.equal(chatCaseFor('coding'), 'family-less')
})

test('the family-less case is first-class: a plain task gets real grounding', () => {
  // FR-008/US2-AC5: chat attaches to every task. The old registry ABSENTED
  // plain (no chat existed for it); the new one must ground it, not skip it.
  const ctx = buildChatContext(docType({ family: null, key: 'plain' }), {
    task: { title: 'Buy milk', background: 'fridge is empty', target: 'milk in the fridge', notes: '2L whole', inputs: {} },
    typeDef: docType({ family: null, key: 'plain' }),
    workingContent: null
  })
  assert.ok(ctx.includes('Task: Buy milk'))
  assert.ok(ctx.includes('Background: fridge is empty'))
  assert.ok(ctx.includes('Target: milk in the fridge'))
  assert.ok(ctx.includes('Description: 2L whole'))
})

// ---- the document case: the draft is the working area ----

test("a document task's context carries its draft as the working area", () => {
  const def = docType({ inputSchema: [{ key: 'target', label: 'Target', type: 'text' }] })
  const ctx = buildChatContext(def, {
    task: {
      title: 'Weekly blog',
      background: '',
      target: 'Publish by Friday',
      notes: '',
      inputs: { target: 'Publish by Friday', undeclared: 'must not leak' }
    },
    typeDef: def,
    workingContent: '## Draft\nThe argument so far…'
  })
  assert.ok(ctx.includes('Task: Weekly blog'))
  assert.ok(ctx.includes('Target: Publish by Friday'), `declared input missing:\n${ctx}`)
  assert.ok(ctx.includes('Working-area draft:\n## Draft'), `draft missing:\n${ctx}`)
  // FR-011 at the grounding level: an input the Type does not declare is not
  // part of the declared material.
  assert.ok(!ctx.includes('must not leak'), `undeclared input leaked into the grounding:\n${ctx}`)
})

test('a task with nothing written still gets a usable context', () => {
  const ctx = buildChatContext(docType(), {
    task: { title: 'Bare', background: '', target: '', notes: '', inputs: {} },
    typeDef: docType(),
    workingContent: null
  })
  assert.equal(ctx, 'Task: Bare')
})

test('the working content is bounded', () => {
  const huge = 'x'.repeat(80_000)
  const ctx = buildChatContext(docType(), {
    task: { title: 'T', background: '', target: '', notes: '', inputs: {} },
    typeDef: docType(),
    workingContent: huge
  })
  assert.ok(ctx.length < 70_000, `draft was not bounded: ${ctx.length}`)
})

test('a whitespace-only field does not produce an empty labelled line', () => {
  const ctx = buildChatContext(docType(), {
    task: { title: 'T', background: '   ', target: '', notes: '  ', inputs: {} },
    typeDef: docType(),
    workingContent: '   '
  })
  assert.equal(ctx, 'Task: T')
})

test('a missing type definition still grounds in the task itself', () => {
  // The registry case is chosen by family; no def at all is the family-less
  // case, and the block is built from what the task holds.
  const ctx = buildChatContext(null, {
    task: { title: 'Orphan', background: 'b', target: '', notes: '', inputs: { anything: 'value' } },
    typeDef: null,
    workingContent: 'note text'
  })
  assert.ok(ctx.includes('Task: Orphan'))
  assert.ok(ctx.includes('Background: b'))
  assert.ok(ctx.includes('Notes:\nnote text'))
})
