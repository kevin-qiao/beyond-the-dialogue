import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAssistantEnabled } from '../src/core/domain/assistant'

// The switch rule (feature 001 T003, FR-014/FR-015, research D1). A pure
// function over the declared value — the dispatch happens exactly here, and
// every choke point asks this instead of comparing strings.

test('isAssistantEnabled: default/off ⇒ false, on ⇒ true', () => {
  assert.equal(isAssistantEnabled({ assistantRuntime: 'off' }), false)
  assert.equal(isAssistantEnabled({ assistantRuntime: 'on' }), true)
})

test('isAssistantEnabled: an unrecognised value is off — the safe answer', () => {
  assert.equal(isAssistantEnabled({ assistantRuntime: 'always' as 'off' | 'on' }), false)
  assert.equal(isAssistantEnabled({} as { assistantRuntime: 'off' | 'on' }), false)
})
