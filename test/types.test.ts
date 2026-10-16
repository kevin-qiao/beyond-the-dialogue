import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, createList, createTask, getTask, updateTask, type DB } from '../src/main/db'
import {
  createTypeDef,
  deleteTypeDef,
  effectiveTypeDef,
  getTypeDef,
  hasUnfilledRequiredInputs,
  listTypeDefs,
  updateTypeDef,
  validateInputs,
  validateInputsForWrite
} from '../src/main/types'
import type { TaskTypeDef } from '../src/shared/types'
import { declaredWorkflow } from '../src/core/domain/taskType'

function freshDB(): { db: DB; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-types-'))
  const db = openDB(dir)
  migrate(db.db)
  return { db, dir }
}

const SURVEY: TaskTypeDef = {
  key: 'tech_survey',
  family: 'document',
  label: 'Technical survey',
  emoji: '🔎',
  description: 'Survey a topic',
  inputSchema: [
    { key: 'target', label: 'Target', type: 'text', required: true },
    { key: 'purpose', label: 'Purpose', type: 'textarea' }
  ],
  aiGuidance: 'Focus on trade-offs.',
  isBuiltin: false,
  finishBehaviour: 'complete-only'
}

test('built-in types are seeded and resolvable', () => {
  const { db } = freshDB()
  const keys = listTypeDefs(db.db).map((t) => t.key)
  // Feature 002 (Q1/Q3): the seeded set is exactly plain + document.
  assert.deepEqual([...keys].sort(), ['document', 'plain'])
  assert.equal(effectiveTypeDef(db.db, { type: 'document', customTypeKey: null })?.family, 'document')
  assert.equal(effectiveTypeDef(db.db, { type: 'plain', customTypeKey: null })?.family, null)
  db.close()
})

test('custom type CRUD: create, resolve, edit presentation; duplicate key rejected', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, SURVEY)
  assert.equal(created.isBuiltin, false)
  assert.equal(getTypeDef(db.db, 'tech_survey')?.family, 'document')
  assert.equal(listTypeDefs(db.db).length, 3) // 2 built-ins + this custom one
  assert.throws(() => createTypeDef(db.db, SURVEY), /already exists/)
  // Editing a custom type's label propagates to tasks resolving through it.
  updateTypeDef(db.db, { ...SURVEY, label: 'Renamed survey' })
  assert.equal(getTypeDef(db.db, 'tech_survey')?.label, 'Renamed survey')
  db.close()
})

test('a task with a custom key resolves through that type (design D2)', () => {
  const { db } = freshDB()
  createTypeDef(db.db, SURVEY)
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'x', type: 'plain', customTypeKey: 'tech_survey', inputs: { target: 'y' } })
  assert.equal(effectiveTypeDef(db.db, t)?.key, 'tech_survey')
  assert.equal(effectiveTypeDef(db.db, t)?.family, 'document')
  db.close()
})

test('built-in types cannot be deleted and keep behavior fixed', () => {
  const { db } = freshDB()
  assert.throws(() => deleteTypeDef(db.db, 'plain'), /built-in types cannot be removed/)
  // FR-017: editing a built-in's presentation is allowed...
  updateTypeDef(db.db, { ...getTypeDef(db.db, 'document')!, label: 'Writing' })
  const doc = getTypeDef(db.db, 'document')!
  assert.equal(doc.label, 'Writing')
  assert.equal(doc.family, 'document')
  // ...but a change to its family is refused, not silently ignored, so the
  // user learns why (contracts/type-definition.md "Validation rules").
  assert.throws(
    () => updateTypeDef(db.db, { ...getTypeDef(db.db, 'document')!, family: 'coding' }),
    /built-in types cannot change family/
  )
  assert.throws(
    () => updateTypeDef(db.db, { ...getTypeDef(db.db, 'document')!, finishBehaviour: 'complete-only' }),
    /built-in types cannot change finishBehaviour/
  )
  assert.equal(getTypeDef(db.db, 'document')!.family, 'document')
  // ...while its DESTINATION stays editable: pointing the seeded Document
  // type at a folder is the feature's own guided flow (Q1/FR-007).
  updateTypeDef(db.db, {
    ...getTypeDef(db.db, 'document')!,
    destination: { store: 'folder', rootPath: path.join(os.tmpdir(), 'wb-doc-out'), subdir: '' }
  })
  assert.equal(getTypeDef(db.db, 'document')!.destination?.rootPath, path.join(os.tmpdir(), 'wb-doc-out'))
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
  createTypeDef(db.db, {
    key: 'triage',
    family: null,
    label: 'Triage',
    emoji: '🧭',
    inputSchema: [
      {
        key: 'sourceKind',
        label: 'Source',
        type: 'select',
        required: true,
        immutable: true,
        options: [
          { value: 'issue', label: 'Issue' },
          { value: 'page', label: 'Page' }
        ]
      },
      { key: 'sourceText', label: 'Source content', type: 'textarea', required: true },
      { key: 'target', label: 'Target', type: 'textarea', required: true }
    ],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  })
  const triage = getTypeDef(db.db, 'triage')!
  assert.equal(validateInputs(triage, { sourceKind: 'issue', sourceText: 'x', target: 'y' }).ok, true)
  assert.equal(validateInputs(triage, { nope: 'x' }).ok, false)
  assert.equal(validateInputs(triage, { sourceKind: 'slack-message' }).ok, false)
  assert.equal(validateInputs(triage, { sourceKind: ['issue'] }).ok, false)
  // immutable field locked once set
  assert.equal(validateInputsForWrite(triage, { sourceKind: 'page', sourceText: 'a', target: 'b' }, { sourceKind: 'issue', sourceText: 'a', target: 'b' }).ok, false)
  // choosing the value at creation is fine (previous value empty)
  assert.equal(validateInputsForWrite(triage, { sourceKind: 'page' }, {}).ok, true)
  db.close()
})

test('required inputs gate Finish (3.5); inert fields never gate', () => {
  const { db } = freshDB()
  createTypeDef(db.db, SURVEY)
  const survey = getTypeDef(db.db, 'tech_survey')!
  const missing = hasUnfilledRequiredInputs(survey, {})
  assert.deepEqual(missing.map((f) => f.key), ['target'])
  assert.deepEqual(hasUnfilledRequiredInputs(survey, { target: 'eigenvalues' }), [])
  // whitespace-only does not count as filled
  assert.equal(hasUnfilledRequiredInputs(survey, { target: '   ' }).length, 1)
  // The seeded document type declares no inputs at all: the working area IS
  // the material, so nothing gates Finish except the draft itself (US1-AC6).
  assert.deepEqual(hasUnfilledRequiredInputs(getTypeDef(db.db, 'document')!, {}), [])
  db.close()
})

test('family must be one of the declared families, or absent', () => {
  const { db } = freshDB()
  assert.throws(
    () => createTypeDef(db.db, { ...SURVEY, key: 'weird', family: 'paper_reading' as never }),
    /family must be one of/
  )
  // Absent (null) is the honest "needs no assistance" declaration (D1).
  const noFamily = createTypeDef(db.db, { ...SURVEY, key: 'nofam', family: null })
  assert.equal(noFamily.family, null)
  db.close()
})

// ---- US2: round-trip and the save-path validation (FR-004, contracts/type-definition.md) ----

test('type round-trip: every declared field survives save and reload', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, {
    key: 'diary',
    family: 'document',
    label: 'Diary',
    emoji: '📔',
    description: 'File the diary',
    color: '#336699',
    inputSchema: [{ key: 'target', label: 'Objective', type: 'text', required: true }],
    aiGuidance: 'File my diary as date-prefixed notes.',
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: '/home/u/Documents/Diary', subdir: 'notes' }
  })

  // The persistence statement writes an explicit column list, so a field
  // omitted there is silently dropped on save. Read back and compare all of it.
  const reread = getTypeDef(db.db, 'diary')!
  assert.deepEqual(reread, created)
  assert.equal(reread.family, 'document')
  assert.equal(reread.finishBehaviour, 'polish-then-file')
  assert.deepEqual(reread.destination, { store: 'folder', rootPath: '/home/u/Documents/Diary', subdir: 'notes' })
  assert.equal(reread.aiGuidance, 'File my diary as date-prefixed notes.')
  assert.equal(reread.color, '#336699')
  // Grants are storage-only (D9): the column keeps the empty default and the
  // shape never grows the field, whatever a caller tried to pass.
  const raw = db.db.prepare("SELECT grants_json FROM task_types WHERE key='diary'").get() as { grants_json: string }
  assert.deepEqual(JSON.parse(raw.grants_json), { skills: [], toolServers: [] })
  assert.equal('grants' in reread, false)

  // An edit round-trips too.
  updateTypeDef(db.db, { ...reread, label: 'Evening diary' })
  const edited = getTypeDef(db.db, 'diary')!
  assert.equal(edited.label, 'Evening diary')
  assert.deepEqual(edited.destination, reread.destination, 'the destination survived the edit')
  assert.equal(edited.finishBehaviour, 'polish-then-file', 'the behaviour survived the edit')
  db.close()
})

test('the save path validates the destination (contracts/destination.md §5, FR-013)', () => {
  const { db } = freshDB()
  const base: TaskTypeDef = {
    key: 'notes_type',
    family: 'document',
    label: 'Notes',
    emoji: '📝',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: '/home/u/Documents/Notes', subdir: '' }
  }

  // A writing behaviour requires a destination.
  assert.throws(() => createTypeDef(db.db, { ...base, destination: undefined }), /must declare a destination/)
  // complete-only forbids one.
  assert.throws(
    () => createTypeDef(db.db, { ...base, finishBehaviour: 'complete-only' }),
    /must not declare a destination/
  )
  // FR-013: a USER type whose behaviour files must name a location — an empty
  // root is refused at save, for either store (data-model: "never legal on a
  // saved user Type").
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'folder', rootPath: '', subdir: '' } }),
    /needs a location/
  )
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'wiki', rootPath: '', subdir: '' } }),
    /needs a location/
  )
  // A named-but-relative root is refused, per store.
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'folder', rootPath: 'relative', subdir: '' } }),
    /absolute rootPath/
  )
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'wiki', rootPath: 'relative', subdir: '' } }),
    /absolute rootPath/
  )
  // subdir must be relative with no traversal.
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'folder', rootPath: '/home/u/D', subdir: '../out' } }),
    /must not contain a ".." segment/
  )
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'folder', rootPath: '/home/u/D', subdir: '/etc' } }),
    /must be relative/
  )
  // A valid one is accepted, and nothing was left behind by the refusals.
  createTypeDef(db.db, base)
  assert.equal(getTypeDef(db.db, 'notes_type')?.finishBehaviour, 'polish-then-file')
  db.close()
})

// ---- US3: user-defined types (SC-004, FR-012..FR-017) ----

test('a custom type declares its own instruction, destination and behaviour, and they drive the workflow', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, {
    key: 'retro',
    family: 'document',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [{ key: 'target', label: 'Focus', type: 'text', required: true }],
    aiGuidance: 'Always end with a follow-up owner.',
    isBuiltin: false,
    finishBehaviour: 'file-as-is',
    destination: { store: 'folder', rootPath: '/home/u/Documents/Retros', subdir: '' }
  })

  // The declared instruction round-trips — the organize step reads it from
  // the declaration (D2; its prompt wiring is pinned in test/organize.test.ts).
  const def = getTypeDef(db.db, 'retro')!
  assert.equal(def.aiGuidance, 'Always end with a follow-up owner.')

  // ...and the declared behaviour routes the finish.
  assert.equal(declaredWorkflow(created).finishBehaviour, 'file-as-is')
  assert.deepEqual(declaredWorkflow(created).destination, { store: 'folder', rootPath: '/home/u/Documents/Retros', subdir: '' })
  assert.equal(created.isBuiltin, false)
  db.close()
})

test('an unrecognised finishBehaviour is rejected, never silently defaulted', () => {
  const { db } = freshDB()
  const base: TaskTypeDef = {
    key: 'retro',
    family: 'document',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'complete-only'
  }
  assert.throws(
    () => createTypeDef(db.db, { ...base, finishBehaviour: 'polish' as never }),
    /finishBehaviour must be one of/
  )
  // An empty string is "nothing declared", not "something unrecognised" — the
  // two are different failures and the message says which.
  assert.throws(
    () => createTypeDef(db.db, { ...base, finishBehaviour: '' as never }),
    /must declare a finishBehaviour/
  )
  assert.throws(
    () => createTypeDef(db.db, { ...base, finishBehaviour: undefined as never }),
    /must declare a finishBehaviour/
  )
  assert.equal(getTypeDef(db.db, 'retro'), null, 'nothing was written by any refusal')
  db.close()
})

test('an undeclared behaviour is refused for every type — no history to fall back to', () => {
  // Feature 002 deleted the legacy-workflow fallback with the categories
  // (research D1): there is no category whose history could fill the gap, and
  // Principle I forbids inferring a behaviour from a type key.
  const { db } = freshDB()
  assert.throws(
    () => createTypeDef(db.db, { ...SURVEY, key: 'nodecl', finishBehaviour: undefined as never }),
    /must declare a finishBehaviour/
  )
  assert.throws(
    () => createTypeDef(db.db, { ...SURVEY, key: 'nodecl2', family: null, finishBehaviour: undefined as never }),
    /must declare a finishBehaviour/
  )
  db.close()
})

test('deleting a custom type reassigns its tasks and destroys nothing', () => {
  const { db, dir } = freshDB()
  createTypeDef(db.db, {
    key: 'retro',
    family: 'document',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'file-as-is',
    destination: { store: 'folder', rootPath: path.join(dir, 'retros'), subdir: '' }
  })
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'Sprint 12 retro', type: 'plain', customTypeKey: 'retro', inputs: {} })
  updateTask(db.db, t.id, { completed: true })

  // An artifact that this type already produced.
  const artifact = path.join(dir, 'retros', 'sprint-12-retro.md')
  fs.mkdirSync(path.dirname(artifact), { recursive: true })
  fs.writeFileSync(artifact, 'WRITTEN')

  deleteTypeDef(db.db, 'retro')

  assert.equal(getTypeDef(db.db, 'retro'), null)
  const after = getTask(db.db, t.id)!
  assert.equal(after.customTypeKey, null, 'the reference was cleared, not left dangling')
  assert.equal(after.type, 'plain')
  assert.equal(after.title, 'Sprint 12 retro', 'the task itself survived')
  assert.equal(after.completed, true)
  // The artifact is a file the user owns; deleting a type never touches it
  // (FR-014).
  assert.equal(fs.readFileSync(artifact, 'utf-8'), 'WRITTEN')
  db.close()
})
