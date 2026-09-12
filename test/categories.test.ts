import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIES,
  DESTINATION_STORES,
  FINISH_BEHAVIOURS,
  isCategory,
  isDestinationStore,
  isFinishBehaviour,
  writesArtifact
} from '../src/core/domain/categories'
import { isConfigured } from '../src/core/domain/config'

// The guards over the two declared vocabularies, plus the configuration
// predicate.
//
// WHY THESE GUARDS ARE WORTH TESTING: a guard that wrongly returns `true` is
// silent. `isCategory('webinar')` returning true would let an unrecognised
// category through type validation and into the database's CHECK — or, worse,
// through to a dispatch that has no branch for it. The failure would appear
// far from the cause.
//
// WHY `config.ts` HAS NO FILE OF ITS OWN: `isConfigured` is a single total
// predicate over three fields, and it is asserted by every test that gates on
// configuration (test/taskService.test.ts asserts both the configured and the
// unconfigured path of My Day). A dedicated file would restate that. It is
// covered here, next to the other predicate, so the coverage is explicit
// rather than incidental.

test('isCategory accepts exactly the declared categories', () => {
  for (const c of CATEGORIES) assert.equal(isCategory(c), true, c)
  for (const bad of ['', 'plain ', 'Plain', 'webinar', 'paper_reading', null, undefined, 42, {}, ['plain']]) {
    assert.equal(isCategory(bad), false, `${JSON.stringify(bad)} must be rejected`)
  }
})

test('isFinishBehaviour accepts exactly the declared four', () => {
  for (const b of FINISH_BEHAVIOURS) assert.equal(isFinishBehaviour(b), true, b)
  // A near-miss spelling must not be accepted: the contract requires an
  // unrecognised behaviour be refused rather than defaulted.
  for (const bad of ['polish', 'complete_only', 'Complete-Only', 'file as is', '', null, undefined, 0]) {
    assert.equal(isFinishBehaviour(bad), false, `${JSON.stringify(bad)} must be rejected`)
  }
})

test('isDestinationStore accepts exactly the declared stores', () => {
  for (const s of DESTINATION_STORES) assert.equal(isDestinationStore(s), true, s)
  for (const bad of ['cloud', 'Wiki', '', null, undefined]) {
    assert.equal(isDestinationStore(bad), false, `${JSON.stringify(bad)} must be rejected`)
  }
})

test('writesArtifact is complete-only being special and nothing else', () => {
  // Derived, not restated: if a fifth behaviour is ever added it is classified
  // by this predicate without anyone remembering to update a second list.
  for (const b of FINISH_BEHAVIOURS) {
    assert.equal(writesArtifact(b), b !== 'complete-only', b)
  }
  assert.equal(writesArtifact('complete-only'), false)
  assert.equal(writesArtifact('file-as-is'), true)
  assert.equal(writesArtifact('polish-then-file'), true)
  assert.equal(writesArtifact('deposit-then-curate'), true)
})

test('isConfigured requires all three of provider, model and key', () => {
  const full = { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-x' }
  assert.equal(isConfigured(full), true)
  // Each field alone is insufficient — a missing model or key must not read as
  // configured, or a job would be enqueued that cannot run.
  assert.equal(isConfigured({ ...full, provider: '' }), false)
  assert.equal(isConfigured({ ...full, model: '' }), false)
  assert.equal(isConfigured({ ...full, apiKey: null }), false)
  assert.equal(isConfigured({ provider: '', model: '', apiKey: null }), false)
})
