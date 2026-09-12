import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKING_AREAS, emptyContentWarning, finishActionLabel, workingAreaFor } from '../src/core/domain/workingArea'
import { CATEGORIES, FINISH_BEHAVIOURS } from '../src/core/domain/categories'
import type { TaskTypeDef } from '../src/shared/types'

// The category → surface mapping and the Finish affordance wording.
//
// `finishActionLabel` and `emptyContentWarning` were entirely untested, and
// `workingAreaFor` only exercised indirectly — so a wrong branch would have
// surfaced as a UI oddity rather than a failure. Constitution IV.

const defWith = (finishBehaviour: TaskTypeDef['finishBehaviour']): TaskTypeDef => ({
  key: 'x',
  kind: 'meeting',
  label: 'X',
  emoji: '🗓',
  inputSchema: [],
  isBuiltin: false,
  finishBehaviour,
  grants: { skills: [], toolServers: [] }
})

test('every category maps to a declared working area', () => {
  for (const category of CATEGORIES) {
    const area = workingAreaFor(category)
    assert.ok(WORKING_AREAS.includes(area), `${category} -> ${area} is not a declared working area`)
  }
})

test('the category → surface mapping is the one the feature specifies', () => {
  assert.equal(workingAreaFor('plain'), 'notes')
  assert.equal(workingAreaFor('learning'), 'markdown')
  assert.equal(workingAreaFor('jira'), 'source-panel')
  // The Meeting type reuses the existing markdown editor; per-type working-area
  // declaration is out of scope, so the category still selects the surface.
  assert.equal(workingAreaFor('meeting'), 'markdown')
})

test('the Finish label describes the declared behaviour, for every behaviour', () => {
  const labels = FINISH_BEHAVIOURS.map((b) => finishActionLabel(defWith(b)))
  for (const label of labels) assert.ok(label.trim().length > 0, 'every behaviour needs a label')
  // The label must be true of the behaviour: "ingest to wiki" is only correct
  // for one of the four, and saying it for a meeting would be a lie.
  assert.match(finishActionLabel(defWith('deposit-then-curate')), /wiki/)
  assert.match(finishActionLabel(defWith('polish-then-file')), /polish/)
  assert.match(finishActionLabel(defWith('file-as-is')), /as written/)
  assert.equal(finishActionLabel(defWith('complete-only')), 'Finish')
  // Labels are distinct, so the button cannot silently mean two things.
  assert.equal(new Set(labels).size, labels.length)
})

test('a type that declares nothing gets the neutral label', () => {
  assert.equal(finishActionLabel(null), 'Finish')
  assert.equal(finishActionLabel(undefined), 'Finish')
})

test('the empty-content warning is offered only where finishing would write something', () => {
  // No warning for behaviours that write nothing: finishing an empty plain task
  // is exactly what it is for.
  assert.equal(emptyContentWarning(defWith('complete-only')), null)
  assert.equal(emptyContentWarning(null), null)
  // A writing behaviour warns, and says what the consequence is.
  assert.match(emptyContentWarning(defWith('deposit-then-curate'))!, /wiki/)
  assert.match(emptyContentWarning(defWith('polish-then-file'))!, /empty/)
  assert.match(emptyContentWarning(defWith('file-as-is'))!, /empty/)
})

test('an undeclared behaviour falls back to the category it came from', () => {
  // A type with no behaviour declared resolves through the category's history,
  // so the label is that behaviour's label rather than the neutral one.
  const legacyLearning: TaskTypeDef = { ...defWith(undefined as never), kind: 'learning', finishBehaviour: undefined as never }
  assert.match(finishActionLabel(legacyLearning), /wiki/)
})
