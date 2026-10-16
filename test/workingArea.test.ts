import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKING_AREAS, finishActionLabel, workingAreaFor } from '../src/core/domain/workingArea'
import { FAMILIES } from '../src/core/domain/family'
import { FINISH_BEHAVIOURS } from '../src/core/domain/finish'
import type { TaskTypeDef } from '../src/shared/types'

// The family → surface mapping and the Finish affordance wording.
//
// Feature 002 re-keyed the surface onto the Family (research D1/D3): a
// document-family Type's note IS the working area — the draft — while every
// other Type keeps the ordinary notes field. The source-panel surface died
// with the Jira engine (FR-016).

const defWith = (finishBehaviour: TaskTypeDef['finishBehaviour']): TaskTypeDef => ({
  key: 'x',
  family: 'document',
  label: 'X',
  emoji: '📄',
  inputSchema: [],
  isBuiltin: false,
  finishBehaviour
})

test('every family value maps to a declared working area', () => {
  for (const family of [...FAMILIES, null, undefined]) {
    const area = workingAreaFor(family)
    assert.ok(WORKING_AREAS.includes(area), `${family} -> ${area} is not a declared working area`)
  }
})

test('the family → surface mapping is the one the feature specifies', () => {
  // The document family is the writing surface (D3): the task's note is the
  // draft the finish loop reads.
  assert.equal(workingAreaFor('document'), 'markdown')
  // A family-less Type keeps the ordinary notes field.
  assert.equal(workingAreaFor(null), 'notes')
  assert.equal(workingAreaFor(undefined), 'notes')
  // The not-yet-live families get the family-less treatment until their own
  // features land (T033's honest affordance) — never a surface that pretends.
  assert.equal(workingAreaFor('working-system'), 'notes')
  assert.equal(workingAreaFor('coding'), 'notes')
})

test('the retired source-panel surface is gone', () => {
  assert.ok(!(WORKING_AREAS as readonly string[]).includes('source-panel'))
})

test('the Finish label describes the declared behaviour, for every behaviour', () => {
  const labels = FINISH_BEHAVIOURS.map((b) => finishActionLabel(defWith(b)))
  for (const label of labels) assert.ok(label.trim().length > 0, 'every behaviour needs a label')
  // The label must be true of the behaviour: "ingest to wiki" is only correct
  // for one of the four, and "organize" only for the organize step (D2's
  // re-argument — no meeting framing survives).
  assert.match(finishActionLabel(defWith('deposit-then-curate')), /wiki/)
  assert.match(finishActionLabel(defWith('polish-then-file')), /organize/)
  assert.match(finishActionLabel(defWith('file-as-is')), /as written/)
  assert.equal(finishActionLabel(defWith('complete-only')), 'Finish')
  // Labels are distinct, so the button cannot silently mean two things.
  assert.equal(new Set(labels).size, labels.length)
})

test('a type that declares nothing gets the neutral label', () => {
  assert.equal(finishActionLabel(null), 'Finish')
  assert.equal(finishActionLabel(undefined), 'Finish')
})

// The empty-content warning is gone: a blank working area is the core's
// refusal (document.empty, US1-AC6), pinned by test/organize.test.ts — not a
// renderer-side confirm dialog.

test('an undeclared behaviour gets the neutral label — no history to fall back to', () => {
  // Feature 002 deleted the legacy-workflow fallback with the categories
  // (research D1): a behaviour is declared or the finish path refuses with a
  // code — nothing is inferred, so the label is the neutral one.
  const undeclared: TaskTypeDef = { ...defWith(undefined as never), finishBehaviour: undefined as never }
  assert.equal(finishActionLabel(undeclared), 'Finish')
})
