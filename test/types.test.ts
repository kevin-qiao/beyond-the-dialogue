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
import { declaredWorkflow } from '../src/core/domain/taskType'
import { preprocessInstruction } from '../src/core/domain/preprocess'

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
  // SC-002: the built-in set grows from three to four (Meeting is new).
  assert.deepEqual([...keys].sort(), ['jira', 'learning', 'meeting', 'plain'])
  assert.equal(effectiveKind(db.db, { type: 'learning', customTypeKey: null }), 'learning')
  assert.equal(effectiveKind(db.db, { type: 'plain', customTypeKey: null }), 'plain')
  db.close()
})

test('custom type CRUD: create, resolve, edit presentation; duplicate key rejected', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, SURVEY)
  assert.equal(created.isBuiltin, false)
  assert.equal(getTypeDef(db.db, 'tech_survey')?.kind, 'learning')
  assert.equal(listTypeDefs(db.db).length, 5) // 4 built-ins + this custom one
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
  // FR-017: editing a built-in's presentation is allowed...
  updateTypeDef(db.db, { ...getTypeDef(db.db, 'learning')!, label: 'Studying' })
  const learning = getTypeDef(db.db, 'learning')!
  assert.equal(learning.label, 'Studying')
  assert.equal(learning.kind, 'learning')
  assert.ok(learning.inputSchema.length > 0)
  // ...but a change to its category is refused, not silently ignored, so the
  // user learns why (contracts/type-definition.md "Validation rules").
  assert.throws(
    () => updateTypeDef(db.db, { ...getTypeDef(db.db, 'learning')!, kind: 'jira' }),
    /built-in types cannot change kind/
  )
  assert.throws(
    () => updateTypeDef(db.db, { ...getTypeDef(db.db, 'learning')!, finishBehaviour: 'complete-only' }),
    /built-in types cannot change finishBehaviour/
  )
  assert.equal(getTypeDef(db.db, 'learning')!.kind, 'learning')
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
  // jira requires sourceText + target; no declared field is inert any more
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

// ---- US2: round-trip and the save-path validation (FR-004, contracts/type-definition.md) ----

test('type round-trip: every declared field survives save and reload', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, {
    key: 'minutes',
    kind: 'meeting',
    label: 'Minutes',
    emoji: '🗓',
    description: 'File the minutes',
    color: '#336699',
    inputSchema: [{ key: 'target', label: 'Objective', type: 'text', required: true }],
    aiGuidance: 'Focus on decisions.',
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: '/home/u/Documents/Minutes', subdir: 'notes' },
    grants: { skills: ['summarize'], toolServers: ['jira'] }
  })

  // The persistence statement writes an explicit column list, so a field
  // omitted there is silently dropped on save. Read back and compare all of it.
  const reread = getTypeDef(db.db, 'minutes')!
  assert.deepEqual(reread, created)
  assert.equal(reread.finishBehaviour, 'polish-then-file')
  assert.deepEqual(reread.destination, { store: 'folder', rootPath: '/home/u/Documents/Minutes', subdir: 'notes' })
  assert.deepEqual(reread.grants, { skills: ['summarize'], toolServers: ['jira'] })
  assert.equal(reread.aiGuidance, 'Focus on decisions.')
  assert.equal(reread.color, '#336699')

  // An edit round-trips too — including clearing a destination is refused, so
  // edit the fields that may legitimately change.
  updateTypeDef(db.db, { ...reread, label: 'Meeting minutes', grants: { skills: [], toolServers: ['jira'] } })
  const edited = getTypeDef(db.db, 'minutes')!
  assert.equal(edited.label, 'Meeting minutes')
  assert.deepEqual(edited.grants, { skills: [], toolServers: ['jira'] })
  assert.deepEqual(edited.destination, reread.destination, 'the destination survived the edit')
  assert.equal(edited.finishBehaviour, 'polish-then-file', 'the behaviour survived the edit')
  db.close()
})

test('the save path validates the destination (contracts/destination.md §5)', () => {
  const { db } = freshDB()
  const base: TaskTypeDef = {
    key: 'notes_type',
    kind: 'meeting',
    label: 'Notes',
    emoji: '📝',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'polish-then-file',
    destination: { store: 'folder', rootPath: '/home/u/Documents/Minutes', subdir: '' },
    grants: { skills: [], toolServers: [] }
  }

  // A writing behaviour requires a destination.
  assert.throws(() => createTypeDef(db.db, { ...base, destination: undefined }), /must declare a destination/)
  // complete-only forbids one.
  assert.throws(
    () => createTypeDef(db.db, { ...base, finishBehaviour: 'complete-only' }),
    /must not declare a destination/
  )
  // A folder destination must be absolute.
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'folder', rootPath: 'relative', subdir: '' } }),
    /absolute rootPath/
  )
  // A wiki destination must not carry its own root.
  assert.throws(
    () => createTypeDef(db.db, { ...base, destination: { store: 'wiki', rootPath: '/x', subdir: '' } }),
    /must not declare a rootPath/
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

test('a custom type declares its own prompt, destination and behaviour, and they drive the workflow', () => {
  const { db } = freshDB()
  const created = createTypeDef(db.db, {
    key: 'retro',
    kind: 'meeting',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [{ key: 'target', label: 'Focus', type: 'text', required: true }],
    aiGuidance: 'Always end with a follow-up owner.',
    isBuiltin: false,
    finishBehaviour: 'file-as-is',
    destination: { store: 'folder', rootPath: '/home/u/Documents/Retros', subdir: '' },
    grants: { skills: [], toolServers: [] }
  })

  // The declared instruction reaches the pre-process prompt...
  const def = getTypeDef(db.db, 'retro')!
  const instruction = preprocessInstruction(def.kind)!
  const prompt = instruction.buildPrompt({
    context: instruction.buildContext({ title: 'Sprint 12 retro', notes: '' }, { target: 'What went badly' }),
    userPrompt: '',
    aiGuidance: def.aiGuidance ?? '',
    inputs: { target: 'What went badly' }
  })
  assert.ok(prompt.includes('Always end with a follow-up owner.'), 'the custom instruction is in the prompt')
  assert.ok(prompt.includes('What went badly'), 'and the task context is too')

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
    kind: 'meeting',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'complete-only',
    grants: { skills: [], toolServers: [] }
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
  // A meeting type cannot leave the behaviour undeclared either: there is no
  // historical behaviour for the category to fall back to.
  assert.throws(
    () => createTypeDef(db.db, { ...base, finishBehaviour: undefined as never }),
    /must declare a finishBehaviour/
  )
  assert.equal(getTypeDef(db.db, 'retro'), null, 'nothing was written by any refusal')
  db.close()
})

test('an undeclared behaviour on a pre-existing category falls back to that category history', () => {
  const { db } = freshDB()
  // A learning-kind custom type created by an older caller declares nothing;
  // it must keep behaving the way a learning task always has (SC-002).
  const created = createTypeDef(db.db, { ...SURVEY, finishBehaviour: undefined as never })
  assert.equal(created.finishBehaviour, 'deposit-then-curate')
  assert.deepEqual(created.destination, { store: 'wiki', rootPath: null, subdir: 'learning-notes' })
  // plain and jira have no history of writing anything.
  const plainish = createTypeDef(db.db, { ...SURVEY, key: 'plainish', kind: 'plain', finishBehaviour: undefined as never })
  assert.equal(plainish.finishBehaviour, 'complete-only')
  assert.equal(plainish.destination, undefined)
  db.close()
})

test('deleting a custom type reassigns its tasks and destroys nothing', () => {
  const { db, dir } = freshDB()
  createTypeDef(db.db, {
    key: 'retro',
    kind: 'meeting',
    label: 'Retro',
    emoji: '🔁',
    inputSchema: [],
    isBuiltin: false,
    finishBehaviour: 'file-as-is',
    destination: { store: 'folder', rootPath: path.join(dir, 'retros'), subdir: '' },
    grants: { skills: [], toolServers: [] }
  })
  const l = createList(db.db, 'L')
  const t = createTask(db.db, { listId: l.id, title: 'Sprint 12 retro', type: 'meeting', customTypeKey: 'retro', inputs: {} })
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
  // The artifact is a file the user owns; deleting a type never touches it.
  assert.equal(fs.readFileSync(artifact, 'utf-8'), 'WRITTEN')
  db.close()
})
