import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractAssistantText } from '../src/main/adapters/agent/sessionAdapter'

// `extractAssistantText` pulls the assistant's prose out of an SDK message.
// It had no test, and it is the single point where a reply can be silently
// lost — an empty string here is indistinguishable from a model that said
// nothing, and the pre-process path treats that as a failure while the
// curating path treats it as normal.

test('joins the text blocks of an array-content message', () => {
  assert.equal(
    extractAssistantText({ content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }),
    'one\ntwo'
  )
})

test('ignores non-text blocks rather than stringifying them', () => {
  assert.equal(
    extractAssistantText({
      content: [
        { type: 'tool_use', name: 'read', input: {} },
        { type: 'text', text: 'the answer' },
        { type: 'thinking', text: 'internal' }
      ]
    }),
    'the answer'
  )
})

test('accepts a plain string content', () => {
  assert.equal(extractAssistantText({ content: 'just prose' }), 'just prose')
})

test('returns empty string for anything unusable, never a crash', () => {
  assert.equal(extractAssistantText(null), '')
  assert.equal(extractAssistantText(undefined), '')
  assert.equal(extractAssistantText({}), '')
  assert.equal(extractAssistantText({ content: [] }), '')
  assert.equal(extractAssistantText({ content: [{ type: 'text', text: 42 }] }), '')
})
