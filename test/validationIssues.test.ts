import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateInputs, validateTypeDefinition } from '../src/core/domain/validation'
import { validateDestination } from '../src/core/domain/destination'
import { validatePluginEntries } from '../src/core/domain/plugins'
import { nodePathPort } from '../src/main/adapters/paths'
import { en, isMessageKey, message } from '../src/core/i18n'
import type { Destination, Settings, TaskTypeDef } from '../src/shared/types'

// Every refusal the domain can state, as a CODE.
//
// The point of the codes is that the sentence lives elsewhere, so these assert
// the code and its parameters — what a caller can act on — and separately that
// every code has a sentence, in both languages. A test that asserted the English
// here would be asserting on a translation that this layer no longer performs.

const typeDef = (over: Partial<TaskTypeDef> = {}): TaskTypeDef => ({
  key: 'learning',
  kind: 'learning',
  label: 'Learning',
  emoji: '🎓',
  inputSchema: [],
  isBuiltin: true,
  finishBehaviour: 'deposit-then-curate',
  destination: { store: 'wiki', rootPath: null, subdir: 'learning-notes' },
  grants: { skills: [], toolServers: [] },
  ...over
})

const settings = (over: Partial<Settings> = {}): Settings =>
  ({ skills: [], mcpServers: [], ...over }) as Settings

const keysOf = (errors: { key: string }[]) => errors.map((e) => e.key)

test('input refusals carry the input and the type they are about', () => {
  const errors = validateInputs(typeDef({ inputSchema: [{ key: 'target', label: 'Target', type: 'select', options: [{ value: 'a', label: 'A' }] }] }), {
    nope: '1',
    target: 'b'
  }).errors
  assert.deepEqual(keysOf(errors), ['validation.unknownInput', 'validation.inputNotAnOption'])
  assert.deepEqual(errors[0]!.params, { input: 'nope', type: 'learning' })
  assert.deepEqual(errors[1]!.params, { input: 'target', options: 'a' })
  assert.equal(message('en', errors[0]!.key, errors[0]!.params), 'unknown input "nope" for type "learning"')
})

test('a non-string value is refused as such', () => {
  const errors = validateInputs(typeDef({ inputSchema: [{ key: 'target', label: 'T', type: 'text' }] }), { target: 7 }).errors
  assert.deepEqual(keysOf(errors), ['validation.inputNotString'])
})

test('type-definition refusals name what is wrong, not how to say it', () => {
  const cases: [Partial<TaskTypeDef>, string][] = [
    [{ key: 'BAD KEY' }, 'validation.keyFormat'],
    [{ kind: 'nonsense' as never }, 'validation.kindUnknown'],
    [{ label: '' }, 'validation.labelRequired'],
    [{ emoji: '' }, 'validation.emojiRequired'],
    [{ finishBehaviour: 'nonsense' as never }, 'validation.behaviourUnknown'],
    [{ finishBehaviour: 'complete-only' }, 'validation.completeOnlyNoDestination'],
    [{ finishBehaviour: 'file-as-is', destination: undefined }, 'validation.needsDestination'],
    [{ grants: { skills: [''] as never, toolServers: [] } }, 'validation.grantNamesEmpty']
  ]
  for (const [over, expected] of cases) {
    const errors = validateTypeDefinition(typeDef(over), { paths: nodePathPort, existing: null, mode: 'create' }).errors
    assert.ok(keysOf(errors).includes(expected), `expected ${expected}, got ${keysOf(errors).join(', ')}`)
  }
})

test('the create/update identity rules carry the key they are about', () => {
  const existing = typeDef()
  const create = validateTypeDefinition(existing, { paths: nodePathPort, existing, mode: 'create' }).errors
  assert.deepEqual(keysOf(create), ['validation.keyIsBuiltin'])
  assert.deepEqual(create[0]!.params, { key: 'learning' })

  const missing = validateTypeDefinition(typeDef({ key: 'gone' }), { paths: nodePathPort, existing: null, mode: 'update' }).errors
  assert.deepEqual(keysOf(missing), ['validation.typeNotFound'])

  const changedKind = validateTypeDefinition(typeDef({ kind: 'jira' }), { paths: nodePathPort, existing, mode: 'update' }).errors
  assert.ok(keysOf(changedKind).includes('validation.builtinKindFixed'))
})

test('destination refusals cover each rule once', () => {
  const wiki: Destination = { store: 'wiki', rootPath: null, subdir: '' }
  assert.deepEqual(validateDestination(nodePathPort, wiki), [])
  assert.deepEqual(keysOf(validateDestination(nodePathPort, { ...wiki, rootPath: '/x' })), ['destination.wikiTakesNoRoot'])
  assert.deepEqual(keysOf(validateDestination(nodePathPort, { store: 'folder', rootPath: '', subdir: '' })), [
    'destination.folderNeedsAbsoluteRoot'
  ])
  assert.deepEqual(keysOf(validateDestination(nodePathPort, { ...wiki, subdir: '../up' })), ['destination.subdirTraversal'])
  assert.deepEqual(keysOf(validateDestination(nodePathPort, { ...wiki, subdir: '/abs' })), ['destination.subdirAbsolute'])
  const unknown = validateDestination(nodePathPort, { store: 'nope', rootPath: null, subdir: '' } as never)
  assert.deepEqual(keysOf(unknown), ['destination.storeUnknown'])
  assert.equal(unknown[0]!.params?.stores, 'wiki, folder')
})

test('plugin refusals name the entry they are about', () => {
  // Both rules fire on a wholly empty entry, and both are reported: fixing the
  // name alone would leave a skill that cannot be loaded.
  assert.deepEqual(keysOf(validatePluginEntries(settings({ skills: [{ name: '', description: '', path: '' }] }))), [
    'plugin.skill.nameRequired',
    'plugin.skill.pathRequired'
  ])
  assert.deepEqual(
    keysOf(validatePluginEntries(settings({ skills: [{ name: 'a', description: '', path: '' }] }))),
    ['plugin.skill.pathRequired']
  )
  // An http transport is refused AND, having no command, fails the stdio rule:
  // the validator states everything wrong with the entry rather than stopping
  // at the first problem, so the user can fix it in one pass.
  assert.deepEqual(
    keysOf(validatePluginEntries(settings({ mcpServers: [{ name: 'j', transport: { type: 'http' } as never }] }))),
    ['plugin.mcp.unsupportedTransport', 'plugin.mcp.commandRequired']
  )
})

test('every refusal has a sentence in both languages', () => {
  // The codes are only useful if something can phrase them. A code with no
  // message would render as the key itself, which is a user reading a bug.
  const codes = [
    ...keysOf(validateInputs(typeDef(), { nope: '1' }).errors),
    ...keysOf(validateTypeDefinition(typeDef({ key: 'BAD' }), { paths: nodePathPort, existing: null, mode: 'create' }).errors),
    ...keysOf(validateDestination(nodePathPort, { store: 'folder', rootPath: '', subdir: '' })),
    ...keysOf(validatePluginEntries(settings({ skills: [{ name: '', description: '', path: '' }] })))
  ]
  assert.ok(codes.length > 0)
  for (const code of codes) {
    assert.ok(isMessageKey(code), `${code} is not a catalog key`)
    for (const lang of ['en', 'zh-CN'] as const) {
      const text = message(lang, code)
      assert.notEqual(text, code, `${lang} has no sentence for ${code}`)
      assert.ok(en[code as keyof typeof en], `en is missing ${code}`)
    }
  }
})
