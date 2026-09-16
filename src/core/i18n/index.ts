import { DEFAULT_LANGUAGE, PLURAL_FORMS, type Language } from './language'
import { en, type Catalog, type MessageKey } from './en'
import { zhCN } from './zhCn'

// Looking a message up, and nothing else.
//
// Nothing here knows about React, Electron or the filesystem: the renderer, the
// main process and the domain all format their strings through `message()`, and
// the language is always a value they were handed (see language.ts).

export { DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_NAMES, LOCALES, localeOf, isLanguage, PLURAL_FORMS } from './language'
export type { Language } from './language'
export type { Catalog, MessageKey } from './en'
export { en }

export const CATALOGS: Record<Language, Catalog> = {
  en,
  'zh-CN': zhCN
}

export type MessageParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: MessageParams) => string

/** Every key, for `isMessageKey` and for the catalog tests. */
export const MESSAGE_KEYS = Object.keys(en) as MessageKey[]

const KEY_SET = new Set<string>(MESSAGE_KEYS)

/**
 * Is this string one of our message keys?
 *
 * A `Set` lookup rather than `key in en`, which would answer true for
 * `'toString'` and `'__proto__'` and hand back a function instead of a string.
 */
export function isMessageKey(key: string): key is MessageKey {
  return KEY_SET.has(key)
}

const PARAM = /\{(\w+)\}/g

/**
 * Fill the `{name}` holes in a message.
 *
 * A hole with no value is left as written, so a missing parameter shows up in
 * the interface as `{path}` — visible, and reported — rather than as
 * "undefined". The replacer is a function so that a value containing `$&`
 * cannot corrupt the output.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(PARAM, (hole, name: string) => {
    const value = params[name]
    return value === undefined ? hole : String(value)
  })
}

/** One message, in one language. */
export function message(language: Language, key: MessageKey, params?: MessageParams): string {
  return interpolate((CATALOGS[language] ?? CATALOGS[DEFAULT_LANGUAGE])[key] ?? key, params)
}

/**
 * `message` bound to a language.
 *
 * Curried so a renderer component can memoise on it: the identity changes when
 * the language changes and not on every render.
 */
export function translator(language: Language): Translate {
  return (key, params) => message(language, key, params)
}

/**
 * The form a count selects. Both forms are named explicitly, so the compiler
 * checks that both keys exist; which one is used is the language's decision
 * (see PLURAL_FORMS — English has two forms, Chinese one).
 */
export function plural(
  language: Language,
  count: number,
  forms: { one: MessageKey; other: MessageKey },
  params?: MessageParams
): string {
  return message(language, forms[PLURAL_FORMS[language](count)], { count, ...params })
}
