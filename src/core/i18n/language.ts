// The languages the UI can be shown in, declared once.
//
// This module is a LEAF: it imports nothing, so it can be consumed by
// src/shared, src/core, src/main and src/renderer alike without creating a
// dependency cycle (the same rule src/core/domain/categories.ts follows). Keep
// it that way — in particular, the language is never detected here: core is
// compiled into both hosts and has no `navigator`, no Electron `app`, and no
// DOM, so the choice is always a value handed in.

export const LANGUAGES = ['en', 'zh-CN'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'

/**
 * The BCP-47 tag each language formats dates with. ONE declaration, read by
 * every `toLocale*` call site (through the renderer's `useLocale`).
 */
export const LOCALES: Record<Language, string> = {
  en: 'en-US',
  'zh-CN': 'zh-CN'
}

/**
 * A language is always shown in its own script, so a user who cannot read the
 * current interface language can still find their way back. Deliberately not
 * catalog entries: these read the same whichever language is active.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  'zh-CN': '简体中文'
}

/**
 * Which plural form a count selects. English has two; Chinese has one.
 *
 * A `Record<Language, …>` rather than `Intl.PluralRules` so that adding a
 * language is a compile error until this is filled in, and so the choice stays
 * declarative rather than a runtime ICU lookup.
 */
export const PLURAL_FORMS: Record<Language, (n: number) => 'one' | 'other'> = {
  en: (n) => (n === 1 ? 'one' : 'other'),
  'zh-CN': () => 'other'
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** The locale a language formats dates with; no language means the default. */
export function localeOf(language: Language | null | undefined): string {
  return LOCALES[language ?? DEFAULT_LANGUAGE]
}
