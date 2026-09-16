import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issuesToText, localizeThrown } from '../src/main/errors'
import { LocalizedError } from '../src/core/i18n/issues'
import { isTransientError } from '../src/main/job-queue'
import { message } from '../src/core/i18n'

// Phrasing the domain's codes, and knowing when NOT to.
//
// The domain refuses in codes because it has no language; main applies one
// before the error crosses the IPC boundary, where nothing structured survives.
// The risk in doing that uniformly is in the errors that are NOT codes: a
// transient job failure must keep the message `isTransientError` matches on, or
// a retryable failure stops being retried.

test('issues are phrased in the language asked for', () => {
  const issues = [{ key: 'validation.unknownInput' as const, params: { input: 'nope', type: 'learning' } }]
  assert.equal(issuesToText(issues, 'en'), 'unknown input "nope" for type "learning"')
  assert.equal(issuesToText(issues, 'zh-CN'), '类型“learning”不认识输入项“nope”')
})

test('several issues are joined the way the language joins a list', () => {
  const issues = [{ key: 'validation.labelRequired' as const }, { key: 'validation.emojiRequired' as const }]
  assert.equal(issuesToText(issues, 'en'), 'label is required; emoji is required')
  // Full-width, and no space: the separator is part of the translation.
  assert.equal(issuesToText(issues, 'zh-CN'), '名称不能为空；表情不能为空')
})

test('a code-carrying refusal is rewritten as a sentence', () => {
  const localized = localizeThrown(new LocalizedError([{ key: 'validation.noType' as never }]), 'en')
  assert.ok(localized instanceof Error)
  assert.equal(localized.message, 'validation.noType')
})

test('anything that is not a refusal passes through untouched', () => {
  // Same instance, not just an equal message: rebuilding an error would risk
  // losing what the caller matches on.
  const plain = new Error('rate limit exceeded (429)')
  assert.equal(localizeThrown(plain, 'zh-CN'), plain)
  const notAnError = { message: 'nope' }
  assert.equal((localizeThrown(notAnError, 'en') as Error).message, '[object Object]')
})

test('a transient failure survives localization and is still retried', () => {
  // The regression this wrapper could introduce: if a transient error were
  // rebuilt or re-worded, `isTransientError` would stop recognising it and the
  // job queue would give up on a failure it is supposed to retry.
  const transient = new Error('rate limit exceeded (429)')
  assert.equal(isTransientError(transient.message), true)
  const after = localizeThrown(transient, 'zh-CN')
  assert.equal(after, transient)
  assert.equal(isTransientError(after.message), true, 'a retryable failure must stay retryable')
})

test('a translated refusal is what a user would read', () => {
  // End to end for one refusal, both languages: the code the domain raises,
  // the sentence the user gets.
  const refused = new LocalizedError([{ key: 'finish.missingInputs', params: { fields: 'Objective' } }])
  assert.equal(localizeThrown(refused, 'en').message, 'cannot finish: missing required input(s): Objective')
  assert.equal(localizeThrown(refused, 'zh-CN').message, '无法完成：缺少必填输入：Objective')
  // And the English is character for character what the app said before the
  // codes existed — which is what three tests in types.test.ts depend on.
  assert.equal(
    message('en', 'finish.missingInputs', { fields: 'Objective' }),
    'cannot finish: missing required input(s): Objective'
  )
})
