import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Hotfix guard (002): the Settings drawer's Type registry is CONFIGURATION,
// not an assistant surface — it must not be gated on the assistant switch.
//
// Feature 001 hid assistant surfaces while the switch was off; feature 002
// made the switch-off state a full working configuration: the seeded Document
// Type ships without a location (Q1), its first Finish is the guided
// `destination.notConfigured` refusal ("choose the folder … in Settings →
// Types"), and the switch is off by default on a fresh install. With the
// Types tab gated on `assistantOn`, that refusal instructed the user to a
// surface that did not exist — a dead end the size of the feature's first
// run. The same applies to every other part of the drawer: providers, skills,
// MCP servers and Themes are configured precisely SO that the assistant can
// be switched on later; gating the place where you configure them behind the
// switch inverts the dependency.
//
// The guard is mechanical in both directions: the drawer must not reference
// the switch at all, AND the Types tab must still be there (so the rule
// cannot be satisfied by deleting the tab).

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
}

/** Strip comments so a prose mention of the switch cannot trip the scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const settingsView = 'src/renderer/src/components/overlays/SettingsView.tsx'

test('the Settings drawer does not gate any surface on the assistant switch', () => {
  const code = stripComments(readSource(settingsView))
  assert.ok(
    !/isAssistantEnabled|assistantOn/.test(code),
    'Settings must configure while the assistant is off: the guided fresh-install ' +
      'flow (Q1/FR-007) points the user at Settings → Types, and the switch is off by default'
  )
})

test('the Types tab and its section are present and unconditional', () => {
  const code = stripComments(readSource(settingsView))
  // The tab button and the section both key off `tab === 'types'`; neither
  // may sit inside a conditional on the switch (the scan above already bans
  // the switch's name — this asserts the tab survives at all).
  assert.ok(/aria-selected=\{tab === 'types'\}/.test(code), 'the Types tab is rendered')
  assert.ok(/\{tab === 'types' && \(/.test(code), 'the Types section renders for the selected tab')
  // And it still offers the full registry: built-ins list, new-type action,
  // and the destination editor the guided refusal sends the user to.
  assert.ok(/settings\.types\.new/.test(code), 'the new-Type action is present')
  assert.ok(/typeEditor\.destination/.test(code), 'destination editing is present')
})

test('the assistant-run surfaces remain gated (the hotfix did not over-widen)', () => {
  // TaskBand's mode choice (D8: only where an assistant step would run) and
  // Activity's RETRY of a failed curation (assistant working) stay behind the
  // switch; the ChatPanel states a reason rather than hiding (US2-AC3).
  const band = stripComments(readSource('src/renderer/src/components/focus/TaskBand.tsx'))
  assert.ok(/isAssistantEnabled/.test(band), 'the finish choice remains gated on the switch')
  const activity = stripComments(readSource('src/renderer/src/components/overlays/ActivityView.tsx'))
  assert.ok(/isAssistantEnabled\(snapshot\.settings\)[\s\S]{0,120}retryIngest/.test(activity), 'retry stays assistant-gated')
  const chat = stripComments(readSource('src/renderer/src/components/focus/ChatPanel.tsx'))
  assert.ok(/conversation\.unavailable\.(off|notConfigured)/.test(chat), 'the chat states its reason instead of hiding')
})
