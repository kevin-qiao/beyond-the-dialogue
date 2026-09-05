import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldSuggestOnMyDayAdd, shouldPreprocessOnAdd, shouldPreprocessOnEdit } from '../src/main/ai/triggers'
import { preprocessInputHash } from '../src/main/types'
import type { Settings, Task, TaskTypeDef } from '../src/shared/types'

const SETTINGS_ON: Settings = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'sk-test',
  wikiPath: '',
  defaultListId: null,
  maxConcurrentJobs: 2,
  showWelcome: false,
  theme: 'light',
  skills: [],
  mcpServers: []
}

const SETTINGS_OFF: Settings = { ...SETTINGS_ON, apiKey: null }

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    listId: 'l1',
    title: 'Linear algebra review',
    notes: '',
    type: 'learning',
    customTypeKey: null,
    inputs: { target: 'Eigenvalues' },
    preprocessStatus: 'none',
    preprocessError: null,
    alarmAt: null,
    completed: false,
    completedAt: null,
    inMyDay: false,
    myDayAddedAt: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    ...overrides
  }
}

const LEARNING_DEF: TaskTypeDef = {
  key: 'learning',
  kind: 'learning',
  label: 'Learning',
  emoji: '🎓',
  inputSchema: [
    { key: 'target', label: 'Target', type: 'text', required: true },
    { key: 'skill', label: 'Skill', type: 'select', optionsSource: 'skills', inert: true }
  ],
  isBuiltin: true
}

test('suggestions fire on first My Day add only (plain path)', () => {
  const before = baseTask({ inMyDay: false })
  assert.equal(shouldSuggestOnMyDayAdd(before, true), true)
  assert.equal(shouldSuggestOnMyDayAdd({ ...before, inMyDay: true }, true), false)
  assert.equal(shouldSuggestOnMyDayAdd(before, false), false)
  assert.equal(shouldSuggestOnMyDayAdd(null, true), false)
})

test('preprocess on add: AI kind + configured + first add only', () => {
  const before = baseTask({ inMyDay: false })
  assert.equal(shouldPreprocessOnAdd(before, true, 'learning', SETTINGS_ON), true)
  assert.equal(shouldPreprocessOnAdd(before, true, 'jira', SETTINGS_ON), true)
  assert.equal(shouldPreprocessOnAdd(before, true, 'plain', SETTINGS_ON), false)
  assert.equal(shouldPreprocessOnAdd(before, true, 'learning', SETTINGS_OFF), false)
  assert.equal(shouldPreprocessOnAdd({ ...before, inMyDay: true }, true, 'learning', SETTINGS_ON), false)
  assert.equal(shouldPreprocessOnAdd(before, false, 'learning', SETTINGS_ON), false)
})

test('preprocess re-run is hash-gated and only while in My Day', () => {
  const task = baseTask({ inMyDay: true })
  const h = preprocessInputHash(task, LEARNING_DEF)
  // Unchanged inputs: no re-run.
  assert.equal(shouldPreprocessOnEdit(task, 'learning', SETTINGS_ON, h, h), false)
  // Changed hash while in My Day and not in-flight: re-run.
  assert.equal(shouldPreprocessOnEdit(task, 'learning', SETTINGS_ON, 'other', h), true)
  // Not in My Day / completed: never.
  assert.equal(shouldPreprocessOnEdit(baseTask(), 'learning', SETTINGS_ON, 'other', h), false)
  assert.equal(shouldPreprocessOnEdit(baseTask({ inMyDay: true, completed: true }), 'learning', SETTINGS_ON, 'other', h), false)
  // In flight: no double-enqueue.
  assert.equal(shouldPreprocessOnEdit(baseTask({ inMyDay: true, preprocessStatus: 'queued' }), 'learning', SETTINGS_ON, 'other', h), false)
  assert.equal(shouldPreprocessOnEdit(baseTask({ inMyDay: true, preprocessStatus: 'running' }), 'learning', SETTINGS_ON, 'other', h), false)
  // AI kind but not configured, or plain kind: no.
  assert.equal(shouldPreprocessOnEdit(task, 'learning', SETTINGS_OFF, 'other', h), false)
  assert.equal(shouldPreprocessOnEdit(task, 'plain', SETTINGS_ON, 'other', h), false)
})

test('input hash is stable, ignores inert fields, and follows title/notes', () => {
  const a = preprocessInputHash(baseTask(), LEARNING_DEF)
  const b = preprocessInputHash(baseTask(), LEARNING_DEF)
  assert.equal(a, b, 'stable')
  // skill is inert — setting it must not change the hash (D3 relevant inputs)
  const withSkill = preprocessInputHash(baseTask({ inputs: { target: 'Eigenvalues', skill: 'x' } }), LEARNING_DEF)
  assert.equal(a, withSkill, 'inert fields ignored')
  // target is relevant — changing it must change the hash
  const changed = preprocessInputHash(baseTask({ inputs: { target: 'SVD' } }), LEARNING_DEF)
  assert.notEqual(a, changed)
  const retitled = preprocessInputHash(baseTask({ title: 'Something else' }), LEARNING_DEF)
  assert.notEqual(a, retitled)
})
