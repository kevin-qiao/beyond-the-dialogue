import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOGS, DEFAULT_LANGUAGE, LANGUAGES, LANGUAGES as LANGS, LANGUAGE_NAMES, LOCALES, MESSAGE_KEYS, en, interpolate, isMessageKey, message, plural, translator } from '../src/core/i18n'
import { PLURAL_FORMS, localeOf, isLanguage } from '../src/core/i18n/language'
import type { MessageKey } from '../src/core/i18n'
import { censusTree, readBaseline, type FileCounts } from './helpers/i18nBaseline'
import { ALLOWED_LITERALS } from './i18n-allowlist'
import { walk, ROOT, readSource } from './helpers/sourceScan'
import * as path from 'node:path'

// The catalogs, and the guard that keeps them current.

// ---- the catalogs ----

test('every language translates every key', () => {
  // The compiler is the primary gate: zhCn is annotated `Record<MessageKey, string>`.
  // This catches the way around it — someone widening the annotation to an
  // index signature, at which point `tsc` would stop noticing anything.
  const expected = [...MESSAGE_KEYS].sort()
  for (const lang of LANGUAGES) {
    assert.deepEqual(Object.keys(CATALOGS[lang]).sort(), expected, `catalog for ${lang} does not match the key set`)
  }
})

test('the catalogs are not empty', () => {
  // Guards against the guard: two empty catalogs are perfectly consistent.
  assert.ok(MESSAGE_KEYS.length >= 2, `expected a real catalog, found ${MESSAGE_KEYS.length} key(s)`)
})

test('a translation keeps the placeholders of its source', () => {
  // What `tsc` cannot see and a translator genuinely gets wrong: dropping a
  // `{title}` leaves the sentence without the thing it is about.
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
  for (const key of MESSAGE_KEYS) {
    for (const lang of LANGUAGES) {
      assert.deepEqual(
        holes(CATALOGS[lang][key]),
        holes(en[key]),
        `${lang} "${key}" has different placeholders than the English source`
      )
    }
  }
})

test('no message is empty or padded', () => {
  // A message made only of punctuation and spaces is a joiner — and a joiner's
  // spacing is the point, since it is pasted between two other strings and the
  // separator differs by language ('; ' vs '；'). Everything else is prose, and
  // stray whitespace there is a typo.
  const isJoiner = (s: string) => /^[\s\p{P}]+$/u.test(s)
  for (const lang of LANGUAGES) {
    for (const key of MESSAGE_KEYS) {
      const value = CATALOGS[lang][key]
      assert.ok(value.length > 0, `${lang} "${key}" is empty`)
      if (!isJoiner(value)) {
        assert.equal(value, value.trim(), `${lang} "${key}" has leading or trailing whitespace`)
      }
    }
  }
})

test('keys follow the area.subject convention', () => {
  for (const key of MESSAGE_KEYS) {
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*$/, `"${key}" is not a dotted lowerCamelCase key`)
  }
})

test('plural forms come in pairs', () => {
  for (const key of MESSAGE_KEYS) {
    if (key.endsWith('.one')) assert.ok(isMessageKey(`${key.slice(0, -4)}.other`), `${key} has no .other sibling`)
    if (key.endsWith('.other')) assert.ok(isMessageKey(`${key.slice(0, -6)}.one`), `${key} has no .one sibling`)
  }
})

test('one language set, one locale map, one default', () => {
  assert.ok(LANGS.includes(DEFAULT_LANGUAGE), 'the default language is not one of the languages')
  assert.deepEqual(Object.keys(LANGUAGE_NAMES).sort(), [...LANGS].sort())
  assert.deepEqual(Object.keys(PLURAL_FORMS).sort(), [...LANGS].sort())
  for (const lang of LANGS) {
    // The tag must be one Intl accepts: 'zh_CN' (underscore) would silently
    // fall back to the system locale and look like a formatting bug.
    const resolved = new Intl.DateTimeFormat(LOCALES[lang]).resolvedOptions().locale
    assert.ok(resolved.startsWith(lang.split('-')[0]!), `${lang} -> ${LOCALES[lang]} resolved as ${resolved}`)
    assert.equal(localeOf(lang), LOCALES[lang])
  }
})

test('isLanguage rejects anything that is not a language', () => {
  for (const lang of LANGS) assert.ok(isLanguage(lang))
  for (const bad of [undefined, null, '', 'EN', 'zh', 'zh_CN', 'fr', 42, {}]) {
    assert.equal(isLanguage(bad), false, `${JSON.stringify(bad)} was accepted as a language`)
  }
})

// ---- looking a message up ----

test('isMessageKey answers for keys and only keys', () => {
  for (const key of MESSAGE_KEYS) assert.ok(isMessageKey(key))
  // Prototype members must not read as messages: `'toString' in en` is true.
  for (const bad of ['toString', '__proto__', 'constructor', '', 'type.zzz.label']) {
    assert.equal(isMessageKey(bad), false, `${bad} was accepted as a key`)
  }
})

test('interpolation fills what it can and leaves the rest visible', () => {
  assert.equal(interpolate('a {b} c', { b: 'x' }), 'a x c')
  assert.equal(interpolate('{n} items', { n: 3 }), '3 items')
  // A hole with no value stays as written rather than becoming "undefined":
  // the defect should be visible in the interface, not silent.
  assert.equal(interpolate('filed to {path}', {}), 'filed to {path}')
  assert.equal(interpolate('plain'), 'plain')
  assert.equal(interpolate('plain', { unused: 1 }), 'plain')
  // A value that looks like a replacement pattern must not be interpreted.
  assert.equal(interpolate('{a}', { a: '$&x' }), '$&x')
  assert.equal(interpolate('{a}', { a: '$1' }), '$1')
})

test('a message resolves in the language it is asked for', () => {
  const key = MESSAGE_KEYS[0]!
  for (const lang of LANGUAGES) {
    assert.equal(message(lang, key), CATALOGS[lang][key])
    assert.equal(translator(lang)(key), CATALOGS[lang][key])
  }
  // A key that is not in a catalog reads as itself, which is what makes a
  // missing translation a visible defect rather than an empty label.
  assert.equal(message('en', 'type.zzz.label' as MessageKey), 'type.zzz.label')
})

test('plural picks the form the language has', () => {
  const forms = { one: 'x.one' as MessageKey, other: 'x.other' as MessageKey }
  // Use a real pair so the lookup cannot pass by accident.
  const real = MESSAGE_KEYS.find((k) => k.endsWith('.one'))
  if (!real) {
    assert.equal(PLURAL_FORMS.en(1), 'one')
    assert.equal(PLURAL_FORMS.en(2), 'other')
    assert.equal(PLURAL_FORMS['zh-CN'](1), 'other')
    return
  }
  const sibling = `${real.slice(0, -4)}.other` as MessageKey
  const pair = { one: real, other: sibling }
  assert.equal(plural('en', 1, pair, {}), message('en', real, { count: 1 }))
  assert.equal(plural('en', 2, pair, {}), message('en', sibling, { count: 2 }))
  assert.equal(plural('zh-CN', 1, pair, {}), message('zh-CN', sibling, { count: 1 }))
  void forms
})

// ---- the drift guard ----
//
// The size of the untranslated English in the renderer may only go down. A file
// whose count must fall while the sweep runs carries its allowance in
// test/i18n-literal-baseline.json; when the sweep is done the numbers are zero
// and any new literal fails here. Regenerate with
// `npx tsx test/helpers/i18nBaseline.ts` — the diff should only ever shrink.

test('no file gained untranslated text', () => {
  const baseline = readBaseline()
  const current = censusTree()
  const offenders: string[] = []
  for (const [file, counts] of Object.entries(current)) {
    const allowed: FileCounts = baseline[file] ?? { attributes: 0, texts: 0, labels: 0 }
    for (const kind of ['attributes', 'texts', 'labels'] as const) {
      if (counts[kind] > allowed[kind]) {
        offenders.push(`${file}: ${kind} ${allowed[kind]} -> ${counts[kind]}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `new user-visible English must go through the catalog (src/core/i18n):\n${offenders.join('\n')}`
  )
})

test('the baseline describes files that still exist', () => {
  // A stale entry is an allowance nobody is using, and it hides the file
  // having been renamed into a fresh one with a full allowance.
  const baseline = readBaseline()
  const missing = Object.keys(baseline).filter((file) => !censusTree()[file])
  assert.deepEqual(missing, [], `baseline entries with no file (regenerate it):\n${missing.join('\n')}`)
})

test('the guard is looking at a real tree', () => {
  // Guards against the guard silently passing because the renderer was renamed
  // away or the census stopped matching anything.
  const files = walk(path.join(ROOT, 'src', 'renderer'), (f) => /\.tsx$/.test(f))
  assert.ok(files.length >= 10, `expected renderer components, found ${files.length} .tsx file(s)`)
  const total = Object.values(censusTree()).reduce((n, c) => n + c.attributes + c.texts + c.labels, 0)
  assert.ok(total > 0, 'the census matched nothing at all, so the guard cannot be trusted')
})

test('the allowlist is a list of literals, not a set of patterns', () => {
  assert.ok(ALLOWED_LITERALS.length > 0)
  for (const entry of ALLOWED_LITERALS) {
    assert.ok(entry.length >= 1, 'an empty allowlist entry would exempt every blank literal')
    assert.ok(!/[\\^$*+?()[\]{}|]/.test(entry), `"${entry}" looks like a pattern; entries are exact literal values`)
    assert.equal(entry, entry.trim(), `"${entry}" has whitespace around it and would never match`)
  }
})

test('no user-visible English is hardcoded outside the catalog in core', () => {
  // The language is a parameter, never ambient state: core is compiled into
  // both hosts, so a date formatted there with the system locale would ignore
  // the language the user chose. Mirrors test/layering.test.ts's idiom.
  const CORE = path.join(ROOT, 'src', 'core')
  const offenders: string[] = []
  for (const file of walk(CORE, (f) => f.endsWith('.ts'))) {
    if (file.includes(`${path.sep}i18n${path.sep}`)) continue
    const code = readSource(file)
    if (/\btoLocale[A-Za-z]*\s*\(/.test(code) || /\bIntl\./.test(code)) {
      offenders.push(path.relative(ROOT, file))
    }
  }
  assert.deepEqual(offenders, [], `core must format dates through the language it is given:\n${offenders.join('\n')}`)
})

test('a seeded type label is never written back translated', () => {
  // The one data-loss path in this feature: the type editor seeds its inputs
  // from the stored row and saves what it is given. If a *translated* label
  // ever reached that state, saving while the UI is Chinese would write Chinese
  // into task_types — permanently, and with nothing in the app able to undo it.
  const src = readSource(path.join(ROOT, 'src', 'renderer', 'src', 'components', 'overlays', 'SettingsView.tsx'))
  assert.ok(
    /useState\(\s*existing\?\.label/.test(src),
    'the type editor must seed its label input from the stored value, not a translated one'
  )
})
