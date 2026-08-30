import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoAnalyze, shouldSuggestOnMyDayAdd } from '../src/main/triggers'
import type { Settings, Task } from '../src/shared/types'

const SETTINGS_ON: Settings = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'sk-test',
  wikiPath: '',
  defaultListId: null,
  maxConcurrentJobs: 2, showWelcome: false
}

const SETTINGS_OFF: Settings = { ...SETTINGS_ON, apiKey: null }

function paperTask(link: string | null): Task {
  return {
    id: 't1',
    listId: 'l1',
    title: 'Some Paper',
    notes: '',
    type: 'paper_reading',
    completed: false,
    completedAt: null,
    inMyDay: false,
    myDayAddedAt: null,
    link,
    paperTitle: null,
    analysisLevel: null,
    analysisStatus: 'none',
    mismatchState: 'none',
    analysisError: null,
    pdfPath: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null
  }
}

test('shouldAutoAnalyze: paper task with link and configured AI', () => {
  assert.equal(shouldAutoAnalyze(paperTask('https://arxiv.org/abs/2301.00001'), SETTINGS_ON), true)
})

test('shouldAutoAnalyze: no link means no analysis', () => {
  assert.equal(shouldAutoAnalyze(paperTask(null), SETTINGS_ON), false)
})

test('shouldAutoAnalyze: no API key means no enqueue', () => {
  assert.equal(shouldAutoAnalyze(paperTask('https://arxiv.org/abs/2301.00001'), SETTINGS_OFF), false)
})

test('shouldAutoAnalyze: null task', () => {
  assert.equal(shouldAutoAnalyze(null, SETTINGS_ON), false)
})

test('shouldSuggestOnMyDayAdd: fires on first add only', () => {
  const before = { ...paperTask(null), inMyDay: false }
  assert.equal(shouldSuggestOnMyDayAdd(before, true), true)
  const alreadyIn = { ...before, inMyDay: true }
  assert.equal(shouldSuggestOnMyDayAdd(alreadyIn, true), false)
  assert.equal(shouldSuggestOnMyDayAdd(before, false), false)
  assert.equal(shouldSuggestOnMyDayAdd(null, true), false)
})
