import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, createTask, getTask, updateTask, type DB } from '../src/main/db'
import {
  createTypeDef,
  deleteTypeDef,
  effectiveKind,
  effectiveTypeDef,
  getTypeDef,
  hasUnfilledRequiredInputs,
  listTypeDefs,
  updateTypeDef,
  validateInputs,
  validateInputsForWrite
} from '../src/main/types'
import type { TaskTypeDef } from '../src/shared/types'

function freshDB(): { db: DB; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-types-'))
  const db = openDB(dir)
  migrate(db.db)
  return { db, dir }
}

const SURVEY: TaskTypeDef = {
  key: 'tech_survey',
  kind: 'learning',
  label: 'Technical survey',
  emoji: '🔎',
  description: 'Survey a topic',
  inputSchema: [
    { key: 'target', label: 'Target', type: 'text', required: true },
    { key: 'purpose', label: 'Purpose', type: 'textarea' }
  ],
  aiGuidance: 'Focus on trade-offs.',
  isBuiltin: false
}

test('built-in types are seeded and resolvable', () => {
  const { db } = freshDB()
  const keys = listTypeDefs(db.db).map((t) => t.key)
  assert.deepEqual([...keys].sort(), ['jira', 'learning', 'plain'])
  assert.equal(effectiveKind(db.db, { type: 'learning', customTypeKey: null }), 'learning')
  assert.equal(effectiveKind(db.db, { type: 'plain', customTypeKey: null }), 'plain')
  db.close()
})

test('custom type CRUD: create, resolve, edit presentation; duplicate key rejected', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, SURVEY)
  assert.equal(created.isBuiltin, false)
  assert.equal(getTypeDef(db.db, 'tech_survey')?.kind, 'learning')
  assert.equal(listTypeDefs(db.db).length, 4)
  assert.throws(() => createTypeDef(db.db, SURVEY), /already exists/)
  // Editing a custom type's label propagates to tasks resolving through it.
  updateTypeDef(db.db, { ...SURVEY, label: 'Renamed survey' })
  assert.equal(getTypeDef(db.db, 'tech_survey')?.label, 'Renamed survey')
  db.close()
})

test('a task with a custom key inherits that kind (design D2)', () => {
  const { db } = freshDB()
  createTypeDef(db.db, SURVEY)
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'x', type: 'plain', customTypeKey: 'tech_survey', inputs: { target: 'y' } })
  assert.equal(effectiveTypeDef(db.db, t)?.key, 'tech_survey')
  assert.equal(effectiveKind(db.db, t), 'learning')
  db.close()
})

test('built-in types cannot be deleted and keep behavior fixed', () => {
  const { db } = freshDB()
  assert.throws(() => deleteTypeDef(db.db, 'plain'), /built-in types cannot be removed/)
  // Editing a built-in only changes presentation; kind and schema survive.
  updateTypeDef(db.db, { ...getTypeDef(db.db, 'learning')!, label: 'Studying', kind: 'jira', inputSchema: [] })
  const learning = getTypeDef(db.db, 'learning')!
  assert.equal(learning.label, 'Studying')
  assert.equal(learning.kind, 'learning')
  assert.ok(learning.inputSchema.length > 0)
  db.close()
})

test('deleting a custom type reassigns its tasks to plain without losing core fields', () => {
  const { db } = freshDB()
  createTypeDef(db.db, SURVEY)
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'keep me', notes: 'keep this', type: 'plain', customTypeKey: 'tech_survey', inputs: { target: 'z' } })
  updateTask(db.db, t.id, { completed: true })
  deleteTypeDef(db.db, 'tech_survey')
  assert.equal(getTypeDef(db.db, 'tech_survey'), null)
  const after = getTask(db.db, t.id)!
  assert.equal(after.type, 'plain')
  assert.equal(after.customTypeKey, null)
  assert.equal(after.title, 'keep me')
  assert.equal(after.notes, 'keep this')
  assert.equal(after.completed, true)
  assert.deepEqual(after.inputs, {}, 'type-specific inputs are discarded')
  db.close()
})

test('input validation: unknown keys, bad select values, and immutability', () => {
  const { db } = freshDB()
  const jira = getTypeDef(db.db, 'jira')!
  assert.equal(validateInputs(jira, { sourceKind: 'issue', sourceText: 'x', target: 'y' }).ok, true)
  assert.equal(validateInputs(jira, { nope: 'x' }).ok, false)
  assert.equal(validateInputs(jira, { sourceKind: 'slack-message' }).ok, false)
  assert.equal(validateInputs(jira, { sourceKind: ['issue'] }).ok, false)
  // immutable field locked once set
  assert.equal(validateInputsForWrite(jira, { sourceKind: 'page', sourceText: 'a', target: 'b' }, { sourceKind: 'issue', sourceText: 'a', target: 'b' }).ok, false)
  // choosing the kind at creation is fine (previous value empty)
  assert.equal(validateInputsForWrite(jira, { sourceKind: 'page' }, {}).ok, true)
  db.close()
})

test('required inputs gate Finish (3.5); inert placeholders never gate', () => {
  const { db } = freshDB()
  const learning = getTypeDef(db.db, 'learning')!
  const missing = hasUnfilledRequiredInputs(learning, {})
  assert.deepEqual(missing.map((f) => f.key), ['target'])
  assert.deepEqual(hasUnfilledRequiredInputs(learning, { target: 'eigenvalues' }), [])
  // whitespace-only does not count as filled
  assert.equal(hasUnfilledRequiredInputs(learning, { target: '   ' }).length, 1)
  // jira requires sourceText + target; skill/mcp are inert and never required
  const jira = getTypeDef(db.db, 'jira')!
  assert.deepEqual(hasUnfilledRequiredInputs(jira, { sourceKind: 'issue', target: 'x' }).map((f) => f.key), ['sourceText'])
  assert.equal(hasUnfilledRequiredInputs(jira, { sourceKind: 'issue', target: 'x', sourceText: 'body', skill: '', mcp: '' }).length, 0)
  db.close()
})

test('type kind must be one of the supported kinds', () => {
  const { db } = freshDB()
  assert.throws(() => createTypeDef(db.db, { ...SURVEY, key: 'weird', kind: 'paper_reading' as never }), /kind must be one of/)
  db.close()
})
