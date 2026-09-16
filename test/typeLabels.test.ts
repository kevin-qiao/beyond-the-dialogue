import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayFieldLabel, displayFieldPlaceholder, displayTypeDescription, displayTypeLabel, localizeTypeDef, typeLabel } from '../src/renderer/src/lib/typeCatalog'
import { en, isMessageKey } from '../src/core/i18n'
import { builtinTypeSeeds } from '../src/main/db'
import type { TaskTypeDef } from '../src/shared/types'

// Showing a seeded type label in the active language, without ever writing over
// a name the user chose.
//
// The type registry is seeded from the English catalog and is editable in
// Settings → Types, so a displayed label is translated ONLY while it still
// equals what was seeded. Once it differs, it is the user's words and is shown
// as written. No migration: the comparison happens at render time and nothing is
// written back.
//
// The rule is tested against the real seeds rather than a fixture, because the
// thing that can silently break is the seed text — if `db.ts` and the catalog
// drift apart, every built-in stops being recognised as untouched and quietly
// reverts to English.

const learning = () => builtinTypeSeeds().find((t) => t.key === 'learning')!
const renamed = (label: string): TaskTypeDef => ({ ...learning(), label })

test('a seeded built-in is shown in the active language', () => {
  const def = learning()
  assert.equal(def.label, en['type.learning.label'], 'the seed must come from the catalog')
  assert.equal(displayTypeLabel(def, 'en'), 'Learning')
  assert.equal(displayTypeLabel(def, 'zh-CN'), '学习')
  assert.equal(displayTypeDescription(def, 'zh-CN'), '学习一个概念：AI 提示 + 摘要，Markdown 笔记，完成时沉淀进 Wiki')
})

test('a renamed built-in keeps the name the user gave it, in every language', () => {
  const mine = renamed('Paper reading')
  assert.equal(displayTypeLabel(mine, 'en'), 'Paper reading')
  assert.equal(displayTypeLabel(mine, 'zh-CN'), 'Paper reading')
})

test('a custom type is never translated, because it has no catalog entry', () => {
  const custom: TaskTypeDef = {
    ...learning(),
    key: 'paper_reading',
    label: 'Paper reading',
    description: 'Read and summarise a paper',
    isBuiltin: false
  }
  assert.equal(displayTypeLabel(custom, 'zh-CN'), 'Paper reading')
  assert.equal(displayTypeDescription(custom, 'zh-CN'), 'Read and summarise a paper')
  assert.equal(localizeTypeDef(custom, 'zh-CN').label, 'Paper reading')
})

test('an absent description stays absent', () => {
  // `undefined` means "the user cleared it", not "translate the default":
  // falling back to the seeded text would resurrect a description they deleted.
  const { description: _drop, ...withoutDescription } = learning()
  assert.equal(displayTypeDescription(withoutDescription as TaskTypeDef, 'zh-CN'), undefined)
})

test('field labels and placeholders follow the same rule', () => {
  const def = learning()
  const target = def.inputSchema.find((f) => f.key === 'target')!
  assert.equal(displayFieldLabel(def, target, 'zh-CN'), '学习目标')
  assert.equal(displayFieldPlaceholder(def, target, 'zh-CN'), '要学习的概念或问题')

  // The same field, renamed by the user.
  const mine: TaskTypeDef = {
    ...def,
    inputSchema: def.inputSchema.map((f) => (f.key === 'target' ? { ...f, label: 'What I want to learn' } : f))
  }
  assert.equal(displayFieldLabel(mine, mine.inputSchema.find((f) => f.key === 'target')!, 'zh-CN'), 'What I want to learn')
})

test('localizing a type changes only its presentation', () => {
  const def = learning()
  const localized = localizeTypeDef(def, 'zh-CN')
  assert.equal(localized.label, '学习')
  assert.equal(localized.key, def.key)
  assert.equal(localized.kind, def.kind)
  assert.equal(localized.isBuiltin, def.isBuiltin)
  assert.equal(localized.finishBehaviour, def.finishBehaviour)
  assert.deepEqual(localized.destination, def.destination)
  assert.deepEqual(localized.grants, def.grants)
  assert.deepEqual(
    localized.inputSchema.map((f) => f.key),
    def.inputSchema.map((f) => f.key)
  )
  assert.deepEqual(
    localized.inputSchema.map((f) => f.required ?? false),
    def.inputSchema.map((f) => f.required ?? false)
  )
})

test('the label a task shows resolves through its effective type', () => {
  const types = builtinTypeSeeds()
  const task = { type: 'learning' as const, customTypeKey: null }
  assert.equal(typeLabel(task, types, 'en'), 'Learning')
  assert.equal(typeLabel(task, types, 'zh-CN'), '学习')
  // A custom key that still resolves wins over the built-in type.
  const customType: TaskTypeDef = { ...learning(), key: 'paper', label: 'Paper', isBuiltin: false }
  assert.equal(typeLabel({ type: 'learning', customTypeKey: 'paper' }, [...types, customType], 'zh-CN'), 'Paper')
  // A custom key that no longer resolves falls back to the built-in, translated.
  assert.equal(typeLabel({ type: 'learning', customTypeKey: 'gone' }, types, 'zh-CN'), '学习')
})

test('every built-in seed matches its catalog entry', () => {
  // The drift guard. Recognition is a comparison against the catalog value, so
  // if the seed text and the catalog ever disagree that type stops translating
  // — silently, because the label still renders (as the user's own words).
  // Note that a translation may legitimately BE the English text (JIRA stays
  // JIRA), so the check is on the values agreeing, not on the output differing.
  for (const def of builtinTypeSeeds()) {
    const key = `type.${def.key}.label`
    assert.ok(isMessageKey(key), `${def.key} has no label key`)
    assert.equal(en[key as keyof typeof en], def.label, `${def.key}'s seed and catalog value disagree`)
    for (const field of def.inputSchema) {
      const fieldKey = `type.${def.key}.field.${field.key}.label`
      assert.ok(isMessageKey(fieldKey), `${def.key}.${field.key} has no label key`)
      assert.equal(en[fieldKey as keyof typeof en], field.label, `${def.key}.${field.key} disagrees with the catalog`)
    }
    // And a renamed copy of the same row is shown as written.
    assert.equal(displayTypeLabel({ ...def, label: 'Mine' }, 'zh-CN'), 'Mine')
  }
})
